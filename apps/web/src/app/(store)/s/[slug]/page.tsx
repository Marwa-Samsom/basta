import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { ProductGrid } from '@/components/product-card';
import { EmptyState } from '@/components/ui';
import { requestCurrency } from '@/lib/currency-server';
import { getShop, num } from '@/lib/storefront';
import { JsonLd, SITE_URL, shopJsonLd } from '@/lib/seo';

type Params = { params: Promise<{ slug: string }> };
type Props = Params & { searchParams: Promise<Record<string, string | undefined>> };

/** معرّف فئة صالح أو لا تصفية — المعرّف المعطوب يردّه الخادم 400 فتسقط الصفحة */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getShop(slug, { currency: await requestCurrency() });
  return {
    title: shop.vendor.nameAr,
    description: shop.vendor.descriptionAr?.slice(0, 160) ?? `متجر ${shop.vendor.nameAr} على بسطة`,
    // المعلَّق يُعرض ولا يُفهرس: الرابط لا ينكسر، ولا يظهر في محرّكات البحث
    ...(shop.vendor.isSuspended ? { robots: { index: false, follow: false } } : {}),
    alternates: { canonical: `${SITE_URL}/s/${encodeURIComponent(shop.vendor.slug)}` },
  };
}

/**
 * ST-11 صفحة البائع، و ST-12 حالة التعليق. فئات المتجر أزرار تصفية فوق منتجاته —
 * يضعها البائع بنفسه ويرتّبها (14 أكتوبر 2026). التصفية رابط لا سكربت: تعمل بلا JavaScript.
 */
export default async function ShopPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const category = query['category'] && UUID.test(query['category']) ? query['category'] : undefined;
  const page = Math.max(1, Number(query['page']) || 1);
  const shop = await getShop(slug, { category, page, currency: await requestCurrency() });
  const { vendor, products, total, categories } = shop;
  const selected = categories.find((c) => c.id === category) ?? null;
  const base = `/s/${encodeURIComponent(vendor.slug)}`;
  const href = (cat: string | null, n = 1) => {
    const qs = new URLSearchParams({ ...(cat ? { category: cat } : {}), ...(n > 1 ? { page: String(n) } : {}) }).toString();
    return qs ? `${base}?${qs}` : base;
  };
  const pages = Math.ceil(total / shop.pageSize);
  const since = new Intl.DateTimeFormat('ar-JO-u-nu-latn', { year: 'numeric', month: 'long' }).format(
    new Date(vendor.since),
  );

  return (
    <div className="sd-shop">
      {vendor.isSuspended ? null : <JsonLd data={shopJsonLd(shop)} />}
      <div className="sd-shop__cover" aria-hidden />

      <header className="sd-shop__head">
        <span className="sd-shop__logo" aria-hidden>
          <Icon name="store" size={44} />
        </span>
        <div className="sd-shop__id">
          <div className="sd-shop__name-row">
            <h1 className="sd-shop__name">{vendor.nameAr}</h1>
            {vendor.isSuspended ? (
              <span className="sd-shop__paused">
                <Icon name="clock" size={15} />
                لا يستقبل طلبات حالياً
              </span>
            ) : null}
          </div>
          <div className="sd-shop__meta">
            {vendor.ratingCount > 0 ? (
              <span className="sd-rating">
                <Icon name="star-fill" size={15} className="sd-rating__star" />
                <span className="num sd-rating__avg">{vendor.ratingAvg.toFixed(1)}</span>
                <span className="sd-rating__count">
                  (<span className="num">{num(vendor.ratingCount)}</span> تقييماً)
                </span>
              </span>
            ) : null}
            <span>على بسطة منذ {since}</span>
            {vendor.isSuspended || category ? null : (
              <span>
                {total > 0 ? (
                  <>
                    <span className="num">{num(total)}</span> منتجاً
                  </>
                ) : (
                  'لا منتجات منشورة'
                )}
              </span>
            )}
          </div>
        </div>
      </header>

      {vendor.isSuspended ? (
        <section className="sd-shop__paused-card" role="status">
          <span className="sd-shop__paused-icon" aria-hidden>
            <Icon name="clock" size={23} />
          </span>
          <h2 className="sd-shop__paused-title">هذا المتجر لا يستقبل طلبات حالياً</h2>
          <p className="sd-shop__paused-body">يمكنك تصفّح متاجر أخرى تبيع منتجات مشابهة.</p>
          <Link className="btn btn--secondary" href="/shops">
            تصفّح المتاجر
          </Link>
        </section>
      ) : (
        <>
          {vendor.descriptionAr || vendor.shippingPolicyAr || vendor.returnPolicyAr ? (
            <div className="sd-shop__about">
              {vendor.descriptionAr ? (
                <section className="sd-infocard">
                  <h2 className="sd-infocard__title">عن المتجر</h2>
                  <p className="sd-infocard__body">{vendor.descriptionAr}</p>
                </section>
              ) : null}
              {vendor.shippingPolicyAr ? (
                <section className="sd-infocard">
                  <h2 className="sd-infocard__title">
                    <Icon name="truck" size={15} />
                    سياسة الشحن
                  </h2>
                  <p className="sd-infocard__body">{vendor.shippingPolicyAr}</p>
                </section>
              ) : null}
              {vendor.returnPolicyAr ? (
                <section className="sd-infocard">
                  <h2 className="sd-infocard__title">
                    <Icon name="return" size={15} />
                    سياسة الإرجاع
                  </h2>
                  <p className="sd-infocard__body">{vendor.returnPolicyAr}</p>
                </section>
              ) : null}
            </div>
          ) : null}

          <section className="sd-section" aria-labelledby="sd-shop-products">
            <div className="sd-section__head">
              <h2 id="sd-shop-products" className="sd-section__title">
                {selected ? selected.nameAr : 'منتجات المتجر'}
              </h2>
              <span className="sd-section__note">
                <span className="num">{num(total)}</span>
              </span>
            </div>
            {categories.length > 0 ? (
              <nav className="sd-shopcats" aria-label="فئات المتجر">
                <Link href={href(null)} className="sd-shopcat" {...(category ? {} : { 'aria-current': 'page' as const })}>
                  الكل
                </Link>
                {categories.map((c) => (
                  <Link
                    key={c.id}
                    href={href(c.id)}
                    className="sd-shopcat"
                    {...(c.id === category ? { 'aria-current': 'page' as const } : {})}
                  >
                    {c.nameAr}
                    <span className="num">{num(c.count)}</span>
                  </Link>
                ))}
              </nav>
            ) : null}
            {products.length > 0 ? (
              <ProductGrid products={products} />
            ) : category ? (
              <EmptyState
                icon="package"
                title="لا منتجات في هذه الفئة"
                actions={
                  <Link className="btn btn--secondary" href={href(null)}>
                    كل منتجات المتجر
                  </Link>
                }
              />
            ) : (
              <EmptyState icon="package" title="لا منتجات بعد">
                لا منتجات منشورة في هذا المتجر بعد.
              </EmptyState>
            )}
            {pages > 1 ? (
              <nav className="sd-pager" aria-label="صفحات المنتجات">
                {page > 1 ? (
                  <Link className="btn btn--secondary btn--sm" href={href(category ?? null, page - 1)}>
                    السابق
                  </Link>
                ) : null}
                <span className="small muted">
                  صفحة <span className="num">{num(page)}</span> من <span className="num">{num(pages)}</span>
                </span>
                {page < pages ? (
                  <Link className="btn btn--secondary btn--sm" href={href(category ?? null, page + 1)}>
                    التالي
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
