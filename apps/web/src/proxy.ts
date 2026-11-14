import { NextResponse, type NextRequest } from 'next/server';

/**
 * سياسة المحتوى — المرحلة 12، OWASP A03/A05. لا مصدر خارجي في الموقع أصلاً
 * (الخطوط والصور محلية)، فالسياسة تقول ذلك صراحةً: السكربت من الموقع نفسه،
 * والطلبات من الموقع وحده (الـ API يمرّ من /api/v1 — app/api/v1/[...path])،
 * والصور من الموقع وخادم الـ API.
 *
 * السكربت بـ nonce جديد لكل طلب لا بـ 'unsafe-inline': Next يحقن بيانات
 * التهيئة سطرياً، وكان 'unsafe-inline' يسمح معها بأي سكربت يُحقن في الصفحة —
 * فتصير أي ثغرة XSS تنفيذاً كاملاً. الآن سكربت بلا nonce الطلب لا يعمل.
 * Next يقرأ الـ nonce من ترويسة الطلب ويضعه على سكربتاته وحده (docs: CSP)،
 * ولذلك كل صفحة تُصيَّر عند الطلب (connection() في الجذر).
 *
 * 'strict-dynamic': ما يحمّله سكربت موثوق من أجزاء لاحقة موثوق مثله.
 * 'unsafe-eval' في التطوير وحده — React يعيد بناء مكدّس الأخطاء به.
 * الأنماط تبقى 'unsafe-inline': خاصية style في React لا تأخذ nonce، وحقن
 * نمط لا ينفّذ شيئاً.
 */
const dev = process.env.NODE_ENV !== 'production';
const api = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000/api/v1').origin;

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api}`,
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: http://localhost:* http://127.0.0.1:*' : ''}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  // رابط بـ % معطوبة (/p/%E0%A4%A) كان يبلغ Next فيردّ «400 Bad Request» بالإنجليزية بلا قالب الموقع.
  // إعادة الكتابة لا تكفي (Next يفكّ معاملات العنوان الأصلي فيسقط 500)، فيُحوَّل إلى مسار لا وجود له
  // فيُرسم 404 «لم نجد هذه الصفحة» داخل قشرة المتجر (DISC-063)
  try {
    decodeURIComponent(request.nextUrl.pathname);
  } catch {
    return NextResponse.redirect(new URL('/not-found', request.url));
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // الصفحات وحدها: ملفات البناء والأيقونات وعامل الخدمة لا تنفّذ سكربتاً سطرياً،
      // وممرّ الـ API (api/) يعيد ردود الـ API بترويساتها — ولا يُحمَّل جسمه في الوسيط
      source: '/((?!api/|_next/static|_next/image|icons/|sw\\.js|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest).*)',
      // الجلب المسبق يجلب بيانات لا صفحة — ولا يُرسم فلا يحتاج nonce
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
