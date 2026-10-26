import type { Metadata } from 'next';
import Link from 'next/link';
import '@/styles/screens/storefront-extra.css';
import { AskShop } from '@/components/ask-shop';
import { CompareBar, CompareToggle } from '@/components/compare';
import { Icon } from '@/components/icons';
import { RecordView } from '@/components/recent';
import { Crumbs } from '@/components/listing';
import { ProductGrid } from '@/components/product-card';
import { ProductReviews } from '@/components/product-reviews';
import { requestCurrency } from '@/lib/currency-server';
import { getProduct, getProductReviews, getShop, imageUrl, num } from '@/lib/storefront';
import { ProductGallery, ProductSelection, VariantPicker, type GalleryImage } from '@/components/variant-picker';
import { WishHeart } from '@/components/wish-heart';
import { JsonLd, SITE_URL, breadcrumbJsonLd, productJsonLd } from '@/lib/seo';

type Params = { params: Promise<{ slug: string }> };

/** «المزيد من المتجر» — سطر واحد من البطاقات */
const MORE_FROM_SHOP = 4;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  // بعملة الصفحة نفسها: الطلب واحد يخدم البيانات الوصفية والصفحة
  const product = await getProduct(slug, await requestCurrency());
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
  const currency = await requestCurrency();
  const product = await getProduct(slug, currency);

  // منتجات أخرى من المتجر نفسه، ومراجعات المنتج — تحسين لا شرط: تعذّر جلبهما لا يُسقط الصفحة
  const [shop, reviews] = await Promise.all([
    getShop(product.vendor.slug, { currency }).catch(() => null),
    getProductReviews(product.id).catch(() => null),
  ]);
  const more = (shop?.products ?? []).filter((p) => p.id !== product.id).slice(0, MORE_FROM_SHOP);

  const images: GalleryImage[] = product.images.map((img) => ({
    id: img.id,
    alt: img.altAr ?? product.nameAr,
    full: imageUrl(img.urls['full'] ?? null) ?? '',
    thumb: imageUrl(img.urls['thumb'] ?? img.urls['full'] ?? null) ?? '',
    avif: imageUrl(img.urls['avif'] ?? null),
    medium: imageUrl(img.urls['medium'] ?? null),
    mediumAvif: imageUrl(img.urls['mediumAvif'] ?? null),
    variantId: img.variantId,
    optionValueId: img.optionValueId,
  }));
  // قيم كل متغيّر — المعرض يقفز إلى صورة اللون المختار إن ربطها البائع به
  const variantValues = Object.fromEntries(product.variants.map((v) => [v.id, v.options.map((o) => o.valueId)]));

  // ST-24 و ST-10: ما يُحفظ في الجهاز — المعرّف والاسم والصورة، لا السعر
  const thumb = product.images[0]?.urls['thumb'] ?? null;

  // مسار التنقّل: المتجر ← فئته في المتجر ← المنتج (الفئات لكل متجر — 14 أكتوبر 2026)
  const shopPath = `/s/${encodeURIComponent(product.vendor.slug)}`;
  const category = product.storeCategory;
  const categoryPath = category ? `${shopPath}?category=${category.id}` : null;

  return (
    <article className="sd-pdp">
      <RecordView slug={product.slug} nameAr={product.nameAr} thumb={thumb} />
      <JsonLd
        data={[
          productJsonLd(product),
          breadcrumbJsonLd([
            { name: 'الرئيسية', path: '/' },
            { name: product.vendor.nameAr, path: shopPath },
            ...(category && categoryPath ? [{ name: category.nameAr, path: categoryPath }] : []),
            { name: product.nameAr, path: `/p/${product.slug}` },
          ]),
        ]}
      />
      <Crumbs
        items={[
          { href: '/', label: 'الرئيسية' },
          { href: shopPath, label: product.vendor.nameAr },
          ...(category && categoryPath ? [{ href: categoryPath, label: category.nameAr }] : []),
          { label: product.nameAr },
        ]}
      />

      {/* الاختيار والمعرض يتشاركان المتغيّر المختار — بينهما محتوى خادم يبقى خادماً */}
      <ProductSelection initial={product.variants[0]?.id ?? ''}>
      <div className="sd-pdp__layout">
        <ProductGallery images={images} name={product.nameAr} soldOut={product.isSoldOut} variantValues={variantValues} />

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
              <p>البائع لم يُعِد تزويده بعد. تصفّح منتجات مشابهة في المتجر نفسه.</p>
              <Link className="btn btn--secondary btn--sm" href={categoryPath ?? shopPath}>
                {category ? `المزيد من «${category.nameAr}»` : 'منتجات المتجر'}
              </Link>
            </div>
          ) : null}

          <VariantPicker
            variants={product.variants}
            actions={
              <>
                <WishHeart productId={product.id} name={product.nameAr} variant="pdp" />
                <CompareToggle item={{ slug: product.slug, nameAr: product.nameAr, thumb }} />
              </>
            }
          />

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

          {/* ST-09 — السؤال يُرسل إلى «رسائلي» مرفقاً بالمنتج */}
          <AskShop
            context={{ productId: product.id }}
            shopName={product.vendor.nameAr}
            subjectName={product.nameAr}
            subjectSub={`من ${product.vendor.nameAr}`}
            thumb={imageUrl(thumb)}
            triggerLabel="اسأل المتجر عن هذا المنتج"
          />
        </div>
      </div>
      </ProductSelection>

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

      {reviews ? <ProductReviews productId={product.id} initial={reviews} /> : null}

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

      <CompareBar />
    </article>
  );
}
