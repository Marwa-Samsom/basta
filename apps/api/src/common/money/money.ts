/**
 * بسطة — نواة المال
 *
 * كل مبلغ في النظام يمرّ من هنا. لا يوجد رقم 100 مكتوب صراحةً في أي مكان آخر،
 * ولا عملية حسابية على مبلغ خارج هذه الوحدة.
 *
 * ADR-001  المال أعداد صحيحة بأصغر وحدة عملة
 * ADR-013  الخانات العشرية تختلف: الدينار 3 والدولار 2 والين 0
 */
import { currentLocale } from '../i18n/request-locale';

/** خانات كل عملة. المصدر النهائي جدول currencies — هذا احتياطي للتشغيل بلا اتصال. */
const MINOR_UNIT_DIGITS: Readonly<Record<string, number>> = Object.freeze({
  USD: 2, EUR: 2, GBP: 2, SAR: 2, AED: 2, EGP: 2, QAR: 2,
  JOD: 3, KWD: 3, BHD: 3, OMR: 3, TND: 3,
  JPY: 0, KRW: 0,
});

/** العملات المعروفة — ما تحوّل الإشعارات مبالغه إلى الإنجليزية (notifications/domain/english-vars.ts) */
export const CURRENCY_CODES: readonly string[] = Object.keys(MINOR_UNIT_DIGITS);

export type CurrencyCode = string;

/**
 * مبلغ مقترن بعملته. الاقتران ليس تجميلاً:
 * هو ما يجعل جمع دينار على دولار خطأً وقت الترجمة لا مفاجأةً في كشف حساب.
 */
export interface Money {
  readonly minorUnits: bigint;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function minorUnitDigits(currency: CurrencyCode): number {
  const digits = MINOR_UNIT_DIGITS[currency.toUpperCase()];
  if (digits === undefined) {
    throw new MoneyError(`عملة غير معروفة: ${currency}. أضِفها إلى جدول currencies أولاً.`);
  }
  return digits;
}

export function money(minorUnits: bigint | number, currency: CurrencyCode): Money {
  const value = typeof minorUnits === 'number' ? BigInt(Math.trunc(minorUnits)) : minorUnits;
  if (typeof minorUnits === 'number' && !Number.isInteger(minorUnits)) {
    throw new MoneyError(
      `مبلغ كسري: ${minorUnits}. المبالغ أعداد صحيحة بأصغر وحدة عملة (ADR-001).`,
    );
  }
  minorUnitDigits(currency); // يرمي إن كانت العملة مجهولة
  return { minorUnits: value, currency: currency.toUpperCase() };
}

export const zero = (currency: CurrencyCode): Money => money(0n, currency);

/**
 * الحارس الذي يمنع أخطر خطأ في نظام متعدد العملات: جمع مبلغين بعملتين.
 * INV-12 يفحص الاستعلامات، وهذه الدالة تفحص الكود.
 */
function assertSameCurrency(a: Money, b: Money, op: string): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `${op} بين عملتين مختلفتين: ${a.currency} و ${b.currency}. ` +
        `حوّل بـ convert() بسعر صرف ملقوط أولاً (ADR-013).`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'جمع');
  return { minorUnits: a.minorUnits + b.minorUnits, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'طرح');
  return { minorUnits: a.minorUnits - b.minorUnits, currency: a.currency };
}

export function sum(amounts: readonly Money[], currency: CurrencyCode): Money {
  return amounts.reduce<Money>((acc, m) => add(acc, m), zero(currency));
}

export function multiply(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`كمية غير صحيحة: ${quantity}`);
  }
  return { minorUnits: a.minorUnits * BigInt(quantity), currency: a.currency };
}

export const isZero = (a: Money): boolean => a.minorUnits === 0n;
export const isNegative = (a: Money): boolean => a.minorUnits < 0n;

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b, 'مقارنة');
  return a.minorUnits < b.minorUnits ? -1 : a.minorUnits > b.minorUnits ? 1 : 0;
}

