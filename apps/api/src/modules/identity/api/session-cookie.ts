/**
 * رمز التحديث يعيش في كوكي HttpOnly لا في جسم الردّ.
 *
 * كان يصل في الجسم فتحفظه الواجهة في localStorage — وأي سكربت يُحقن في الصفحة
 * يقرؤه ويرسله: جلسة ثلاثين يوماً تُسرق بسطر. الكوكي لا يراه JavaScript أصلاً،
 * والمتصفّح يرسله وحده إلى مسارات /auth وحدها (Path) ومن الموقع نفسه وحده
 * (SameSite=Strict). رمز الوصول يبقى في الجسم: عمره ربع ساعة ويُفحص مع القاعدة.
 *
 * شرط النشر: الواجهة والـ API من «موقع» واحد (basta.com و api.basta.com) —
 * وإلا لا يرسل المتصفّح الكوكي مع طلب fetch أصلاً.
 */
export const REFRESH_COOKIE = 'basta_rt';
const PATH = '/api/v1/auth';

/** Secure في الإنتاج وحده: التطوير على http://127.0.0.1 والمتصفّح لا يحفظ Secure عليه دائماً */
const secure = () => process.env['NODE_ENV'] === 'production';

function attributes(maxAgeSeconds: number): string {
  return [`Path=${PATH}`, `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Strict', ...(secure() ? ['Secure'] : [])].join('; ');
}

export function refreshCookie(token: string, maxAgeMs: number): string {
  return `${REFRESH_COOKIE}=${token}; ${attributes(Math.floor(maxAgeMs / 1000))}`;
}

export function clearedRefreshCookie(): string {
  return `${REFRESH_COOKIE}=; ${attributes(0)}`;
}

/** الرمز base64url فلا يحتاج فكّ ترميز؛ ما سواه ليس رمزنا */
export function readRefreshCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== REFRESH_COOKIE) continue;
    const value = rest.join('=');
    return /^[A-Za-z0-9_-]{16,256}$/.test(value) ? value : null;
  }
  return null;
}
