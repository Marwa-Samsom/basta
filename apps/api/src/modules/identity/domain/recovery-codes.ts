import { randomInt } from 'node:crypto';

/**
 * رموز استعادة التحقق الثنائي — طريق العودة لمن أضاع جهاز المصادقة.
 *
 * عشرة رموز تُعطى مرة واحدة عند التفعيل، كلٌّ لدخول واحد بدل رمز التطبيق.
 * الشكل `XXXXX-XXXXX` من أبجدية بلا حروف ملتبسة (لا 0/O ولا 1/I/L): تُنسخ من
 * ورقة مطبوعة وتُقرأ بالهاتف. عشرة محارف من 31 = نحو 49 بتاً لكل رمز، وحدّ
 * محاولات الدخول (10 في ربع ساعة) يجعل التخمين المباشر بلا معنى.
 */

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const HALF = 5;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const one = () => Array.from({ length: HALF * 2 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const codes = new Set<string>();
  while (codes.size < count) {
    const raw = one();
    codes.add(`${raw.slice(0, HALF)}-${raw.slice(HALF)}`);
  }
  return [...codes];
}

/**
 * الصيغة المعيارية للمقارنة: أحرف كبيرة بلا شرطة ولا مسافات. المستخدم يكتب
 * الرمز كما يقرأه — بشرطة أو بدونها، صغيراً أو كبيراً — والتجزئة تُحسب دائماً
 * على الصيغة نفسها.
 */
export const normalizeRecoveryCode = (input: string): string => input.replace(/[\s-]/g, '').toUpperCase();

/** رمز التطبيق ستة أرقام؛ رمز الاستعادة عشرة محارف من الأبجدية — لا يلتبسان */
export const looksLikeRecoveryCode = (input: string): boolean =>
  new RegExp(`^[${ALPHABET}]{${HALF * 2}}$`).test(normalizeRecoveryCode(input));
