import type { Metadata } from 'next';
import Link from 'next/link';
import { getProduct, imageUrl, num } from '@/lib/storefront';
import { VariantPicker } from '@/components/variant-picker';
import { JsonLd, SITE_URL, breadcrumbJsonLd, productJsonLd } from '@/lib/seo';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  return {
    title: product.nameAr,
    description: product.descriptionAr?.slice(0, 160) ?? `${product.nameAr} من ${product.vendor.nameAr}`,
    alternates: { canonical: `${SITE_URL}/p/${encodeURIComponent(product.slug)}` },
    openGraph: {
      type: 'website',
      locale: 'ar',
      title: product.nameAr,
      url: `${SITE_URL}/p/${encodeURIComponent(product.slug)}`,
      ...(product.images[0]?.urls['full'] ? { images: [imageUrl(product.images[0].urls['full'])!] } : {}),
    },
  };
}

/**
 * ST-07 — صفحة المنتج، و ST-08 حالة النفاد.
 *
 * **مكوّن خادم.** بوابة المرحلة 07 البند الرابع: الاسم والسعر والوصف والبائع
 * في مصدر HTML قبل تشغيل أي سكربت. اختيار المتغيّر وحده عميل، ويُصيَّر مسبقاً
 * بالمتغيّر الأرخص فيظهر سعر حقيقي حتى قبل أن يعمل.
 */
export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const product = await getProduct(slug);
  const cover = product.images[0];

  return (
    <article className="product">
      <JsonLd
        data={[
          productJsonLd(product),
          breadcrumbJsonLd([
            { name: 'الرئيسية', path: '/' },
            { name: product.category.nameAr, path: `/c/${product.category.slug}` },
            { name: product.nameAr, path: `/p/${product.slug}` },
          ]),
        ]}
      />
      <nav className="small muted" aria-label="مسار التصفّح">
        <Link href="/">الرئيسية</Link> · <Link href={`/c/${product.category.slug}`}>{product.category.nameAr}</Link>
      </nav>

      <div className="product__layout">
        <div className="product__media">
          {cover ? (
            /*
             * صورة الغلاف هي LCP الصفحة (المرحلة 12): الهاتف يأخذ 800 بكسل
             * بصيغة AVIF، والشاشة الواسعة 1600، وWebP احتياط لما لا يقرأ AVIF.
             * أولوية جلب عالية — تبدأ قبل السكربتات لا بعدها.
             */
            <picture>
              {cover.urls['mediumAvif'] ? <source media="(max-width: 767px)" type="image/avif" srcSet={imageUrl(cover.urls['mediumAvif']) ?? ''} /> : null}
              {cover.urls['medium'] ? <source media="(max-width: 767px)" type="image/webp" srcSet={imageUrl(cover.urls['medium']) ?? ''} /> : null}
              {cover.urls['avif'] ? <source type="image/avif" srcSet={imageUrl(cover.urls['avif']) ?? ''} /> : null}
              <img
                src={imageUrl(cover.urls['full'] ?? null) ?? ''}
                alt={cover.altAr ?? product.nameAr}
                width={800}
                height={800}
                fetchPriority="high"
                decoding="async"
              />
            </picture>
          ) : (
            <div className="product__placeholder" aria-hidden>
              {product.nameAr.slice(0, 1)}
            </div>
          )}
        </div>

        <div className="product__info stack">
          <h1>{product.nameAr}</h1>
          {product.nameEn ? (
            <p className="muted" dir="ltr" lang="en">
              {product.nameEn}
            </p>
          ) : null}

          <p className="small">
            من{' '}
            <Link href={`/s/${product.vendor.slug}`}>{product.vendor.nameAr}</Link>
            {product.vendor.ratingCount > 0 ? (
              <span className="muted">
                {' '}· تقييم <span className="num">{product.vendor.ratingAvg.toFixed(1)}</span> من{' '}
                <span className="num">{num(product.vendor.ratingCount)}</span>
              </span>
            ) : null}
          </p>

          {product.isSoldOut ? (
            <div className="alert alert--warning" role="status">
              <p className="alert__title">نفد هذا المنتج</p>
              <p>البائع لم يُعِد تزويده بعد. تصفّح منتجات مشابهة في الفئة نفسها.</p>
              <Link className="btn btn--secondary btn--sm" href={`/c/${product.category.slug}`}>
                منتجات مشابهة
              </Link>
            </div>
          ) : null}

          <VariantPicker variants={product.variants} />

          {product.descriptionAr ? (
            <section className="stack stack--tight">
              <h2>الوصف</h2>
              <p className="product__desc">{product.descriptionAr}</p>
            </section>
          ) : null}

          {product.attributes.length > 0 ? (
            <section className="stack stack--tight">
              <h2>المواصفات</h2>
              <dl className="specs">
                {product.attributes.map((a) => (
                  <div key={a.attributeId} className="specs__row">
                    <dt>{a.nameAr}</dt>
                    <dd>{a.valueAr ?? a.number ?? (a.boolean === null ? '—' : a.boolean ? 'نعم' : 'لا')}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section className="stack stack--tight">
            <h2>الشحن والإرجاع</h2>
            <p className="small">{product.vendor.shippingPolicyAr ?? 'يحدّد البائع مدّة الشحن عند الطلب.'}</p>
            <p className="small">{product.vendor.returnPolicyAr ?? 'سياسة الإرجاع العامة في بسطة تسري.'}</p>
          </section>
        </div>
      </div>
    </article>
  );
}
