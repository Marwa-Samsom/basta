import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductGrid } from '@/components/product-card';
import { getShop, num } from '@/lib/storefront';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getShop(slug);
  return {
    title: shop.vendor.nameAr,
    description: shop.vendor.descriptionAr?.slice(0, 160) ?? `متجر ${shop.vendor.nameAr} على بسطة`,
    // المعلَّق يُعرض ولا يُفهرس: الرابط لا ينكسر، ولا يظهر في محرّكات البحث
    ...(shop.vendor.isSuspended ? { robots: { index: false, follow: false } } : {}),
  };
}

/** ST-11 صفحة البائع، و ST-12 حالة التعليق. */
export default async function ShopPage({ params }: Params) {
  const { slug } = await params;
  const { vendor, products, total } = await getShop(slug);
  const since = new Intl.DateTimeFormat('ar-JO-u-nu-latn', { year: 'numeric', month: 'long' }).format(
    new Date(vendor.since),
  );

  return (
    <div className="stack">
      <header className="stack stack--tight">
        <h1>{vendor.nameAr}</h1>
        <p className="small muted">
          على بسطة منذ {since}
          {vendor.ratingCount > 0 ? (
            <>
              {' '}· تقييم <span className="num">{vendor.ratingAvg.toFixed(1)}</span> من{' '}
              <span className="num">{num(vendor.ratingCount)}</span>
            </>
          ) : null}
        </p>
        {vendor.descriptionAr ? <p>{vendor.descriptionAr}</p> : null}
      </header>

      {vendor.isSuspended ? (
        <div className="alert alert--warning" role="status">
          <p className="alert__title">هذا المتجر متوقّف مؤقتاً</p>
          <p>لا يستقبل طلبات الآن. تصفّح متاجر أخرى في الفئات نفسها.</p>
          <Link className="btn btn--secondary btn--sm" href="/categories">
            تصفّح الفئات
          </Link>
        </div>
      ) : (
        <>
          <h2>
            المنتجات <span className="num muted small">({num(total)})</span>
          </h2>
          {products.length > 0 ? (
            <ProductGrid products={products} />
          ) : (
            <div className="empty">
              <p>لا منتجات منشورة في هذا المتجر بعد.</p>
            </div>
          )}

          {vendor.shippingPolicyAr || vendor.returnPolicyAr ? (
            <section className="stack stack--tight">
              <h2>سياسات المتجر</h2>
              {vendor.shippingPolicyAr ? <p className="small">الشحن: {vendor.shippingPolicyAr}</p> : null}
              {vendor.returnPolicyAr ? <p className="small">الإرجاع: {vendor.returnPolicyAr}</p> : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