/**
 * احتساب العمولة — ADR-001.
 *
 * التقريب لأسفل دائماً، لصالح البائع. القاعدة ليست تفضيلاً أخلاقياً بل
 * ضرورة حسابية: التقريب لأعلى يجعل مجموع عمولات الأسطر يتجاوز أحياناً
 * النسبة من المجموع، فينتج فرق قرش يتراكم إلى نزاع.
 *
 * تُستدعى على مستوى السطر لا الطلب.
 */
export function commissionOf(lineTotal: Money, rateBps: number): Money {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new MoneyError(`نسبة عمولة خارج المدى: ${rateBps} bps (المدى 0–10000)`);
  }
  // القسمة الصحيحة في BigInt تقرّب نحو الصفر — وهو التقريب لأسفل لمبلغ موجب
  return {
    minorUnits: (lineTotal.minorUnits * BigInt(rateBps)) / 10_000n,
    currency: lineTotal.currency,
  };
}

/** حصة نسبية من مبلغ — للاسترداد الجزئي وعكس العمولة بالنسبة نفسها. */
export function proRata(amount: Money, numerator: number, denominator: number): Money {
  if (denominator <= 0) throw new MoneyError('مقام صفري في الاحتساب النسبي');
  return {
    minorUnits: (amount.minorUnits * BigInt(numerator)) / BigInt(denominator),
    currency: amount.currency,
  };
}

/**
 * نصيب القطع المرجَعة من مبلغ سطر فيه `qty` قطعة: من القطعة `from` (ما أُرجع قبلها) إلى
 * `to` (ما أُرجع معها). بالتراكم لا بالقطعة: كل نصيب لأسفل، والقطعة الأخيرة تكمل الباقي —
 * فمجموع الأنصبة = المبلغ بالضبط مهما تفرّقت الإرجاعات.
 *
 * نصيب كل إرجاع وحده لأسفل كان يترك فرقاً يتراكم (100.00 ÷ 3 = 33.33 × 3 = 99.99)، ونصيبه
 * بالتقريب لأقرب كان يزيد: بلوزتان دُفعتا 66.17 $ فرُدّت كل واحدة 33.09 $ (J-05، 19 أكتوبر 2026).
 */
export function shareBetween(amount: bigint, from: number, to: number, qty: number): bigint {
  if (!Number.isInteger(qty) || qty <= 0 || from < 0 || to < from || to > qty) {
    throw new MoneyError(`نصيب خارج السطر: ${from}..${to} من ${qty}`);
  }
  const upTo = (k: number): bigint => (k === qty ? amount : (amount * BigInt(k)) / BigInt(qty));
  return upTo(to) - upTo(from);
}

/**
 * التحويل بين عملتين بسعر صرف **ملقوط** — ADR-013.
 *
 * السعر يُمرَّر صراحةً ولا يُقرأ من مصدر حيّ داخل الدالة: مستحقات طلب
 * تُحتسب بسعر لحظة الطلب لا بسعر اليوم. تمرير السعر إجبارياً هو ما يجعل
 * هذه القاعدة غير قابلة للنسيان.
 *
 * التقريب يقع مرة واحدة هنا، لا في كل خطوة وسيطة.
 */
export function convert(
  amount: Money,
  toCurrency: CurrencyCode,
  rateSnapshot: string | number,
): Money {
  if (amount.currency === toCurrency.toUpperCase()) return amount;

  const rate = Number(rateSnapshot);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new MoneyError(`سعر صرف غير صالح: ${rateSnapshot}`);
  }

  const fromDigits = minorUnitDigits(amount.currency);
  const toDigits = minorUnitDigits(toCurrency);

  // يُعاير فرق الخانات: 1.000 دينار ليس 1.00 دولاراً حتى لو تساوى الرقم
  const scale = 10 ** (toDigits - fromDigits);
  const converted = Number(amount.minorUnits) * rate * scale;

  return money(BigInt(Math.round(converted)), toCurrency);
}

