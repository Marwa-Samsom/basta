import Link from 'next/link';
import { ProductGrid } from '@/components/product-card';
import { getCategories, listProducts } from '@/lib/storefront';

/**
 * ST-01 — الرئيسية.
 *
 * الأقسام والبانرات القابلة للإدارة (AD-19) تأتي مع لوحة الإدارة في المرحلة
 * 11؛ حتى ذلك الحين الرئيسية تعرض ما هو حقيقي: الفئات وأحدث المنشور —
 * لا بانرات بصور مصطنعة.
 */
export default async function HomePage() {
  const [categories, latest] = await Promise.all([
    getCategories(),
    listProducts({ sort: 'newest', pageSize: '12' }),
  ]);

  return (
    <div className="stack stack--loose">
      <section className="hero">
        <h1>كل المتاجر المستقلة في سوق واحد</h1>
        <p className="muted">اشترِ من بائعين حقيقيين، بعملة بلدك، وتابع كل طلب من متجره.</p>
      </section>

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
