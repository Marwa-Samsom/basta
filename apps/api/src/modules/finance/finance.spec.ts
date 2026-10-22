import { describe, expect, it } from 'vitest';
import {
  fullRefundPostings,
  net,
  partialRefundPostings,
  salePostings,
  taxHeld,
  vendorFundedDiscount,
  type LineMoney,
  type PlatformEntryType,
  type SubOrderMoney,
} from './domain/postings';

/** يبني فرعياً كما يبنيه pricing.ts — بالصيغ نفسها لا بأرقام مكتوبة باليد */
function build(opts: {
  lines: { unit: bigint; qty: number; bps: number }[];
  discountItems: bigint;
  shipping: bigint;
  taxBps: number;
  inclusive: boolean;
  fundedBy: 'vendor' | 'platform';
}): { sub: SubOrderMoney; lines: LineMoney[] } {
  const subtotals = opts.lines.map((l) => l.unit * BigInt(l.qty));
  const items = subtotals.reduce((a, b) => a + b, 0n);
  const disc = opts.discountItems > items ? items : opts.discountItems;
  // توزيع الخصم بالتناسب والباقي على الأكبر — كـ allocate في التسعير
  const shares = subtotals.map((s) => (items === 0n ? 0n : (disc * s) / items));
  const rest = disc - shares.reduce((a, b) => a + b, 0n);
  const big = subtotals.indexOf(subtotals.reduce((a, b) => (b > a ? b : a), 0n));
  shares[big] = (shares[big] ?? 0n) + rest;
  const taxable = items - disc;
  const tax = opts.inclusive
    ? (taxable * BigInt(opts.taxBps)) / BigInt(10_000 + opts.taxBps)
    : (taxable * BigInt(opts.taxBps)) / 10_000n;
  const nets = subtotals.map((s, i) => s - (shares[i] ?? 0n));
  const totalNet = nets.reduce((a, b) => a + b, 0n);
  const taxShares = nets.map((n) => (totalNet === 0n ? 0n : (tax * n) / totalNet));
  const taxRest = tax - taxShares.reduce((a, b) => a + b, 0n);
  taxShares[big] = (taxShares[big] ?? 0n) + taxRest;

  const lines: LineMoney[] = opts.lines.map((l, i) => {
    const lineNet = nets[i]!;
    return {
      orderItemId: `line-${i}`,
      qty: l.qty,
      refundedQty: 0,
      lineSubtotal: subtotals[i]!,
      lineDiscount: shares[i]!,
      lineTax: taxShares[i]!,
      lineTotal: lineNet + (opts.inclusive ? 0n : taxShares[i]!),
      commission: (lineNet * BigInt(l.bps)) / 10_000n,
    };
  });
  const commission = lines.reduce((a, l) => a + l.commission, 0n);
  const total = items - disc + opts.shipping + (opts.inclusive ? 0n : tax);
  const vendorFunded = opts.fundedBy === 'vendor' ? disc : 0n;
  return {
    sub: { items, discount: disc, shipping: opts.shipping, total, commission, vendorNet: items - vendorFunded - commission + opts.shipping },
    lines,
  };
}

describe('قيود البيع', () => {
  it('ضريبة مضافة: تبقى للمنصة، وصافي البائع كما ثبّته التسعير', () => {
    const { sub } = build({ lines: [{ unit: 10_000n, qty: 2, bps: 1000 }], discountItems: 0n, shipping: 1_500n, taxBps: 1500, inclusive: false, fundedBy: 'platform' });
    const p = salePostings(sub);
    expect(net(p.vendor)).toBe(sub.vendorNet);
    expect(taxHeld(sub)).toBe(3_000n);
    expect(net(p.vendor) + net(p.platform)).toBe(sub.total);
  });

  it('ضريبة شاملة: داخل سعر البائع، ولا شيء منها للمنصة', () => {
    const { sub } = build({ lines: [{ unit: 11_600n, qty: 1, bps: 1000 }], discountItems: 0n, shipping: 0n, taxBps: 1600, inclusive: true, fundedBy: 'platform' });
    expect(taxHeld(sub)).toBe(0n);
    expect(net(salePostings(sub).platform)).toBe(sub.commission);
  });

  it('خصم تموّله المنصة لا يُنقص البائع — المنصة تدفعه من نصيبها', () => {
    const { sub } = build({ lines: [{ unit: 10_000n, qty: 1, bps: 1000 }], discountItems: 2_000n, shipping: 0n, taxBps: 0, inclusive: true, fundedBy: 'platform' });
    expect(vendorFundedDiscount(sub)).toBe(false);
    const p = salePostings(sub);
    expect(net(p.vendor)).toBe(10_000n - 800n);
    expect(p.platform.find((x) => x.entryType === 'discount_subsidy')?.amount).toBe(2_000n);
  });

  it('خصم يموّله البائع يُنقص قيد بيعه، ولا دعم على المنصة', () => {
    const { sub } = build({ lines: [{ unit: 10_000n, qty: 1, bps: 1000 }], discountItems: 2_000n, shipping: 0n, taxBps: 0, inclusive: true, fundedBy: 'vendor' });
    expect(vendorFundedDiscount(sub)).toBe(true);
    const p = salePostings(sub);
    expect(p.vendor.find((x) => x.entryType === 'sale_credit')?.amount).toBe(8_000n);
    expect(p.platform.some((x) => x.entryType === 'discount_subsidy')).toBe(false);
  });
});

