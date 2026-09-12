import type { Metadata, Viewport } from 'next';
import './globals.css';
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '@/lib/theme-colors';

export const metadata: Metadata = {
  title: { default: 'بسطة', template: '%s · بسطة' },
  description: 'سوق إلكتروني يجمع متاجر مستقلة في مكان واحد',
  formatDetection: { telephone: false },
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
      <body>{children}</body>
    </html>
  );
}
