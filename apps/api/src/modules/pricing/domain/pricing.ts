/**
 * تسعير السلة وتقسيمها — بلا قاعدة بيانات، فيُختبر بكل حالاته.
 *
 * **القاعدة التي تحكم الملف:** مجموع الطلبات الفرعية = الطلب الأب بالقرش
 * (بوابة المرحلة 08، البند الخامس). المبالغ الفرعية بعملة البائع والأب بعملة
 * المشتري، فالمساواة لا تتحقّق بالصدفة بعد التقريب — تُبنى:
 *
 *   1. كل فرعي يُحسب كاملاً بعملة بائعه (لا تقريب هنا، أعداد صحيحة).
 *   2. **إجماليه** يُحوَّل مرة واحدة إلى عملة الدفع ويُقرَّب مرة واحدة.
 *   3. مكوّناته بعملة الدفع تُحوَّل كلٌّ على حدة، ثم يُضبط الفرق على البنود
 *      فتساوي الإجمالي المحوَّل بالضبط.
 *   4. الأب = مجموع الإجماليات المحوَّلة. لا تقريب على مستوى الأب إطلاقاً.
 */

import { InvalidInputError } from '../../../common/errors/domain-error';

// -------------------------------------------------------------------- الأنواع

export interface PricedLineInput {
  readonly variantId: string;
  readonly productId: string;
  readonly vendorId: string;
  readonly categoryId: string;
  readonly nameAr: string;
  readonly variantLabel: string | null;
  readonly sku: string;
  readonly imageKey: string | null;
  readonly unitPriceMinor: bigint;
  readonly qty: number;
  readonly weightGrams: number | null;
  /** لقطة العمولة لحظة التسعير — ADR-004 */
  readonly commissionBps: number;
}

export interface VendorContext {
  readonly vendorId: string;
  readonly nameAr: string;
  readonly currency: string;
  readonly currencyDigits: number;
}

export type ShippingQuote =
  | { readonly available: true; readonly minor: bigint; readonly minDays: number; readonly maxDays: number }
  | { readonly available: false; readonly reason: string };

export interface CouponInput {
  readonly code: string;
  readonly scope: 'platform' | 'vendor';
  readonly vendorId: string | null;
  readonly type: 'percent' | 'fixed' | 'free_shipping';
  readonly valueBps: number | null;
  readonly valueMinor: bigint | null;
  readonly maxDiscountMinor: bigint | null;
  readonly minOrderMinor: bigint | null;
  readonly currency: string | null;
  /** خانات عملة الكوبون — لتحويل سقف الخصم إلى عملة الدفع */
  readonly currencyDigits?: number | null;
  readonly fundedBy: 'platform' | 'vendor';
}

export interface TaxInput {
  readonly rateBps: number;
  /** الأردن ومصر: السعر شامل. السعودية والإمارات: تُضاف فوقه (Q-04) */
  readonly inclusive: boolean;
}

export interface FxInput {
  readonly orderCurrency: string;
  readonly orderDigits: number;
  /** وحدات العملة مقابل دولار واحد، من جدول الأسعار النافذ */
  readonly usdRates: Readonly<Record<string, number>>;
  /** هامش الصرف — Q-13. لا يُطبَّق حين تتطابق العملتان */
  readonly spreadBps: number;
}

export interface Breakdown {
  readonly items: bigint;
  readonly discount: bigint;
  readonly shipping: bigint;
  readonly tax: bigint;
  readonly total: bigint;
}

export interface PricedLine extends PricedLineInput {
  readonly lineSubtotal: bigint;
  readonly lineDiscount: bigint;
  readonly lineTax: bigint;
  readonly lineTotal: bigint;
  readonly commissionMinor: bigint;
}

