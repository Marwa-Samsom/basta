/**
 * القيود — دوال نقية تقرّر **ماذا** يُقيَّد، والخدمة تقرّر **أين ومتى**.
 *
 * كل فرعي بعملة بائعه (ADR-013) ينقسم ما دفعه المشتري فيه بين ثلاثة لا غير:
 *
 *     المقبوض = مستحقات البائع + نصيب المنصة + ما رُدّ للمشتري
 *
 * نصيب المنصة: العمولة + الضريبة المحصَّلة فوق السعر − دعم كوبون تموّله.
 * كل قيد هنا يحفظ المساواة بالبناء، والمنظر audit_money_conservation يفحصها
 * من ثلاثة جداول مستقلة — فالخطأ في دالة هنا يظهر هناك.
 */
import { shareBetween } from '../../../common/money/money';

export type Direction = 'credit' | 'debit';

export type VendorEntryType =
  | 'sale_credit'
  | 'shipping_credit'
  | 'commission_debit'
  | 'refund_debit'
  | 'hold_release_out'
  | 'hold_release_in'
  | 'payout_debit'
  | 'adjustment_credit'
  | 'adjustment_debit';

export type PlatformEntryType = 'commission' | 'tax_held' | 'discount_subsidy' | 'rounding';

export interface VendorPosting {
  readonly entryType: VendorEntryType;
  readonly direction: Direction;
  readonly amount: bigint;
  readonly memo?: string;
  /** يعكس قيداً قائماً — تُملأ في الخدمة من قيد البيع */
  readonly reverses?: VendorEntryType;
}

export interface PlatformPosting {
  readonly entryType: PlatformEntryType;
  readonly direction: Direction;
  readonly amount: bigint;
  readonly memo?: string;
}

/** ما يلزم من الفرعي لتقسيمه — كله بعملة البائع */
export interface SubOrderMoney {
  readonly items: bigint;
  readonly discount: bigint;
  readonly shipping: bigint;
  readonly total: bigint;
  readonly commission: bigint;
  readonly vendorNet: bigint;
}

export interface LineMoney {
  readonly orderItemId: string;
  readonly qty: number;
  readonly refundedQty: number;
  readonly lineSubtotal: bigint;
  readonly lineDiscount: bigint;
  readonly lineTax: bigint;
  readonly lineTotal: bigint;
  readonly commission: bigint;
}

const signed = (d: Direction, a: bigint): bigint => (d === 'credit' ? a : -a);
export const net = (rows: readonly { direction: Direction | string; amount: bigint }[]): bigint =>
  rows.reduce((s, r) => s + signed(r.direction as Direction, r.amount), 0n);

/**
 * من موّل الخصم؟ لا يُخزَّن صراحةً على الفرعي، لكنه يُستنتج بلا لبس من
 * صافي البائع المثبَّت: البائع الممّول يُنقص الخصم من صافيه (pricing.ts).
 */
export function vendorFundedDiscount(s: SubOrderMoney): boolean {
  return s.discount > 0n && s.vendorNet === s.items - s.discount - s.commission + s.shipping;
}

/** الضريبة المحصَّلة فوق السعر — تبقى للمنصة لتوريدها. الشاملة داخل سعر البائع */
export const taxHeld = (s: SubOrderMoney): bigint => s.total - (s.items - s.discount + s.shipping);

/** قيود البيع لحظة نجاح الدفع — في الجيب المعلّق (ADR-007) */
export function salePostings(s: SubOrderMoney): { vendor: VendorPosting[]; platform: PlatformPosting[] } {
  const vf = vendorFundedDiscount(s);
  const saleCredit = s.items - (vf ? s.discount : 0n);
  const vendor: VendorPosting[] = [
    { entryType: 'sale_credit', direction: 'credit', amount: saleCredit },
    { entryType: 'shipping_credit', direction: 'credit', amount: s.shipping },
    { entryType: 'commission_debit', direction: 'debit', amount: s.commission },
  ];
  const tax = taxHeld(s);
  const platform: PlatformPosting[] = [
    { entryType: 'commission', direction: 'credit', amount: s.commission },
    { entryType: 'tax_held', direction: 'credit', amount: tax },
    ...(vf ? [] : [{ entryType: 'discount_subsidy' as const, direction: 'debit' as const, amount: s.discount }]),
  ];
  const posted = { vendor: vendor.filter((p) => p.amount > 0n), platform: platform.filter((p) => p.amount > 0n) };
  // الفحص الذاتي: ما لا يحفظ المال لا يُقيَّد أصلاً
  const sum = net(posted.vendor) + net(posted.platform);
  if (sum !== s.total) throw new Error(`قيود البيع لا تساوي المقبوض: ${sum} ≠ ${s.total}`);
  if (net(posted.vendor) !== s.vendorNet) throw new Error('قيود البائع لا تساوي صافيه المثبَّت.');
  return posted;
}

