/**
 * تنسيق المال في الواجهة.
 * يعكس apps/api/src/common/money/money.ts — والخانات تُقرأ من العملة لا تُفترض.
 */
const MINOR_UNIT_DIGITS: Readonly<Record<string, number>> = {
  USD: 2, EUR: 2, GBP: 2, SAR: 2, AED: 2, EGP: 2, QAR: 2,
  JOD: 3, KWD: 3, BHD: 3, OMR: 3, TND: 3,
  JPY: 0, KRW: 0,
};

export function minorUnitDigits(currency: string): number {
  const digits = MINOR_UNIT_DIGITS[currency.toUpperCase()];
  if (digits === undefined) throw new Error(`عملة غير معروفة: ${currency}`);
  return digits;
}

/**
 * الأرقام اللاتينية افتراضياً ولو كانت اللغة عربية — القرار نفسه في
 * apps/api/src/common/money/money.ts. لغة `ar` تعطي الأرقام الهندية تلقائياً،
 * وهي تكسر محاذاة `tabular-nums` في كل جدول، وتختلط بأرقام الطلبات اللاتينية.
 */
export type NumberingSystem = 'latn' | 'arab';

export function formatMoney(
  minorUnits: bigint,
  currency: string,
  locale = 'ar',
  numberingSystem: NumberingSystem = 'latn',
): string {
  const digits = minorUnitDigits(currency);
  const value = Number(minorUnits) / 10 ** digits;
  return new Intl.NumberFormat(`${locale}-u-nu-${numberingSystem}`, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
