import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

/** ما يخصّ صاحبه لا يُفهرس: السلة والدفع والحساب واللوحتان */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/cart', '/checkout', '/orders/', '/account/', '/vendor', '/admin', '/login', '/register', '/search?'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
