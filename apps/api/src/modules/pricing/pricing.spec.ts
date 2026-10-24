import { describe, expect, it } from 'vitest';
import {
  allocate,
  fxFactor,
  priceCart,
  quoteShipping,
  type CouponInput,
  type FxInput,
  type PricedLineInput,
  type ShippingQuote,
  type VendorContext,
} from './domain/pricing';

const FX: FxInput = {
  orderCurrency: 'USD',
  orderDigits: 2,
  usdRates: { USD: 1, SAR: 3.75, JOD: 0.709, KWD: 0.307, AED: 3.6725, EGP: 48.5, EUR: 0.92 },
  spreadBps: 200,
};

const DIGITS: Record<string, number> = { USD: 2, SAR: 2, JOD: 3, KWD: 3, AED: 2, EGP: 2, EUR: 2 };

const vendor = (id: string, currency: string): VendorContext => ({
  vendorId: id,
  nameAr: `متجر ${id}`,
  currency,
  currencyDigits: DIGITS[currency] ?? 2,
});

const line = (vendorId: string, price: bigint, qty: number, bps = 1000): PricedLineInput => ({
  variantId: `v-${vendorId}-${price}`,
  productId: `p-${vendorId}`,
  vendorId,
  nameAr: 'منتج',
  variantLabel: null,
  sku: 'SKU',
  imageKey: null,
  unitPriceMinor: price,
  qty,
  weightGrams: 500,
  commissionBps: bps,
});

const ship = (minor: bigint): ShippingQuote => ({ available: true, minor, minDays: 2, maxDays: 5 });

