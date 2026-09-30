/**
 * مسار داخل الموقع أو لا شيء — لكل وجهة تأتي من خارج الكود: `next` في الرابط،
 * ورابط البانر المحفوظ.
 *
 * فحص البادئة وحده لا يكفي: المتصفح يحذف التاب وسطر الجديد من الرابط قبل
 * تحليله، ويقرأ `\` كأنها `/` — فـ `/%09/evil.com` يصير بعد فكّ الترميز
 * `/<تاب>/evil.com` ثم `//evil.com`، أي موقعاً آخر. لذا يُرفض كل محرف تحكّم
 * أو مسافة وكل `\`، ثم يُحلَّل المسار على أصل وهمي ويجب أن يبقى عليه.
 * نسخة الخادم: `isInternalPath` في content.service.ts — القاعدة نفسها.
 */
const ORIGIN = 'https://basta.invalid';

export function internalPath(raw: string | null | undefined): string | null {
  if (!raw || raw[0] !== '/') return null;
  if (/[\x00-\x20\x7f\\]/.test(raw)) return null;
  try {
    return new URL(raw, ORIGIN).origin === ORIGIN ? raw : null;
  } catch {
    return null;
  }
}

/** وجهة «التالي» من الرابط — مسار داخلي أو البديل */
export function safeNext(raw: string | null, fallback: string): string {
  return internalPath(raw) ?? fallback;
}
