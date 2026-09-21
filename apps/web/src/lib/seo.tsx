import { minorUnitDigits } from './money';
import { imageUrl, type ProductPage, type ShopPage } from './storefront';

/**
 * SEO تقني — المرحلة 12. البيانات المنظّمة (Schema.org) تُصيَّر في مصدر
 * HTML مع الصفحة، فيقرأ محرّك البحث السعر والتوفّر والتقييم بلا تشغيل سكربت.
 */
export const SITE_URL = (process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');

/** المبلغ بخانات عملته كما يطلبه Schema.org — نصّ لا عدد عشري */
function decimal(minor: string, currency: string): string {
  const d = minorUnitDigits(currency);
  const v = BigInt(minor);
  if (d === 0) return v.toString();
  const s = v.toString().padStart(d + 1, '0');
  return `${s.slice(0, -d)}.${s.slice(-d)}`;
}

export function productJsonLd(p: ProductPage): Record<string, unknown> {
  const prices = p.variants.map((v) => BigInt(v.price.minorUnits));
  const low = prices.length ? prices.reduce((a, b) => (b < a ? b : a)) : BigInt(p.priceFrom.minorUnits);
  const high = prices.length ? prices.reduce((a, b) => (b > a ? b : a)) : low;
  const availability = p.isSoldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock';
  const url = `${SITE_URL}/p/${encodeURIComponent(p.slug)}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.nameAr,
    ...(p.nameEn ? { alternateName: p.nameEn } : {}),
    ...(p.descriptionAr ? { description: p.descriptionAr.slice(0, 5000) } : {}),
    url,
    image: p.images.map((i) => imageUrl(i.urls['full'] ?? null)).filter(Boolean),
    sku: p.variants[0]?.sku,
    category: p.category.nameAr,
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand.nameAr } } : {}),
    offers:
      low === high
        ? { '@type': 'Offer', url, price: decimal(low.toString(), p.currency), priceCurrency: p.currency, availability, seller: { '@type': 'Organization', name: p.vendor.nameAr } }
        : {
            '@type': 'AggregateOffer',
            url,
            lowPrice: decimal(low.toString(), p.currency),
            highPrice: decimal(high.toString(), p.currency),
            priceCurrency: p.currency,
            offerCount: p.variants.length,
            availability,
            seller: { '@type': 'Organization', name: p.vendor.nameAr },
          },
  };
}

export function shopJsonLd(s: ShopPage): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: s.vendor.nameAr,
    ...(s.vendor.nameEn ? { alternateName: s.vendor.nameEn } : {}),
    ...(s.vendor.descriptionAr ? { description: s.vendor.descriptionAr.slice(0, 5000) } : {}),
    url: `${SITE_URL}/s/${encodeURIComponent(s.vendor.slug)}`,
    ...(s.vendor.ratingCount > 0
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: s.vendor.ratingAvg.toFixed(1), reviewCount: s.vendor.ratingCount } }
      : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE_URL}${it.path}` })),
  };
}

/**
 * يُدرج JSON-LD في المصدر. `<` يُهرَّب: وصف بائع فيه «</script>» كان سيُغلق
 * الوسم ويحقن ما بعده — XSS من حقل نصّي عادي.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
