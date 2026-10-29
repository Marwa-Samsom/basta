/**
 * العدد ومعدوده بالعربية — كانت النصوص تلصق «ساعة» و«أيام» بعد أي رقم: «خلال 6 ساعة»، «منذ 11 أيام»،
 * «منذ 1 أيام» (VOPS-019، 29 أكتوبر 2026). القاعدة: الواحد والاثنان بلفظهما، ومن 3 إلى 10 جمعٌ،
 * ومن 11 إلى 99 مفردٌ منصوب، والمئة فما فوق مفردٌ مجرور.
 */
function counted(n: number, one: string, two: string, plural: string, accusative: string, genitive: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  const tail = n % 100;
  if (tail >= 3 && tail <= 10) return `${n} ${plural}`;
  if (tail >= 11 && tail <= 99) return `${n} ${accusative}`;
  return `${n} ${genitive}`;
}

/** «ساعة واحدة»، «ساعتين»، «6 ساعات»، «48 ساعة» */
export const hoursAr = (n: number): string => counted(n, 'ساعة واحدة', 'ساعتين', 'ساعات', 'ساعة', 'ساعة');

/** «يوم واحد»، «يومين»، «4 أيام»، «14 يوماً»، «100 يوم» */
export const daysAr = (n: number): string => counted(n, 'يوم واحد', 'يومين', 'أيام', 'يوماً', 'يوم');

// رقم لا يسبقه رقم أو فاصلة عشرية، يليه المعدود كلمةً تامّة
const HOURS = /(?<![\d.,٫])(\d+) (?:ساعة|ساعات)(?![ء-ي])/g;
const DAYS = /(?<![\d.,٫])(\d+) (?:أيام|يوماً|يوم)(?![ء-ي])/g;

/**
 * يصحّح العدد ومعدوده في نصّ جاهز — لقوالب الإشعارات: نصوصها في القاعدة تُزرع مرة ولا يكتب
 * الكود فوقها (ولا فوق تعديل الإدارة)، فـ«{{hours}} ساعة» فيها تُصحَّح بعد ملء المتغيّر.
 */
export function arabicCounts(text: string): string {
  return text.replace(HOURS, (_, n: string) => hoursAr(Number(n))).replace(DAYS, (_, n: string) => daysAr(Number(n)));
}
