import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
// الخطوط مستضافة ذاتياً: سياسة المحتوى لا تسمح بخطوط من أصل آخر، والمشروع محلي
// بلا اعتماد على شبكة خارجية.
//
// الأوزان أقلّ ما يحفظ الشكل — كل وزن ملفّ يتسابق مع صورة المنتج على شبكة الجوال
// (قيس LCP بعد تطبيق التصميم: الخطوط 299 كيلوبايت، ضعف السكربتات). الوزن الغائب
// يأخذه المتصفّح من أقرب وزن بلا تسميك مصطنع: Almarai 700 ← 800، و 500 ← 400.
import '@fontsource/almarai/800.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './globals.css';
// أنماط الحساب والصفحات المشتركة (الدخول، التسجيل، بلا اتصال، الخطأ) — تظهر خارج
// الأقسام كلها. أنماط كل قسم تُستورد في قشرته وحدها: المشتري لا ينزّل أنماط اللوحات.
import '@/styles/screens/account-shared.css';
import { ConfirmProvider } from '@/components/confirm';
import { IconSprite } from '@/components/icons';
import { SessionExpiredRedirect } from '@/components/session-expired';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { SITE_URL } from '@/lib/seo';
import { THEME_BOOT } from '@/lib/theme';
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '@/lib/theme-colors';

export const metadata: Metadata = {
  title: { default: 'بسطة', template: '%s · بسطة' },
  description: 'سوق إلكتروني يجمع متاجر مستقلة في مكان واحد',
  formatDetection: { telephone: false },
  metadataBase: new URL(SITE_URL),
  applicationName: 'بسطة',
  appleWebApp: { capable: true, title: 'بسطة', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  openGraph: { siteName: 'بسطة', locale: 'ar', type: 'website' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR_DARK },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // كل صفحة تُصيَّر عند الطلب: سياسة المحتوى تحمل nonce جديداً لكل طلب
  // (src/proxy.ts)، وصفحة مبنية سلفاً لا تعرفه فتُحجب سكربتاتها كلها
  await connection();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // lang و dir على عنصر html — أساس RTL لا خاصية CSS. و data-theme يضعه سكربت
  // الوضع قبل الترطيب، فيختلف عن مصدر الخادم عمداً (lib/theme)
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <IconSprite />
        {/* نافذة تأكيد واحدة للموقع كله بلغة الصفحة — بدل window.confirm (components/confirm) */}
        <ConfirmProvider>{children}</ConfirmProvider>
        <SessionExpiredRedirect />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
