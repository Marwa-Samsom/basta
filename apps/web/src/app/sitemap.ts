import type { MetadataRoute } from 'next';
import { API_BASE } from '@/lib/storefront';
import { SITE_URL } from '@/lib/seo';

interface SitemapData {
  products: { slug: string; updatedAt: string }[];
  shops: { slug: string; updatedAt: string }[];
  pages: { slug: string; updatedAt: string }[];
}

/**
 * خريطة الموقع الديناميكية — المرحلة 12. تُولَّد عند الطلب وتُخزَّن ساعة:
 * منتج نُشر اليوم يظهر فيها اليوم لا بعد بناء جديد.
 */
// عند الطلب لا وقت البناء: البناء لا يعتمد على API حيّ (كشفه CI). بيانات الجلب
// نفسها تُخزَّن ساعة عبر next.revalidate
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // الفشل يُرمى لا يُستبدل بخريطة فارغة: الفارغة تُخزَّن ساعة فيظنّ المحرّك أن الموقع خلا
  const res = await fetch(`${API_BASE}/storefront/sitemap`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`تعذّر جلب خريطة الموقع: ${res.status}`);
  const data = (await res.json()) as SitemapData;
  const at = (p: string) => `${SITE_URL}${p}`;
  return [
    { url: at('/'), changeFrequency: 'daily', priority: 1 },
    { url: at('/shops'), changeFrequency: 'daily', priority: 0.7 },
    ...data.products.map((p) => ({ url: at(`/p/${encodeURIComponent(p.slug)}`), lastModified: new Date(p.updatedAt), changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...data.shops.map((s) => ({ url: at(`/s/${encodeURIComponent(s.slug)}`), lastModified: new Date(s.updatedAt), changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...data.pages.map((p) => ({ url: at(`/pages/${encodeURIComponent(p.slug)}`), lastModified: new Date(p.updatedAt), changeFrequency: 'monthly' as const, priority: 0.3 })),
  ];
}