describe('حفظ المال — 2,000 فرعي عشوائي بإرجاعات جزئية ثم استرداد كامل', () => {
  // مولّد حتمي: الفشل يُعاد بالبذرة نفسها
  let seed = 20260922;
  const rnd = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };

  it('في كل خطوة: المقبوض = البائع + المنصة + المُسترد، وبعد الكامل لا يبقى لأحد شيء', () => {
    for (let t = 0; t < 2_000; t++) {
      const { sub, lines } = build({
        lines: Array.from({ length: 1 + rnd(4) }, () => ({ unit: BigInt(1 + rnd(90_000)), qty: 1 + rnd(5), bps: rnd(2_500) })),
        discountItems: BigInt(rnd(3) === 0 ? rnd(20_000) : 0),
        shipping: BigInt(rnd(3_000)),
        taxBps: [0, 500, 1400, 1500, 1600][rnd(5)]!,
        inclusive: rnd(2) === 0,
        fundedBy: rnd(2) === 0 ? 'vendor' : 'platform',
      });
      const sale = salePostings(sub);
      let vendor = net(sale.vendor);
      // العمولة الباقية على البائع (المخصوم ناقص المعكوس) — ما يعكسه الاسترداد الكامل
      const commissionOf = (ps: readonly { entryType: string; direction: string; amount: bigint }[]) =>
        -net(ps.filter((p) => p.entryType === 'commission_debit'));
      let commission = commissionOf(sale.vendor);
      const platform = new Map<PlatformEntryType, bigint>();
      for (const p of sale.platform) platform.set(p.entryType, (platform.get(p.entryType) ?? 0n) + net([p]));
      let refunded = 0n;
      const sum = () => [...platform.values()].reduce((a, b) => a + b, 0n);

      const state = lines.map((l) => ({ ...l }));
      for (let k = 0; k < rnd(3); k++) {
        const l = state[rnd(state.length)]!;
        const left = l.qty - l.refundedQty;
        if (left === 0) continue;
        const q = 1 + rnd(left);
        const r = partialRefundPostings(sub, state, [{ orderItemId: l.orderItemId, qty: q }]);
        vendor += net(r.vendor);
        commission += commissionOf(r.vendor);
        for (const p of r.platform) platform.set(p.entryType, (platform.get(p.entryType) ?? 0n) + net([p]));
        refunded += r.buyerGets;
        l.refundedQty += q;
        expect(vendor + sum() + refunded, `خطوة جزئية t=${t}`).toBe(sub.total);
      }

      const full = fullRefundPostings(vendor, commission, platform);
      vendor += net(full.vendor);
      commission += commissionOf(full.vendor);
      for (const p of full.platform) platform.set(p.entryType, (platform.get(p.entryType) ?? 0n) + net([p]));
      refunded += full.buyerGets;
      expect(vendor).toBe(0n);
      // والعمولة نفسها عادت صفراً: لا «عمولة مدفوعة» على ما رُدّ كله (VOPS-098)
      expect(commission, `عمولة t=${t}`).toBe(0n);
      expect(sum()).toBe(0n);
      expect(refunded).toBe(sub.total);
    }
  });

  it('إرجاع السطر كله قطعةً قطعة يعكس بيعه وعمولته بالضبط — آخر قطعة تكمل الباقي', () => {
    const { sub, lines } = build({ lines: [{ unit: 3_333n, qty: 3, bps: 1000 }], discountItems: 0n, shipping: 0n, taxBps: 0, inclusive: true, fundedBy: 'platform' });
    const state = lines.map((l) => ({ ...l }));
    let buyer = 0n;
    let commission = 0n;
    let sale = 0n;
    for (let k = 0; k < 3; k++) {
      const r = partialRefundPostings(sub, state, [{ orderItemId: 'line-0', qty: 1 }]);
      buyer += r.buyerGets;
      sale += r.vendor.find((p) => p.entryType === 'refund_debit')?.amount ?? 0n;
      commission += r.vendor.find((p) => p.entryType === 'commission_debit')?.amount ?? 0n;
      state[0]!.refundedQty += 1;
    }
    expect(buyer).toBe(state[0]!.lineTotal);
    expect(sale).toBe(state[0]!.lineSubtotal);
    expect(commission).toBe(state[0]!.commission);
  });

  it('لا يُرجع أكثر مما بقي من السطر', () => {
    const { sub, lines } = build({ lines: [{ unit: 1_000n, qty: 2, bps: 1000 }], discountItems: 0n, shipping: 0n, taxBps: 0, inclusive: true, fundedBy: 'platform' });
    expect(() => partialRefundPostings(sub, lines, [{ orderItemId: 'line-0', qty: 3 }])).toThrow();
  });
});
