import type { Metadata, Viewport } from 'next';
// الخطوط مستضافة ذاتياً: سياسة المحتوى لا تسمح بخطوط من أصل آخر، والمشروع محلي
// بلا اعتماد على شبكة خارجية. الأوزان هي التي يستعملها التصميم وحدها.
import '@fontsource/almarai/400.css';
import '@fontsource/almarai/700.css';
import '@fontsource/almarai/800.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './globals.css';
// أنماط الشاشات بحسب ملفات التصميم — بعد الأساس لتبني عليه
import '@/styles/screens/storefront-discovery.css';
import '@/styles/screens/storefront-purchase.css';
import '@/styles/screens/account-shared.css';
import '@/styles/screens/vendor-onboarding.css';
import '@/styles/screens/vendor-products.css';
import '@/styles/screens/vendor-orders-money.css';
import '@/styles/screens/admin-operations.css';
import '@/styles/screens/admin-catalog-system.css';
import { IconSprite } from '@/components/icons';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { SITE_URL } from '@/lib/seo';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang و dir على عنصر html — أساس RTL لا خاصية CSS
  return (
    <html lang="ar" dir="rtl">
      <body>
        <IconSprite />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
