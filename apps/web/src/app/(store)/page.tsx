import Link from 'next/link';
import { ProductGrid } from '@/components/product-card';
import { getBanners, getCategories, getFeatured, imageUrl, listProducts } from '@/lib/storefront';

/**
 * يُصيَّر عند الطلب لا وقت البناء: البناء لا يعتمد على خادم API حيّ (المرحلة 12).
 * التخزين باقٍ على مستوى البيانات — كل fetch يحمل مدة إعادة تحققه.
 */
export const dynamic = 'force-dynamic';

/**
 * ST-01 — الرئيسية. البانرات والمميّز من لوحة الإدارة (AD-19)؛ ما لم تُضف
 * الإدارة شيئاً يبقى ما هو حقيقي: الفئات وأحدث المنشور — لا صور مصطنعة.
 */
export default async function HomePage() {
  const [categories, latest, banners, featured] = await Promise.all([
    getCategories(),
    listProducts({ sort: 'newest', pageSize: '12' }),
    getBanners('home_hero'),
    getFeatured(),
  ]);

  return (
    <div className="stack stack--loose">
      {banners[0] ? (
        <Link href={banners[0].linkUrl ?? '/'} className="hero" style={{ padding: 0, overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(banners[0].imageUrl) ?? ''} alt={banners[0].titleAr ?? 'عرض'} style={{ width: '100%', height: 'auto', display: 'block' }} />
        </Link>
      ) : (
        <section className="hero">
          <h1>كل المتاجر المستقلة في سوق واحد</h1>
          <p className="muted">اشترِ من بائعين حقيقيين، بعملة بلدك، وتابع كل طلب من متجره.</p>
        </section>
      )}

      {featured.length > 0 ? (
        <section className="stack">
          <h2>مختارات</h2>
          <ProductGrid products={featured} />
        </section>
      ) : null}

      <section className="stack">
        <div className="row row--between">
          <h2>تسوّق حسب الفئة</h2>
          <Link href="/categories" className="small">
            كل الفئات
          </Link>
        </div>
        <div className="chips">
          {categories.map((c) => (
            <Link key={c.id} href={`/c/${c.slug}`} className="chip">
              {c.nameAr}
            </Link>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>وصل حديثاً</h2>
        {latest.items.length > 0 ? (
          <ProductGrid products={latest.items} />
        ) : (
          <div className="empty">
            <p>لا منتجات منشورة بعد. أول البائعين يجهّزون متاجرهم الآن.</p>
            <Link className="btn btn--secondary" href="/vendor/register">
              افتح متجرك
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
