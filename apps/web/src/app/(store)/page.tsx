import Link from 'next/link';
import '@/styles/screens/storefront-extra.css';
import { CompareBar } from '@/components/compare';
import { Icon } from '@/components/icons';
import { InstallPrompt } from '@/components/install-prompt';
import { ProductGrid } from '@/components/product-card';
import { RecentSection } from '@/components/recent';
import { EmptyState } from '@/components/ui';
import { getBanners, getCategories, getFeatured, imageUrl, listProducts, type ProductCard } from '@/lib/storefront';

/**
 * يُصيَّر عند الطلب لا وقت البناء: البناء لا يعتمد على خادم API حيّ (المرحلة 12).
 * التخزين باقٍ على مستوى البيانات — كل fetch يحمل مدة إعادة تحققه.
 */
export const dynamic = 'force-dynamic';

/** مربّعات الأقسام في الشريط — ستة كما في التصميم، والبقية في «كل الأقسام» */
const CATEGORY_TILES = 6;
/** بطاقات المتاجر أسفل الرئيسية */
const SHOP_CARDS = 4;

/** متاجر مميّزة بلا تكرار من المنتجات المعروضة فعلاً — لا قائمة مصطنعة */
function shopsOf(products: ProductCard[]): ProductCard['vendor'][] {
  const seen = new Map<string, ProductCard['vendor']>();
  for (const p of products) if (!seen.has(p.vendor.id)) seen.set(p.vendor.id, p.vendor);
  return [...seen.values()].slice(0, SHOP_CARDS);
}

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

  const banner = banners[0];
  const bannerSrc = banner ? imageUrl(banner.imageUrl) : null;
  const isEmpty = latest.items.length === 0;
  const tiles = categories.slice(0, CATEGORY_TILES);
  const shops = shopsOf([...featured, ...latest.items]);

  return (
    <div className="sd-home">
      {/* البطل — لوحة بلون العلامة وصورة البانر بجانبها إن وُجد */}
      <section className={bannerSrc ? 'sd-hero sd-hero--media' : 'sd-hero'}>
        <div className="sd-hero__panel">
          <span className="sd-hero__kicker">{isEmpty ? 'منصّة جديدة' : 'سوق المتاجر المستقلة'}</span>
          <h1 className="sd-hero__title">
            {banner?.titleAr ?? (isEmpty ? 'بسطة تبدأ الآن' : 'كل المتاجر المستقلة في سوق واحد')}
          </h1>
          <p className="sd-hero__body">
            {isEmpty
              ? 'أول المتاجر تنضم هذه الأيام. تصفّح الأقسام لترى ما وصل، وسجّل متجرك إن كنت تاجراً.'
              : 'اشترِ من بائعين حقيقيين، بعملة بلدك، وتابع كل طلب من متجره.'}
          </p>
          {banner?.linkUrl ? (
            <Link href={banner.linkUrl} className="btn btn--on-brand btn--lg sd-hero__cta">
              تسوّق الآن
              <Icon name="next" size={17} mirror />
            </Link>
          ) : (
            <Link href="/categories" className="btn btn--on-brand btn--lg sd-hero__cta">
              تصفّح الأقسام
              <Icon name="next" size={17} mirror />
            </Link>
          )}
        </div>
        {bannerSrc ? (
          <div className="sd-hero__media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bannerSrc} alt={banner?.titleAr ?? 'عرض'} />
          </div>
        ) : null}
      </section>

      {tiles.length > 0 ? (
        <section className="sd-section" aria-labelledby="sd-cats-title">
          <div className="sd-section__head">
            <h2 id="sd-cats-title" className="sd-section__title">
              تصفّح الأقسام
            </h2>
            <Link href="/categories" className="sd-section__link">
              كل الأقسام
              <Icon name="chev-end" size={14} mirror />
            </Link>
          </div>
          <div className="sd-tiles">
            {tiles.map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`} className="sd-tile">
                <span className="sd-tile__icon" aria-hidden>
                  <Icon name="boxes" size={21} />
                </span>
                <span className="sd-tile__label">{c.nameAr}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {featured.length > 0 ? (
        <section className="sd-section" aria-labelledby="sd-featured-title">
          <div className="sd-section__head">
            <h2 id="sd-featured-title" className="sd-section__title">
              مختارات
            </h2>
          </div>
          <ProductGrid products={featured} />
        </section>
      ) : null}

      {/* ST-24 — من تخزين هذا الجهاز، يُرسم في المتصفّح ولا يظهر إن لم يُشاهَد شيء */}
      <RecentSection />

      <section className="sd-section" aria-labelledby="sd-latest-title">
        <div className="sd-section__head">
          <h2 id="sd-latest-title" className="sd-section__title">
            وصل حديثاً
          </h2>
        </div>
        {!isEmpty ? (
          <ProductGrid products={latest.items} />
        ) : (
          <EmptyState
            icon="store"
            title="لا منتجات لعرضها"
            actions={
              <Link className="btn btn--secondary" href="/vendor/register">
                افتح متجرك
              </Link>
            }
          >
            لا منتجات منشورة بعد. أول البائعين يجهّزون متاجرهم الآن.
          </EmptyState>
        )}
      </section>

      {shops.length > 0 ? (
        <section className="sd-section" aria-labelledby="sd-shops-title">
          <div className="sd-section__head">
            <h2 id="sd-shops-title" className="sd-section__title">
              متاجر على بسطة
            </h2>
          </div>
          <div className="sd-shops">
            {shops.map((s) => (
              <Link key={s.id} href={`/s/${s.slug}`} className="sd-shopcard">
                <span className="sd-shopcard__logo" aria-hidden>
                  <Icon name="store" size={22} />
                </span>
                <span className="sd-shopcard__name">{s.nameAr}</span>
                <Icon name="chev-end" size={16} mirror className="sd-shopcard__chev" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <CompareBar />
      {/* SH-08 — لا يُرسم إلا حين يعرض المتصفّح التثبيت */}
      <InstallPrompt />
    </div>
  );
}
