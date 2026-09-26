import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Crumbs } from '@/components/listing';
import { ProductGrid } from '@/components/product-card';
import { getProduct, getShop, imageUrl, num } from '@/lib/storefront';
import { ProductGallery, VariantPicker, type GalleryImage } from '@/components/variant-picker';
import { JsonLd, SITE_URL, breadcrumbJsonLd, productJsonLd } from '@/lib/seo';

type Params = { params: Promise<{ slug: string }> };

/** «المزيد من المتجر» — سطر واحد من البطاقات */
const MORE_FROM_SHOP = 4;

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
 * في مصدر HTML قبل تشغيل أي سكربت. اختيار المتغيّر والمعرض وحدهما عميل،
 * ويُصيَّران مسبقاً بالمتغيّر الأرخص والغلاف فيظهر سعر وصورة حقيقيان قبل أن يعملا.
 */
export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const product = await getProduct(slug);

  // منتجات أخرى من المتجر نفسه — تحسين لا شرط: تعذّر جلبها لا يُسقط الصفحة
  const shop = await getShop(product.vendor.slug).catch(() => null);
  const more = (shop?.products ?? []).filter((p) => p.id !== product.id).slice(0, MORE_FROM_SHOP);

  const images: GalleryImage[] = product.images.map((img) => ({
    id: img.id,
    alt: img.altAr ?? product.nameAr,
    full: imageUrl(img.urls['full'] ?? null) ?? '',
    thumb: imageUrl(img.urls['thumb'] ?? img.urls['full'] ?? null) ?? '',
    avif: imageUrl(img.urls['avif'] ?? null),
    medium: imageUrl(img.urls['medium'] ?? null),
    mediumAvif: imageUrl(img.urls['mediumAvif'] ?? null),
  }));

  return (
    <article className="sd-pdp">
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
      <Crumbs
        items={[
          { href: '/', label: 'الرئيسية' },
          { href: `/c/${product.category.slug}`, label: product.category.nameAr },
          { label: product.nameAr },
        ]}
      />

      <div className="sd-pdp__layout">
        <ProductGallery images={images} name={product.nameAr} soldOut={product.isSoldOut} />

        <div className="sd-pdp__info">
          <div className="sd-pdp__titles">
            <h1 className="sd-pdp__name">{product.nameAr}</h1>
            {product.nameEn ? (
              <p className="sd-pdp__en" dir="ltr" lang="en">
                {product.nameEn}
              </p>
            ) : null}
            <div className="sd-pdp__byline">
              <Link href={`/s/${product.vendor.slug}`} className="sd-pdp__shop">
                <Icon name="store" size={15} />
                {product.vendor.nameAr}
              </Link>
              {product.vendor.ratingCount > 0 ? (
                <span className="sd-rating">
                  <Icon name="star-fill" size={15} className="sd-rating__star" />
                  <span className="num sd-rating__avg">{product.vendor.ratingAvg.toFixed(1)}</span>
                  <span className="sd-rating__count">
                    تقييم المتجر من <span className="num">{num(product.vendor.ratingCount)}</span>
                  </span>
                </span>
              ) : null}
            </div>
          </div>

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

          <section className="sd-policy" aria-label="الشحن والإرجاع">
            <div className="sd-policy__row">
              <Icon name="truck" size={17} />
              <p>{product.vendor.shippingPolicyAr ?? 'يحدّد البائع مدّة الشحن عند الطلب.'}</p>
            </div>
            <div className="sd-policy__row">
              <Icon name="return" size={17} />
              <p>{product.vendor.returnPolicyAr ?? 'سياسة الإرجاع العامة في بسطة تسري.'}</p>
            </div>
          </section>
        </div>
      </div>

      {product.descriptionAr ? (
        <section className="sd-pdp__block" aria-labelledby="sd-desc">
          <h2 id="sd-desc" className="sd-pdp__tabs">
            <span className="sd-pdp__tab">الوصف</span>
          </h2>
          <p className="sd-pdp__desc">{product.descriptionAr}</p>
        </section>
      ) : null}

      {product.attributes.length > 0 ? (
        <section className="sd-pdp__block" aria-labelledby="sd-specs">
          <h2 id="sd-specs" className="sd-pdp__tabs">
            <span className="sd-pdp__tab">المواصفات</span>
          </h2>
          <dl className="sd-specs">
            {product.attributes.map((a) => (
              <div key={a.attributeId} className="sd-specs__row">
                <dt>{a.nameAr}</dt>
                <dd>{a.valueAr ?? a.number ?? (a.boolean === null ? '—' : a.boolean ? 'نعم' : 'لا')}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {more.length > 0 ? (
        <section className="sd-section" aria-labelledby="sd-more">
          <div className="sd-section__head">
            <h2 id="sd-more" className="sd-section__title">
              المزيد من {product.vendor.nameAr}
            </h2>
            <Link href={`/s/${product.vendor.slug}`} className="sd-section__link">
              كل منتجات المتجر
              <Icon name="chev-end" size={14} mirror />
            </Link>
          </div>
          <ProductGrid products={more} />
        </section>
      ) : null}
    </article>
  );
}