describe('التوزيع', () => {
  it('مجموع الحصص = المبلغ بالضبط، والباقي على الأكبر', () => {
    const shares = allocate(100n, [1n, 1n, 1n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(shares).toEqual([34n, 33n, 33n]);
  });

  it('صفر يوزَّع أصفاراً، والأوزان الصفرية لا تقسم على صفر', () => {
    expect(allocate(0n, [5n, 7n])).toEqual([0n, 0n]);
    expect(allocate(10n, [0n, 0n])).toEqual([0n, 0n]);
  });
});

describe('الصرف', () => {
  it('العملة نفسها بلا تحويل ولا هامش', () => {
    expect(fxFactor('USD', 2, FX)).toBe(1);
  });

  it('الدينار بثلاث خانات إلى الدولار باثنتين، مع هامش 2%', () => {
    // 1 دينار = 1/0.709 دولار ≈ 1.4104، والخانات تقسم على 10، والهامش ×1.02
    const k = fxFactor('JOD', 3, FX);
    expect(k).toBeCloseTo((1 / 0.709) * 0.1 * 1.02, 10);
  });

  it('عملة بلا سعر نافذ تُرفض لا تُحوَّل بصفر', () => {
    expect(() => fxFactor('XYZ', 2, FX)).toThrow(/سعر صرف/);
  });
});

describe('بوابة 08 · البند الخامس — مجموع الفرعية = الأب بالقرش', () => {
  it('سلة من ثلاثة بائعين بثلاث عملات', () => {
    const cart = priceCart({
      lines: [line('a', 19_900n, 2), line('b', 12_500n, 1), line('c', 4_750n, 3)],
      vendors: new Map([
        ['a', vendor('a', 'SAR')],
        ['b', vendor('b', 'JOD')],
        ['c', vendor('c', 'USD')],
      ]),
      shipping: new Map([
        ['a', ship(2_500n)],
        ['b', ship(2_000n)],
        ['c', ship(0n)],
      ]),
      coupon: null,
      tax: { rateBps: 0, inclusive: true },
      fx: FX,
    });

    expect(cart.subOrders).toHaveLength(3);
    const sum = cart.subOrders.reduce((a, s) => a + s.charge.total, 0n);
    expect(sum).toBe(cart.totals.total);
    // كل فرعي يحمل الهامش الذي دخل معامله — صفر لعملة الدفع نفسها (ACFG-093)
    expect(cart.subOrders.map((s) => [s.currency, s.fxSpreadBps])).toEqual([
      ['SAR', 200],
      ['JOD', 200],
      ['USD', 0],
    ]);
  });

  it('500 سلة عشوائية: المساواة لا تنكسر مرة واحدة', () => {
    const currencies = Object.keys(DIGITS);
    let seed = 42;
    const rand = (n: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % n;
    };

    for (let run = 0; run < 500; run++) {
      const vendorCount = 1 + rand(4);
      const vendors = new Map<string, VendorContext>();
      const shipping = new Map<string, ShippingQuote>();
      const lines: PricedLineInput[] = [];
      for (let v = 0; v < vendorCount; v++) {
        const id = `v${v}`;
        vendors.set(id, vendor(id, currencies[rand(currencies.length)]!));
        shipping.set(id, ship(BigInt(rand(5000))));
        for (let l = 0; l < 1 + rand(4); l++) {
          lines.push({ ...line(id, BigInt(1 + rand(500_000)), 1 + rand(5), rand(2000)), variantId: `${id}-${l}` });
        }
      }
      const order = currencies[rand(currencies.length)]!;
      const inclusive = rand(2) === 0;
      const coupon: CouponInput | null =
        rand(3) === 0
          ? {
              code: 'X',
              scope: 'platform',
              vendorId: null,
              type: rand(2) === 0 ? 'percent' : 'free_shipping',
              valueBps: 1 + rand(5000),
              valueMinor: null,
              maxDiscountMinor: null,
              minOrderMinor: null,
              currency: null,
              fundedBy: 'platform',
            }
          : null;

      const cart = priceCart({
        lines,
        vendors,
        shipping,
        coupon,
        tax: { rateBps: rand(2000), inclusive },
        fx: { ...FX, orderCurrency: order, orderDigits: DIGITS[order]! },
      });

      // الأب = مجموع الفرعية، بالضبط
      expect(cart.subOrders.reduce((a, s) => a + s.charge.total, 0n)).toBe(cart.totals.total);

      for (const s of cart.subOrders) {
        // مكوّنات كل فرعي تساوي إجماليه — بعملة البائع وبعملة الدفع
        const identity = (b: typeof s.charge): bigint =>
          b.items - b.discount + b.shipping + (inclusive ? 0n : b.tax);
        expect(identity(s.charge)).toBe(s.charge.total);
        expect(identity(s.vendor)).toBe(s.vendor.total);
        // عمولة الأسطر لا تتجاوز النسبة من المجموع (التقريب لأسفل)
        const lineSum = s.lines.reduce((a, l) => a + l.lineSubtotal - l.lineDiscount, 0n);
        expect(s.commissionMinor).toBeLessThanOrEqual(
          (lineSum * BigInt(Math.max(...s.lines.map((l) => l.commissionBps)))) / 10_000n,
        );
        // لا مبلغ سالب
        for (const v of Object.values(s.charge)) expect(v).toBeGreaterThanOrEqual(0n);
      }
    }
  });
});

describe('الضريبة', () => {
  const base = {
    lines: [line('a', 11_600n, 1)],
    vendors: new Map([['a', vendor('a', 'JOD')]]),
    shipping: new Map([['a', ship(0n)]]),
    coupon: null,
    fx: { ...FX, orderCurrency: 'JOD', orderDigits: 3 },
  };

  it('الشاملة تُستخرج من السعر ولا تُضاف إليه — الأردن 16%', () => {
    const cart = priceCart({ ...base, tax: { rateBps: 1600, inclusive: true } });
    expect(cart.totals.total).toBe(11_600n);
    expect(cart.totals.tax).toBe(1_600n); // 11.600 شامل = 10.000 + 1.600
  });

  it('المضافة تُضاف فوق السعر — السعودية 15%', () => {
    const cart = priceCart({ ...base, tax: { rateBps: 1500, inclusive: false } });
    expect(cart.totals.tax).toBe(1_740n);
    expect(cart.totals.total).toBe(13_340n);
  });
});

describe('الكوبونات', () => {
  const vendors = new Map([
    ['a', vendor('a', 'SAR')],
    ['b', vendor('b', 'SAR')],
  ]);
  const shipping = new Map([
    ['a', ship(2_000n)],
    ['b', ship(1_000n)],
  ]);
  const lines = [line('a', 10_000n, 1), line('b', 20_000n, 1)];
  const tax = { rateBps: 0, inclusive: true };
  const fx = { ...FX, orderCurrency: 'SAR', orderDigits: 2 };

  it('كوبون البائع يخصم من منتجاته وحدها', () => {
    const cart = priceCart({
      lines,
      vendors,
      shipping,
      tax,
      fx,
      coupon: {
        code: 'B10',
        scope: 'vendor',
        vendorId: 'b',
        type: 'percent',
        valueBps: 1000,
        valueMinor: null,
        maxDiscountMinor: null,
        minOrderMinor: null,
        currency: 'SAR',
        fundedBy: 'vendor',
      },
    });
    const [a, b] = cart.subOrders;
    expect(a?.vendor.discount).toBe(0n);
    expect(b?.vendor.discount).toBe(2_000n);
    // يموّله البائع: صافيه ينقص بقدره
    expect(b?.vendorNetMinor).toBe(20_000n - 2_000n - b!.commissionMinor + 1_000n);
  });

  it('كوبون المنصة لا يُنقص صافي البائع — المنصة تتحمّله (Q-06)', () => {
    const cart = priceCart({
      lines,
      vendors,
      shipping,
      tax,
      fx,
      coupon: {
        code: 'ALL10',
        scope: 'platform',
        vendorId: null,
        type: 'percent',
        valueBps: 1000,
        valueMinor: null,
        maxDiscountMinor: null,
        minOrderMinor: null,
        currency: null,
        fundedBy: 'platform',
      },
    });
    const a = cart.subOrders[0]!;
    expect(a.vendor.discount).toBe(1_000n);
    expect(a.vendorNetMinor).toBe(10_000n - a.commissionMinor + 2_000n);
  });

  it('الشحن المجاني يُلغي الشحن ولا يمسّ البنود', () => {
    const cart = priceCart({
      lines,
      vendors,
      shipping,
      tax,
      fx,
      coupon: {
        code: 'SHIP',
        scope: 'platform',
        vendorId: null,
        type: 'free_shipping',
        valueBps: null,
        valueMinor: null,
        maxDiscountMinor: null,
        minOrderMinor: null,
        currency: null,
        fundedBy: 'platform',
      },
    });
    expect(cart.totals.total).toBe(30_000n);
  });

  it('كوبون لا ينطبق على شيء مانعٌ بسببه لا خصمٌ صامت بصفر', () => {
    const cart = priceCart({
      lines,
      vendors,
      shipping,
      tax,
      fx,
      coupon: {
        code: 'OTHER',
        scope: 'vendor',
        vendorId: 'z',
        type: 'percent',
        valueBps: 1000,
        valueMinor: null,
        maxDiscountMinor: null,
        minOrderMinor: null,
        currency: 'SAR',
        fundedBy: 'vendor',
      },
    });
    expect(cart.blockers.join(' ')).toMatch(/OTHER/);
  });
});

describe('الشحن', () => {
  const zones = [
    {
      regions: [{ country: 'JO', region: null, city: null }],
      rates: [{ method: 'flat', priceMinor: 3_000n, perKgMinor: null, freeOverMinor: null, minDays: 3, maxDays: 5, isActive: true }],
    },
    {
      regions: [{ country: 'JO', region: null, city: 'عمّان' }],
      rates: [
        { method: 'flat', priceMinor: 1_500n, perKgMinor: null, freeOverMinor: null, minDays: 1, maxDays: 2, isActive: true },
        { method: 'free_over', priceMinor: 1_500n, perKgMinor: null, freeOverMinor: 50_000n, minDays: 1, maxDays: 2, isActive: true },
      ],
    },
  ];
  const ctx = { itemsMinor: 20_000n, weightGrams: 800, vendorNameAr: 'متجر' };

  it('المدينة أدقّ من البلد فتفوز', () => {
    const q = quoteShipping(zones, { country: 'JO', region: null, city: 'عمّان' }, ctx);
    expect(q).toMatchObject({ available: true, minor: 1_500n, minDays: 1 });
  });

  it('خارج المدينة يعود لمنطقة البلد', () => {
    const q = quoteShipping(zones, { country: 'JO', region: null, city: 'إربد' }, ctx);
    expect(q).toMatchObject({ available: true, minor: 3_000n });
  });

  it('الشحن المجاني فوق الحد يفوز حين يتحقّق', () => {
    const q = quoteShipping(zones, { country: 'JO', region: null, city: 'عمّان' }, { ...ctx, itemsMinor: 60_000n });
    expect(q).toMatchObject({ available: true, minor: 0n });
  });

  it('بلد لا يشحن إليه البائع مانعٌ باسمه', () => {
    const q = quoteShipping(zones, { country: 'SA', region: null, city: 'الرياض' }, ctx);
    expect(q.available).toBe(false);
    if (!q.available) expect(q.reason).toMatch(/لا يشحن/);
  });

  it('اسم المكان يطابق بلا شدّة ولا همزة ولا «محافظة» — لا حرفياً', () => {
    const regional = [
      {
        regions: [
          { country: 'JO', region: 'عمان', city: null },
          { country: 'JO', region: 'الزرقا', city: null },
        ],
        rates: [{ method: 'flat', priceMinor: 2_000n, perKgMinor: null, freeOverMinor: null, minDays: 2, maxDays: 4, isActive: true }],
      },
    ];
    for (const region of ['عمّان', 'محافظة عمان', 'الزرقاء', ' الزرقا ']) {
      const q = quoteShipping(regional, { country: 'JO', region, city: 'أي مدينة' }, ctx);
      expect(q, region).toMatchObject({ available: true, minor: 2_000n });
    }
    expect(quoteShipping(regional, { country: 'JO', region: 'إربد', city: 'إربد' }, ctx).available).toBe(false);
  });
});

describe('سقف خصم النسبة — للطلب كله، بعملة الكوبون', () => {
  const percent = (cap: bigint, currency: string, digits: number): CouponInput => ({
    code: 'P20',
    scope: 'platform',
    vendorId: null,
    type: 'percent',
    valueBps: 2000,
    valueMinor: null,
    maxDiscountMinor: cap,
    minOrderMinor: null,
    currency,
    currencyDigits: digits,
    fundedBy: 'platform',
  });
  const tax = { rateBps: 0, inclusive: true };

  it('ثلاثة بائعين لا يأخذون ثلاثة أضعاف السقف', () => {
    // 20% من 200 ريال لكلٍّ = 40، والسقف 50 ريالاً — كان كل بائع يأخذ 40 فيصير الخصم 120
    const vendors = new Map([['a', vendor('a', 'SAR')], ['b', vendor('b', 'SAR')], ['c', vendor('c', 'SAR')]]);
    const shipping = new Map([['a', ship(0n)], ['b', ship(0n)], ['c', ship(0n)]]);
    const cart = priceCart({
      lines: [line('a', 20_000n, 1), line('b', 20_000n, 1), line('c', 20_000n, 1)],
      vendors,
      shipping,
      tax,
      fx: { ...FX, orderCurrency: 'SAR', orderDigits: 2 },
      coupon: percent(5_000n, 'SAR', 2),
    });
    expect(cart.totals.discount).toBe(5_000n);
    expect(cart.coupon?.discountMinor).toBe(5_000n);
    // موزَّع بنسبة الخصوم، ومجموع الحصص بالضبط
    expect(cart.subOrders.map((s) => s.vendor.discount).reduce((a, b) => a + b, 0n)).toBe(5_000n);
  });

  it('عملة البائع تخالف عملة الكوبون: السقف يسري محوَّلاً ولا يُتخطّى', () => {
    // سقف 50 ريالاً، والبائعان بالدينار والدولار، والدفع بالدولار — كان الخصم بلا سقف
    const vendors = new Map([['j', vendor('j', 'JOD')], ['u', vendor('u', 'USD')]]);
    const shipping = new Map([['j', ship(0n)], ['u', ship(0n)]]);
    const cart = priceCart({
      lines: [line('j', 100_000n, 1), line('u', 30_000n, 1)], // مئة دينار وثلاثمئة دولار
      vendors,
      shipping,
      tax,
      fx: FX,
      coupon: percent(5_000n, 'SAR', 2),
    });
    // 50 ريالاً بالدولار بسعر الصرف الحقيقي (بلا هامش)
    const capUsd = BigInt(Math.round(5_000 * (1 / 3.75)));
    expect(cart.totals.discount).toBeLessThanOrEqual(capUsd);
    expect(cart.totals.discount).toBeGreaterThan(capUsd - 5n);
    expect(cart.subOrders.every((s) => s.vendor.discount > 0n)).toBe(true);
  });

  it('خصم دون السقف لا يمسّه التوزيع', () => {
    const vendors = new Map([['a', vendor('a', 'SAR')], ['b', vendor('b', 'SAR')]]);
    const cart = priceCart({
      lines: [line('a', 10_000n, 1), line('b', 10_000n, 1)],
      vendors,
      shipping: new Map([['a', ship(0n)], ['b', ship(0n)]]),
      tax,
      fx: { ...FX, orderCurrency: 'SAR', orderDigits: 2 },
      coupon: percent(100_000n, 'SAR', 2),
    });
    expect(cart.subOrders.map((s) => s.vendor.discount)).toEqual([2_000n, 2_000n]);
  });
});