export interface PricedSubOrder {
  readonly vendorId: string;
  readonly vendorNameAr: string;
  readonly currency: string;
  readonly lines: readonly PricedLine[];
  /** بعملة البائع — ما يُقيَّد له وما تُحسب منه عمولته */
  readonly vendor: Breakdown;
  /** بعملة الدفع — حصّته من فاتورة المشتري */
  readonly charge: Breakdown;
  readonly commissionMinor: bigint;
  readonly vendorNetMinor: bigint;
  /** وحدات عملة البائع الصغرى لكل وحدة صغرى من عملة الدفع */
  readonly fxRateSnapshot: string;
  readonly shipping: { readonly minDays: number; readonly maxDays: number };
}

export interface PricedCart {
  readonly currency: string;
  readonly taxInclusive: boolean;
  readonly subOrders: readonly PricedSubOrder[];
  readonly totals: Breakdown;
  readonly coupon: { readonly code: string; readonly discountMinor: bigint } | null;
  readonly blockers: readonly string[];
}

// --------------------------------------------------------------- الصرف

/**
 * معامل التحويل من الوحدة الصغرى لعملة البائع إلى الوحدة الصغرى لعملة الدفع.
 * يدمج ثلاثة أشياء في رقم واحد: سعر الصرف المتقاطع عبر الدولار، وفرق
 * الخانات (الدينار ثلاث والدولار اثنتان)، والهامش حين تختلف العملتان.
 */
export function fxFactor(
  fromCurrency: string,
  fromDigits: number,
  fx: FxInput,
): number {
  if (fromCurrency === fx.orderCurrency) return 1;
  const from = fx.usdRates[fromCurrency];
  const to = fx.usdRates[fx.orderCurrency];
  if (!from || !to) {
    throw new InvalidInputError(`لا سعر صرف نافذ بين ${fromCurrency} و ${fx.orderCurrency}.`);
  }
  const scale = 10 ** (fx.orderDigits - fromDigits);
  return (to / from) * scale * (1 + fx.spreadBps / 10_000);
}

const convertMinor = (amount: bigint, factor: number): bigint =>
  factor === 1 ? amount : BigInt(Math.round(Number(amount) * factor));

// -------------------------------------------------------------- الخصم

/**
 * يوزّع مبلغاً على أسطر بنسبة قيمتها. التقريب لأسفل لكل سطر، والباقي كله
 * على أكبر سطر — فمجموع الحصص يساوي المبلغ بالضبط، لا يزيد فلساً ولا ينقص.
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n || total === 0n) return weights.map(() => 0n);
  const shares = weights.map((w) => (total * w) / sum);
  const remainder = total - shares.reduce((a, b) => a + b, 0n);
  let largest = 0;
  weights.forEach((w, i) => {
    if (w > (weights[largest] ?? 0n)) largest = i;
  });
  shares[largest] = (shares[largest] ?? 0n) + remainder;
  return shares;
}

function couponDiscount(
  coupon: CouponInput | null,
  vendorId: string,
  currency: string,
  itemsMinor: bigint,
  shippingMinor: bigint,
): { items: bigint; shipping: bigint } {
  if (!coupon) return { items: 0n, shipping: 0n };
  if (coupon.scope === 'vendor' && coupon.vendorId !== vendorId) return { items: 0n, shipping: 0n };

  switch (coupon.type) {
    case 'free_shipping':
      return { items: 0n, shipping: shippingMinor };
    case 'percent':
      // بلا سقف هنا: السقف للطلب كله لا لكل بائع — capPercent بعد حساب البائعين جميعاً
      return { items: (itemsMinor * BigInt(coupon.valueBps ?? 0)) / 10_000n, shipping: 0n };
    case 'fixed': {
      // الثابت بعملة البائع فقط: خصم «5 دنانير» على منتج بالريال يحتاج صرفاً
      // لا يملكه الكوبون، فيُمنع إنشاؤه كذلك لا يُحوَّل هنا بصمت
      if (coupon.currency !== currency) return { items: 0n, shipping: 0n };
      const value = coupon.valueMinor ?? 0n;
      return { items: value > itemsMinor ? itemsMinor : value, shipping: 0n };
    }
  }
}

/**
 * سقف خصم النسبة للطلب كله — بعملة الكوبون، أياً كانت عملات البائعين.
 *
 * كان يُطبَّق لكل بائع على حدة، فسلة من ثلاثة بائعين تأخذ ثلاثة أضعاف السقف؛
 * ويُتخطّى إن خالفت عملةُ البائع عملةَ الكوبون فيصير الخصم بلا سقف. الآن:
 * السقف يُحوَّل إلى عملة الدفع (بلا هامش — قيمته الحقيقية)، ويوزَّع على البائعين
 * بنسبة خصومهم بـ allocate (فمجموع الحصص = السقف بالضبط)، وتُعاد كل حصة إلى
 * عملة بائعها بالتقريب لأسفل. وخصم البائع أقلّ الاثنين. مضمون ألّا يتجاوز
 * ما يُخصم من المشتري السقف: الحصة المُعادة لأسفل ثم المحوَّلة بالتقريب لا
 * تتخطّى عدداً صحيحاً كانت دونه.
 */
