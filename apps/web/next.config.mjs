import { fileURLToPath } from 'node:url';

/**
 * سياسة المحتوى — المرحلة 12، OWASP A03/A05. لا مصدر خارجي في الموقع أصلاً
 * (الخطوط والصور محلية)، فالسياسة تقول ذلك صراحةً: السكربت من الموقع نفسه،
 * والصور والطلبات من الموقع وخادم الـ API وحده. 'unsafe-inline' للسكربت لأن
 * Next يحقن بيانات التهيئة سطرياً، و 'unsafe-eval' في التطوير وحده.
 */
const dev = process.env.NODE_ENV !== 'production';

/**
 * عنوان الـ API يُخبَز في حزمة المتصفّح وقت البناء لا وقت التشغيل. بناء إنتاج
 * بلا عنوان كان يسقط صامتاً إلى 127.0.0.1 — فيرسل موقع الإنتاج طلباته إلى جهاز
 * الزائر نفسه. الغياب يُسقط البناء بدل ذلك.
 */
if (!dev && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL مطلوب لبناء الإنتاج — يُخبَز في الحزمة وقت البناء.');
}
const api = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000/api/v1').origin;
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${api}`,
  "font-src 'self' data:",
  `connect-src 'self' ${api}${dev ? ' ws: http://localhost:* http://127.0.0.1:*' : ''}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // بناء الفحص (npm run verify) يكتب في مجلد منفصل: البناء في .next نفسه الذي
  // يستعمله خادم التطوير الشغّال يُفسد حالته فيرجع 500 — وقع مرة فعلاً
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // صورة Docker تشغّل الخادم المستقل (.next/standalone/apps/web/server.js) بلا
  // node_modules كاملة؛ محلياً يبقى `next start` — والمستقل يُطلب صراحةً من الـ Dockerfile
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  // tokens.css يعيش خارج apps/web عمداً — مصدر حقيقة واحد يشاركه التصميم والتنفيذ
  // fileURLToPath لا .pathname: على ويندوز يعطي pathname مسار URL «/C:/Users/…»
  // الذي لا يصلح مساراً للنظام — Next 15 تساهل معه، و Turbopack في 16 يرفضه
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
        ],
      },
    ];
  },
};
export default nextConfig;
