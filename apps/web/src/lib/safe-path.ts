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

/**
 * البيت بعد الدخول حين لا يحدّد الرابط وجهة — بحسب من دخل. كانت الوجهة ثابتة على
 * تأهيل البائع، فيصل كل مشترٍ جديد إلى «سجّل متجرك». الأدوار من الرمز
 * (`session.roles()`) لقرار العرض وحده؛ لوحة البائع نفسها تحيل من لم يُكمل تأهيله.
 */
export function homeFor(roles: readonly string[]): string {
  if (roles.includes('admin')) return '/admin';
  if (roles.includes('vendor_owner') || roles.includes('vendor_staff')) return '/vendor';
  return '/account';
}

/**
 * رابط صفحة يحمل `next` إليها — بين الدخول والتسجيل والاستعادة لا تضيع الوجهة
 * التي جاء الزائر من أجلها (بائع من «ابدأ البيع» يُكمل إلى تسجيل متجره). مسار
 * داخلي وحده يُحمل؛ غيره يُسقط.
 */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = internalPath(next);
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}