function capPercent(
  coupon: CouponInput | null,
  ctxs: { vendor: VendorContext; disc: { items: bigint; shipping: bigint } }[],
  fx: FxInput,
): void {
  if (!coupon || coupon.type !== 'percent' || coupon.maxDiscountMinor === null) return;
  const capCurrency = coupon.currency ?? fx.orderCurrency;
  const capDigits = coupon.currency ? (coupon.currencyDigits ?? fx.orderDigits) : fx.orderDigits;
  const capOrder = convertMinor(coupon.maxDiscountMinor, fxFactor(capCurrency, capDigits, { ...fx, spreadBps: 0 }));

  const factors = ctxs.map((c) => fxFactor(c.vendor.currency, c.vendor.currencyDigits, fx));
  const rawOrder = ctxs.map((c, i) => convertMinor(c.disc.items, factors[i]!));
  if (rawOrder.reduce((a, b) => a + b, 0n) <= capOrder) return;

  const shares = allocate(capOrder, rawOrder);
  ctxs.forEach((c, i) => {
    const f = factors[i]!;
    const back = f === 1 ? shares[i]! : BigInt(Math.floor(Number(shares[i]!) / f));
    if (back < c.disc.items) c.disc = { ...c.disc, items: back };
  });
}

// ------------------------------------------------------------ التسعير