/**
 * إرجاع جزئي: q قطعة من سطر فيه Q. المشتري يستردّ نصيب السطر كما دفعه
 * (بخصمه وضريبته، بلا شحن)؛ البائع يُنقص نصيب ما قُيِّد له ويستردّ نصيب
 * العمولة؛ المنصة تعيد نصيب العمولة والضريبة وتستعيد نصيب دعمها.
 * كل حصة بنصيبها التراكمي من السطر (`shareBetween`): لأسفل، وآخر قطعة تكمل الباقي —
 * فإرجاع السطر كله قطعةً قطعة يعكس قيوده بالضبط، لا 99.99 من 100.00. وفرق التقريب بين
 * المكوّنات قيد «rounding» صريح على المنصة — لا يُخفى في رقم آخر.
 */
export function partialRefundPostings(
  s: SubOrderMoney,
  lines: readonly LineMoney[],
  returned: readonly { orderItemId: string; qty: number }[],
): { buyerGets: bigint; vendor: VendorPosting[]; platform: PlatformPosting[] } {
  const vf = vendorFundedDiscount(s);
  let buyerGets = 0n;
  let saleBack = 0n;
  let commissionBack = 0n;
  let taxBack = 0n;
  let subsidyBack = 0n;

  for (const r of returned) {
    const l = lines.find((x) => x.orderItemId === r.orderItemId);
    if (!l) throw new Error(`سطر ليس في الفرعي: ${r.orderItemId}`);
    if (r.qty < 1 || r.qty > l.qty - l.refundedQty) throw new Error('كمية إرجاع خارج المتاح.');
    const share = (v: bigint): bigint => shareBetween(v, l.refundedQty, l.refundedQty + r.qty, l.qty);
    const exclusive = l.lineTotal === l.lineSubtotal - l.lineDiscount + l.lineTax && l.lineTax > 0n;
    buyerGets += share(l.lineTotal);
    saleBack += share(l.lineSubtotal - (vf ? l.lineDiscount : 0n));
    commissionBack += share(l.commission);
    taxBack += exclusive ? share(l.lineTax) : 0n;
    subsidyBack += vf ? 0n : share(l.lineDiscount);
  }

  const vendor: VendorPosting[] = [
    { entryType: 'refund_debit', direction: 'debit', amount: saleBack, memo: 'إرجاع جزئي' },
    { entryType: 'commission_debit', direction: 'credit', amount: commissionBack, memo: 'عكس عمولة القطع المرتجعة', reverses: 'commission_debit' },
  ];
  // فرق التقريب من مكوّناته هو لا «باقياً» يُحسب من قيود البائع: لو كان باقياً
  // لابتلع أي خطأ في قيد البائع بصمت، ولما رآه منظر الحفظ أبداً.
  const rounding = saleBack + taxBack - subsidyBack - buyerGets;
  const lineCount = BigInt(returned.length);
  if (rounding > 3n * lineCount || rounding < -3n * lineCount) {
    throw new Error(`فرق تقريب غير معقول: ${rounding}`);
  }
  const platform: PlatformPosting[] = [
    { entryType: 'commission', direction: 'debit', amount: commissionBack, memo: 'عكس عمولة' },
    { entryType: 'tax_held', direction: 'debit', amount: taxBack, memo: 'ردّ ضريبة' },
    { entryType: 'discount_subsidy', direction: 'credit', amount: subsidyBack, memo: 'استعادة دعم الخصم' },
    rounding >= 0n
      ? { entryType: 'rounding', direction: 'credit', amount: rounding, memo: 'فرق تقريب الحصص' }
      : { entryType: 'rounding', direction: 'debit', amount: -rounding, memo: 'فرق تقريب الحصص' },
  ];
  return {
    buyerGets,
    vendor: vendor.filter((p) => p.amount > 0n),
    platform: platform.filter((p) => p.amount > 0n),
  };
}

/**
 * استرداد كامل (إلغاء، أو شحنة لم تصل): كل ما بقي يعود للمشتري. يُصفَّر
 * صافي البائع وكل نوع من نصيب المنصة بقيد معاكس — بعد أي إرجاع جزئي سبقه.
 */
export function fullRefundPostings(
  vendorNetBySub: bigint,
  platformNetByType: ReadonlyMap<PlatformEntryType, bigint>,
): { buyerGets: bigint; vendor: VendorPosting[]; platform: PlatformPosting[] } {
  const vendor: VendorPosting[] =
    vendorNetBySub > 0n
      ? [{ entryType: 'refund_debit', direction: 'debit', amount: vendorNetBySub, memo: 'استرداد كامل' }]
      : vendorNetBySub < 0n
        ? [{ entryType: 'adjustment_credit', direction: 'credit', amount: -vendorNetBySub, memo: 'تصفير بعد استرداد كامل' }]
        : [];
  const platform: PlatformPosting[] = [];
  let platformNet = 0n;
  for (const [type, v] of platformNetByType) {
    platformNet += v;
    if (v > 0n) platform.push({ entryType: type, direction: 'debit', amount: v, memo: 'عكس عند الاسترداد الكامل' });
    if (v < 0n) platform.push({ entryType: type, direction: 'credit', amount: -v, memo: 'عكس عند الاسترداد الكامل' });
  }
  return { buyerGets: vendorNetBySub + platformNet, vendor, platform };
}
