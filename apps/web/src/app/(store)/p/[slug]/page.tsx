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
import { pageCurrency } from '@/lib/currency-server';
import { nameIn, translator, type Locale } from '@/lib/i18n';
import { pageLocale } from '@/lib/i18n-server';
import { getProduct, getProductReviews, getShop, imageUrl, num, type ProductPage as Product } from '@/lib/storefront';
import { ProductGallery, ProductSelection, VariantPicker, type GalleryImage } from '@/components/variant-picker';
import { WishHeart } from '@/components/wish-heart';
import { JsonLd, SITE_URL, breadcrumbJsonLd, productJsonLd } from '@/lib/seo';

type Params = { params: Promise<{ slug: string }> };

/** «المزيد من المتجر» — سطر واحد من البطاقات */
const MORE_FROM_SHOP = 4;

/** الاسم والوصف بلغة الصفحة: الإنجليزي إن كتبه البائع، وإلا العربي */
function texts(product: Product, locale: Locale) {
  const en = locale === 'en';
  // descriptionEn ليس في نوع الصفحة بعد — يُقرأ إن أرسله الخادم
  const descriptionEn = (product as Product & { descriptionEn?: string | null }).descriptionEn ?? null;
  return {
    name: en && product.nameEn ? product.nameEn : product.nameAr,
    description: en && descriptionEn ? descriptionEn : product.descriptionAr,
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  // بعملة الصفحة نفسها: الطلب واحد يخدم البيانات الوصفية والصفحة
  const locale = await pageLocale();
  const product = await getProduct(slug, await pageCurrency(), locale);
  const t = translator(locale);
  const { name, description } = texts(product, locale);
  return {
    title: name,
    description: description?.slice(0, 160) ?? t(`${product.nameAr} من ${product.vendor.nameAr}`, `${name} from ${nameIn(locale, product.vendor)}`),
    alternates: { canonical: `${SITE_URL}/p/${encodeURIComponent(product.slug)}` },
    openGraph: {
      type: 'website',
      locale,
      title: name,
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
  const [currency, locale] = await Promise.all([pageCurrency(), pageLocale()]);
  const t = translator(locale);
  const product = await getProduct(slug, currency, locale);
  const { name, description } = texts(product, locale);

  // منتجات أخرى من المتجر نفسه، ومراجعات المنتج — تحسين لا شرط: تعذّر جلبهما لا يُسقط الصفحة
  const [shop, reviews] = await Promise.all([
    getShop(product.vendor.slug, { currency, lang: locale }).catch(() => null),
    getProductReviews(product.id).catch(() => null),
  ]);
  const more = (shop?.products ?? []).filter((p) => p.id !== product.id).slice(0, MORE_FROM_SHOP);

  const images: GalleryImage[] = product.images.map((img) => ({
    id: img.id,
    alt: img.altAr ?? name,
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
            { name: t('الرئيسية', 'Home'), path: '/' },
            { name: nameIn(locale, product.vendor), path: shopPath },
            ...(category && categoryPath ? [{ name: category.nameAr, path: categoryPath }] : []),
            { name, path: `/p/${product.slug}` },
          ]),
        ]}
      />
      <Crumbs
        locale={locale}
        items={[
          { href: '/', label: t('الرئيسية', 'Home') },
          { href: shopPath, label: nameIn(locale, product.vendor) },
          ...(category && categoryPath ? [{ href: categoryPath, label: nameIn(locale, category) }] : []),
          { label: name },
        ]}
      />

      {/* الاختيار والمعرض يتشاركان المتغيّر المختار — بينهما محتوى خادم يبقى خادماً */}
      <ProductSelection initial={product.variants[0]?.id ?? ''}>
      <div className="sd-pdp__layout">
        <ProductGallery images={images} name={name} soldOut={product.isSoldOut} variantValues={variantValues} />

        <div className="sd-pdp__info">
          <div className="sd-pdp__titles">
            <h1 className="sd-pdp__name">{name}</h1>
            {name !== product.nameAr ? (
              <p className="sd-pdp__en" dir="rtl" lang="ar">
                {product.nameAr}
              </p>
            ) : product.nameEn ? (
              <p className="sd-pdp__en" dir="ltr" lang="en">
                {product.nameEn}
              </p>
            ) : null}
            <div className="sd-pdp__byline">
              <Link href={`/s/${product.vendor.slug}`} className="sd-pdp__shop">
                <Icon name="store" size={15} />
                {nameIn(locale, product.vendor)}
              </Link>
              {product.vendor.ratingCount > 0 ? (
                <span className="sd-rating">
                  <Icon name="star-fill" size={15} className="sd-rating__star" />
                  <span className="num sd-rating__avg">{product.vendor.ratingAvg.toFixed(1)}</span>
                  <span className="sd-rating__count">
                    {t('تقييم المتجر من', 'Shop rating from')} <span className="num">{num(product.vendor.ratingCount, locale)}</span>
                    {locale === 'en' ? (product.vendor.ratingCount === 1 ? ' rating' : ' ratings') : null}
                  </span>
                </span>
              ) : null}
            </div>
          </div>

          {product.isSoldOut ? (
            <div className="alert alert--warning" role="status">
              <p className="alert__title">{t('نفد هذا المنتج', 'This product is sold out')}</p>
              <p>
                {t(
                  'البائع لم يُعِد تزويده بعد. تصفّح منتجات مشابهة في المتجر نفسه.',
                  "The seller hasn't restocked it yet. Browse similar products in the same shop.",
                )}
              </p>
              <Link className="btn btn--secondary btn--sm" href={categoryPath ?? shopPath}>
                {category ? t(`المزيد من «${category.nameAr}»`, `More from “${category.nameAr}”`) : t('منتجات المتجر', 'Shop products')}
              </Link>
            </div>
          ) : null}

          <VariantPicker
            variants={product.variants}
            actions={
              <>
                <WishHeart productId={product.id} name={name} variant="pdp" />
                <CompareToggle item={{ slug: product.slug, nameAr: product.nameAr, thumb }} />
              </>
            }
          />

          <section className="sd-policy" aria-label={t('الشحن والإرجاع', 'Shipping and returns')}>
            <div className="sd-policy__row">
              <Icon name="truck" size={17} />
              <p>{product.vendor.shippingPolicyAr ?? t('يحدّد البائع مدّة الشحن عند الطلب.', 'The seller sets the shipping time when you order.')}</p>
            </div>
            <div className="sd-policy__row">
              <Icon name="return" size={17} />
              <p>{product.vendor.returnPolicyAr ?? t('سياسة الإرجاع العامة في بسطة تسري.', "Basta's general return policy applies.")}</p>
            </div>
          </section>

          {/* ST-09 — السؤال يُرسل إلى «رسائلي» مرفقاً بالمنتج */}
          <AskShop
            context={{ productId: product.id }}
            shopName={nameIn(locale, product.vendor)}
            subjectName={name}
            subjectSub={t(`من ${product.vendor.nameAr}`, `From ${nameIn(locale, product.vendor)}`)}
            thumb={imageUrl(thumb)}
            triggerLabel={t('اسأل المتجر عن هذا المنتج', 'Ask the shop about this product')}
          />
        </div>
      </div>
      </ProductSelection>

      {description ? (
        <section className="sd-pdp__block" aria-labelledby="sd-desc">
          <h2 id="sd-desc" className="sd-pdp__tabs">
            <span className="sd-pdp__tab">{t('الوصف', 'Description')}</span>
          </h2>
          <p className="sd-pdp__desc">{description}</p>
        </section>
      ) : null}

      {product.attributes.length > 0 ? (
        <section className="sd-pdp__block" aria-labelledby="sd-specs">
          <h2 id="sd-specs" className="sd-pdp__tabs">
            <span className="sd-pdp__tab">{t('المواصفات', 'Specifications')}</span>
          </h2>
          <dl className="sd-specs">
            {product.attributes.map((a) => (
              <div key={a.attributeId} className="sd-specs__row">
                <dt>{a.nameAr}</dt>
                <dd>{a.valueAr ?? a.number ?? (a.boolean === null ? '—' : a.boolean ? t('نعم', 'Yes') : t('لا', 'No'))}</dd>
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
              {t(`المزيد من ${product.vendor.nameAr}`, `More from ${nameIn(locale, product.vendor)}`)}
            </h2>
            <Link href={`/s/${product.vendor.slug}`} className="sd-section__link">
              {t('كل منتجات المتجر', 'All shop products')}
              <Icon name="chev-end" size={14} mirror />
            </Link>
          </div>
          <ProductGrid products={more} locale={locale} />
        </section>
      ) : null}

      <CompareBar />
    </article>
  );
}
