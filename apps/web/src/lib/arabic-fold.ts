/**
 * توحيد الحروف للبحث داخل المتصفّح — نسخة من apps/api/src/common/arabic-fold.ts حرفاً بحرف:
 * الخادم يبحث بالعمود الموحَّد، والصفحة التي تُبقي نتائج سابقة على الشاشة حتى تصل الجديدة
 * تصفّيها بالقاعدة نفسها، وإلا أخفت «الاولى» ما وجده الخادم من «الأولى» (4 نوفمبر 2026).
 */

/** التطويل، والتشكيل (فتحتان…سكون)، والألف الخنجرية، والهمزة المفردة — تُحذف */
const STRIP = new RegExp(`[${String.fromCodePoint(0x640, 0x64b)}-${String.fromCodePoint(0x652, 0x670, 0x621)}]`, 'g');

/** أ إ آ ٱ ← ا، ى ← ي، ة ← ه، ؤ ← و، ئ ← ي، ی ← ي، ک ← ك، والأرقام الهندية والفارسية ← 0-9 */
export const FOLD_FROM = 'أإآٱىةؤئیک٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
export const FOLD_TO = 'اااايهوييك0123456789' + '0123456789';

export function fold(text: string): string {
  let out = '';
  for (const ch of text.replace(STRIP, '')) {
    const i = FOLD_FROM.indexOf(ch);
    out += i < 0 ? ch : FOLD_TO[i];
  }
  return out.toLowerCase();
}
