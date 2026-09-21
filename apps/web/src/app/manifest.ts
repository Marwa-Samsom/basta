import type { MetadataRoute } from 'next';
import { THEME_BRAND, THEME_COLOR_LIGHT } from '@/lib/theme-colors';

/** تثبيت على الشاشة — المرحلة 12. يفتح على المتجر، باتجاه الكتابة العربي */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'بسطة — سوق المتاجر المستقلة',
    short_name: 'بسطة',
    description: 'سوق إلكتروني يجمع متاجر مستقلة في مكان واحد',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: THEME_COLOR_LIGHT,
    theme_color: THEME_BRAND,
    categories: ['shopping'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