export function priceCart(input: {
  readonly lines: readonly PricedLineInput[];
  readonly vendors: ReadonlyMap<string, VendorContext>;
  readonly shipping: ReadonlyMap<string, ShippingQuote>;
  readonly coupon: CouponInput | null;
  readonly tax: TaxInput;
  readonly fx: FxInput;
}): PricedCart {
  const blockers: string[] = [];
  if (input.lines.length === 0) blockers.push('السلة فارغة.');

  // تجميع حسب البائع بترتيب ثابت: الترتيب يحدّد أرقام الطلبات الفرعية
  const byVendor = new Map<string, PricedLineInput[]>();
  for (const line of input.lines) {
    if (line.qty <= 0 || !Number.isInteger(line.qty)) {
      throw new InvalidInputError(`كمية غير صالحة لـ ${line.nameAr}.`);
    }
    const list = byVendor.get(line.vendorId) ?? [];
    list.push(line);
    byVendor.set(line.vendorId, list);
  }

  let couponApplied = 0n;
  let couponMatched = false;
  const subOrders: PricedSubOrder[] = [];

  // المرور الأول: بنود كل بائع وشحنه وخصمه الخام — السقف يحتاجهم جميعاً معاً
  const ctxs = [...byVendor.keys()].sort().map((vendorId) => {
    const lines = byVendor.get(vendorId) ?? [];
    const vendor = input.vendors.get(vendorId);
    if (!vendor) throw new InvalidInputError('بائع مجهول في السلة.', { vendorId });

    const quote = input.shipping.get(vendorId);
    if (!quote || !quote.available) {
      blockers.push(quote && !quote.available ? quote.reason : `${vendor.nameAr} لا يشحن إلى عنوانك.`);
    }
    const shippingMinor = quote && quote.available ? quote.minor : 0n;

    const subtotals = lines.map((l) => l.unitPriceMinor * BigInt(l.qty));
    const items = subtotals.reduce((a, b) => a + b, 0n);

    // الحدّ الأدنى للكوبون يُقاس على بائعه أو على السلة كلها — المنصّي هنا يُقاس لكل بائع
    const eligible =
      input.coupon !== null &&
      (input.coupon.minOrderMinor === null ||
        (input.coupon.currency === vendor.currency && items >= input.coupon.minOrderMinor));
    const disc = eligible
      ? couponDiscount(input.coupon, vendorId, vendor.currency, items, shippingMinor)
      : { items: 0n, shipping: 0n };
    return { vendorId, lines, vendor, quote, shippingMinor, subtotals, items, disc };
  });
  capPercent(input.coupon, ctxs, input.fx);

  for (const { vendorId, lines, vendor, quote, shippingMinor, subtotals, items, disc } of ctxs) {
    if (disc.items > 0n || disc.shipping > 0n) couponMatched = true;

    const lineDiscounts = allocate(disc.items, subtotals);
    const discount = disc.items + disc.shipping;
    const netShipping = shippingMinor - disc.shipping;
    const taxable = items - disc.items;

    // الضريبة على البنود بعد الخصم، لا على الشحن — الشحن خدمة البائع بسعره (ADR-008)
    const tax = input.tax.inclusive
      ? (taxable * BigInt(input.tax.rateBps)) / BigInt(10_000 + input.tax.rateBps)
      : (taxable * BigInt(input.tax.rateBps)) / 10_000n;
    const lineTaxes = allocate(tax, subtotals.map((s, i) => s - (lineDiscounts[i] ?? 0n)));

    const total = items - disc.items + netShipping + (input.tax.inclusive ? 0n : tax);

    const priced: PricedLine[] = lines.map((l, i) => {
      const lineSubtotal = subtotals[i] ?? 0n;
      const lineDiscount = lineDiscounts[i] ?? 0n;
      const lineTax = lineTaxes[i] ?? 0n;
      const lineNet = lineSubtotal - lineDiscount;
      return {
        ...l,
        lineSubtotal,
        lineDiscount,
        lineTax,
        lineTotal: lineNet + (input.tax.inclusive ? 0n : lineTax),
        // ADR-001: لكل سطر وبالتقريب لأسفل — لصالح البائع
        commissionMinor: (lineNet * BigInt(l.commissionBps)) / 10_000n,
      };
    });

    const commission = priced.reduce((a, l) => a + l.commissionMinor, 0n);
    /**
     * صافي البائع = البنود − ما يتحمّله هو من الخصم − العمولة + الشحن.
     * كوبون تموّله المنصة لا يُنقص صافي البائع: المنصة تدفع الفرق (Q-06).
     */
    const vendorFunded = input.coupon?.fundedBy === 'vendor' ? disc.items + disc.shipping : 0n;
    const vendorNet = items - vendorFunded - commission + shippingMinor;

    // -------------------------------------------- عملة الدفع
    const factor = fxFactor(vendor.currency, vendor.currencyDigits, input.fx);
    const chargeTotal = convertMinor(total, factor);
    const chargeDiscount = convertMinor(discount, factor);
    const chargeShipping = convertMinor(netShipping + disc.shipping, factor);
    const chargeTax = convertMinor(tax, factor);
    // البنود تأخذ فرق التقريب كله، فتساوي المكوّنات الإجمالي المحوَّل بالضبط
    const chargeItems =
      chargeTotal - chargeShipping + chargeDiscount - (input.tax.inclusive ? 0n : chargeTax);

    couponApplied += chargeDiscount;

    subOrders.push({
      vendorId,
      vendorNameAr: vendor.nameAr,
      currency: vendor.currency,
      lines: priced,
      vendor: { items, discount, shipping: shippingMinor, tax, total },
      charge: {
        items: chargeItems,
        discount: chargeDiscount,
        shipping: chargeShipping,
        tax: chargeTax,
        total: chargeTotal,
      },
      commissionMinor: commission,
      vendorNetMinor: vendorNet,
      fxRateSnapshot: (1 / factor).toFixed(10),
      shipping: quote && quote.available ? { minDays: quote.minDays, maxDays: quote.maxDays } : { minDays: 0, maxDays: 0 },
    });
  }

  if (input.coupon && !couponMatched) {
    blockers.push(`الكوبون ${input.coupon.code} لا ينطبق على منتجات سلّتك.`);
  }

  const sum = (pick: (b: Breakdown) => bigint): bigint =>
    subOrders.reduce((a, s) => a + pick(s.charge), 0n);

  return {
    currency: input.fx.orderCurrency,
    taxInclusive: input.tax.inclusive,
    subOrders,
    totals: {
      items: sum((b) => b.items),
      discount: sum((b) => b.discount),
      shipping: sum((b) => b.shipping),
      tax: sum((b) => b.tax),
      // بالبناء: مجموع إجماليات الفرعية — لا تقريب على مستوى الأب
      total: sum((b) => b.total),
    },
    coupon: input.coupon && couponMatched ? { code: input.coupon.code, discountMinor: couponApplied } : null,
    blockers,
  };
}

