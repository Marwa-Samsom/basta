/** @type {import('next').NextConfig} */
const nextConfig = {
  // بناء الفحص (npm run verify) يكتب في مجلد منفصل: البناء في .next نفسه الذي
  // يستعمله خادم التطوير الشغّال يُفسد حالته فيرجع 500 — وقع مرة فعلاً
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  // tokens.css يعيش خارج apps/web عمداً — مصدر حقيقة واحد يشاركه التصميم والتنفيذ
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default nextConfig;
