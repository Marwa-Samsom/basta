import Link from 'next/link';
import '@/styles/screens/storefront-extra.css';
import { CompareBar } from '@/components/compare';
import { Icon } from '@/components/icons';
import { InstallPrompt } from '@/components/install-prompt';
import { ProductGrid } from '@/components/product-card';
import { RecentSection } from '@/components/recent';
import { EmptyState } from '@/components/ui';
import { requestCurrency } from '@/lib/currency-server';
import { internalPath } from '@/lib/safe-path';
import { getBanners, getCampaigns, getFeatured, getShops, imageUrl, listProducts, type Campaign } from '@/lib/storefront';

/**
 * يُصيَّر عند الطلب لا وقت البناء: البناء لا يعتمد على خادم API حيّ (المرحلة 12).
 * التخزين باقٍ على مستوى البيانات — كل fetch يحمل مدة إعادة تحققه.
 */
export const dynamic = 'force-dynamic';

/**
 * مربّعات المتاجر في الشريط — ستة كما كانت مربّعات الأقسام، والبقية في «كل المتاجر».
 * سقطت الأقسام العامة حين صارت الفئات لكل متجر (14 أكتوبر 2026).
 */
const SHOP_TILES = 6;

const endDate = (iso: string) => new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long' }).format(new Date(iso));

/**
 * حملة جارية (AD-17): اسمها وموعد انتهائها، والكوبون المُعلَن إن كان صالحاً
 * الآن، ومنتجاتها بترتيب الإدارة بالبطاقة نفسها — بلا صورة إضافية تثقل الرسم.
 */
function CampaignSection({ campaign }: { campaign: Campaign }) {
  const titleId = `sd-campaign-${campaign.id}`;
  return (
    <section className="sd-section sd-campaign" aria-labelledby={titleId}>
      <div className="sd-section__head">
        <h2 id={titleId} className="sd-section__title">
          {campaign.nameAr}
        </h2>
        <span className="sd-section__note">
          حتى <time dateTime={campaign.endsAt}>{endDate(campaign.endsAt)}</time>
        </span>
        {campaign.couponCode ? (
          <span className="sd-campaign__coupon">
            <Icon name="star" size={14} />
            استعمل الرمز
            <span className="sd-campaign__code num" dir="ltr">
              {campaign.couponCode}
            </span>
          </span>
        ) : null}
      </div>
      <ProductGrid products={campaign.products} />
    </section>
  );
}

/**
 * ST-01 — الرئيسية. البانرات والمميّز من لوحة الإدارة (AD-19)؛ ما لم تُضف
 * الإدارة شيئاً يبقى ما هو حقيقي: المتاجر وأحدث المنشور — لا صور مصطنعة.
 */
export default async function HomePage() {
  const currency = await requestCurrency();
  const [shopsPage, latest, banners, featured, campaigns] = await Promise.all([
    getShops().catch(() => ({ items: [] })),
    listProducts({ sort: 'newest', pageSize: '12' }, currency),
    getBanners('home_hero'),
    getFeatured(currency),
    getCampaigns(currency),
  ]);

  const banner = banners[0];
  const bannerSrc = banner ? imageUrl(banner.imageUrl) : null;
  // رابط محفوظ قبل تشديد التحقق قد يكون `//موقع-آخر` — يُعاد فحصه عند العرض
  const bannerHref = internalPath(banner?.linkUrl);
  const isEmpty = latest.items.length === 0;
  const tiles = shopsPage.items.slice(0, SHOP_TILES);
  const topCampaigns = campaigns.filter((c) => c.placement === 'home_top');
  const middleCampaigns = campaigns.filter((c) => c.placement === 'home_middle');

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
              ? 'أول المتاجر تنضم هذه الأيام. تصفّح المتاجر لترى ما وصل، وسجّل متجرك إن كنت تاجراً.'
              : 'اشترِ من بائعين حقيقيين، بعملة بلدك، وتابع كل طلب من متجره.'}
          </p>
          {bannerHref ? (
            <Link href={bannerHref} className="btn btn--on-brand btn--lg sd-hero__cta">
              تسوّق الآن
              <Icon name="next" size={17} mirror />
            </Link>
          ) : (
            <Link href="/shops" className="btn btn--on-brand btn--lg sd-hero__cta">
              تصفّح المتاجر
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
        <section className="sd-section" aria-labelledby="sd-shops-title">
          <div className="sd-section__head">
            <h2 id="sd-shops-title" className="sd-section__title">
              تصفّح المتاجر
            </h2>
            <Link href="/shops" className="sd-section__link">
              كل المتاجر
              <Icon name="chev-end" size={14} mirror />
            </Link>
          </div>
          <div className="sd-tiles">
            {tiles.map((c) => (
              <Link key={c.id} href={`/s/${encodeURIComponent(c.slug)}`} className="sd-tile">
                <span className="sd-tile__icon" aria-hidden>
                  <Icon name="store" size={21} />
                </span>
                <span className="sd-tile__label">{c.nameAr}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {topCampaigns.map((c) => (
        <CampaignSection key={c.id} campaign={c} />
      ))}

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

      {middleCampaigns.map((c) => (
        <CampaignSection key={c.id} campaign={c} />
      ))}

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

      <CompareBar />
      {/* SH-08 — لا يُرسم إلا حين يعرض المتصفّح التثبيت */}
      <InstallPrompt />
    </div>
  );
}