// -------------------------------------------------------------- الشحن

export interface ZoneInput {
  readonly regions: readonly { country: string; region: string | null; city: string | null }[];
  readonly rates: readonly {
    method: string;
    priceMinor: bigint;
    perKgMinor: bigint | null;
    freeOverMinor: bigint | null;
    minDays: number;
    maxDays: number;
    isActive: boolean;
  }[];
}

/**
 * أرخص طريقة شحن تنطبق على العنوان — ADR-008 (الشحن بمسؤولية البائع).
 * المنطقة الأدقّ تفوز: المدينة قبل المحافظة قبل البلد.
 */
export function quoteShipping(
  zones: readonly ZoneInput[],
  address: { country: string; region: string | null; city: string | null },
  context: { itemsMinor: bigint; weightGrams: number; vendorNameAr: string },
): ShippingQuote {
  const norm = (v: string | null): string => (v ?? '').trim();
  const score = (r: ZoneInput['regions'][number]): number => {
    if (r.country.toUpperCase() !== address.country.toUpperCase()) return -1;
    if (r.city && norm(r.city) !== norm(address.city)) return -1;
    if (r.region && norm(r.region) !== norm(address.region)) return -1;
    return r.city ? 3 : r.region ? 2 : 1;
  };

  let best: { zone: ZoneInput; score: number } | null = null;
  for (const zone of zones) {
    const s = Math.max(-1, ...zone.regions.map(score));
    if (s > 0 && (!best || s > best.score)) best = { zone, score: s };
  }
  if (!best) return { available: false, reason: `${context.vendorNameAr} لا يشحن إلى عنوانك.` };

  const kg = Math.max(1, Math.ceil(context.weightGrams / 1000));
  const options = best.zone.rates
    .filter((r) => r.isActive)
    .map((r) => {
      if (r.method === 'free_over' && r.freeOverMinor !== null && context.itemsMinor >= r.freeOverMinor) {
        return { minor: 0n, r };
      }
      if (r.method === 'by_weight') return { minor: r.priceMinor + (r.perKgMinor ?? 0n) * BigInt(kg), r };
      return { minor: r.priceMinor, r };
    })
    .sort((a, b) => (a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0));

  const cheapest = options[0];
  if (!cheapest) return { available: false, reason: `${context.vendorNameAr} لم يحدّد سعر شحن لمنطقتك.` };
  return {
    available: true,
    minor: cheapest.minor,
    minDays: cheapest.r.minDays,
    maxDays: cheapest.r.maxDays,
  };
}