/** هامش الصرف — Q-13، افتراضياً 200 نقطة أساس (2%). يُظهر كإيراد منفصل. */
export function applyFxSpread(amount: Money, spreadBps: number): Money {
  return {
    minorUnits: amount.minorUnits + (amount.minorUnits * BigInt(spreadBps)) / 10_000n,
    currency: amount.currency,
  };
}

/**
 * نظام الترقيم — قرار معتمد لا افتراض.
 *
 * لغة `ar` تعطي افتراضياً الأرقام الهندية (٧٠٫٩٠٠). المنصة تستعمل
 * الأرقام اللاتينية (70.900) لسببين من نظام التصميم المعتمد:
 *   1. `IBM Plex Mono` و `font-variant-numeric: tabular-nums` يصطفّان
 *      بالأرقام اللاتينية فقط — والأرقام الهندية تكسر محاذاة كل عمود
 *      في جداول اللوحات وكشوف الحسابات.
 *   2. أرقام الطلبات و SKU ورموز العملات لاتينية أصلاً، فخلط النظامين
 *      في الشاشة الواحدة يربك القراءة.
 *
 * `numberingSystem: 'arab'` متاح لمن يطلبه صراحةً، ولا يُختار ضمناً.
 */
export type NumberingSystem = 'latn' | 'arab';

export function format(
  amount: Money,
  locale = 'ar',
  numberingSystem: NumberingSystem = 'latn',
): string {
  const digits = minorUnitDigits(amount.currency);
  const divisor = 10 ** digits;
  const value = Number(amount.minorUnits) / divisor;

  return new Intl.NumberFormat(`${locale}-u-nu-${numberingSystem}`, {
    style: 'currency',
    currency: amount.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * مبلغ منسّق بلغة الطلب الجاري — لما يُعرض في ردّ: «23.000 د.أ.» بالعربية و«JOD 23.000»
 * بالإنجليزية (زرّ اللغة). متغيّرات الإشعارات تبقى على format بالعربية حتى تُرسل بلغة صاحبها.
 */
export function formatIn(minorUnits: bigint | number, currency: CurrencyCode): string {
  return format(money(minorUnits, currency), currentLocale());
}

/** للسجلات والاختبارات — بلا رمز عملة ولا محارف اتجاهية. */
export function toDecimalString(amount: Money): string {
  const digits = minorUnitDigits(amount.currency);
  if (digits === 0) return amount.minorUnits.toString();

  const negative = amount.minorUnits < 0n;
  const abs = negative ? -amount.minorUnits : amount.minorUnits;
  const s = abs.toString().padStart(digits + 1, '0');
  const whole = s.slice(0, -digits);
  const frac = s.slice(-digits);
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/**
 * التحليل من نص يكتبه إنسان — «12.500» بالدينار تعني 12500 لا 1250.
 * هذه الدالة هي الحاجز بين إدخال البائع وقاعدة البيانات.
 */
export function parse(input: string, currency: CurrencyCode): Money {
  const digits = minorUnitDigits(currency);
  const cleaned = input.replace(/[\s,٬]/g, '').replace(/٫/g, '.');

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new MoneyError(`مبلغ غير صالح: "${input}"`);
  }

  const negative = cleaned.startsWith('-');
  const [wholePart = '0', fracPart = ''] = cleaned.replace('-', '').split('.');

  if (fracPart.length > digits) {
    throw new MoneyError(
      `${currency} يقبل ${digits} خانة عشرية، والمُدخل يحمل ${fracPart.length}: "${input}"`,
    );
  }

  const padded = fracPart.padEnd(digits, '0');
  const minor = BigInt(wholePart + padded);
  return money(negative ? -minor : minor, currency);
}
