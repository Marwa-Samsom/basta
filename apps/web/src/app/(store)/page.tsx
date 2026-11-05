import Link from 'next/link';
import '@/styles/screens/storefront-extra.css';
import { CompareBar } from '@/components/compare';
import { Icon } from '@/components/icons';
import { InstallPrompt } from '@/components/install-prompt';
import { LatestProducts } from '@/components/latest-products';
import { ProductGrid } from '@/components/product-card';
import { RecentSection } from '@/components/recent';
import { EmptyState } from '@/components/ui';
import { HeroBanners, type HeroSlide } from '@/components/hero-banners';
import { pageCurrency } from '@/lib/currency-server';
import { intlLocale, nameIn, translator, type Locale } from '@/lib/i18n';
import { pageLocale } from '@/lib/i18n-server';
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

const endDate = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long' }).format(new Date(iso));

/**
 * حملة جارية (AD-17): اسمها وموعد انتهائها، والكوبون المُعلَن إن كان صالحاً
 * الآن، ومنتجاتها بترتيب الإدارة بالبطاقة نفسها — بلا صورة إضافية تثقل الرسم.
 */
function CampaignSection({ campaign, locale }: { campaign: Campaign; locale: Locale }) {
  const t = translator(locale);
  const titleId = `sd-campaign-${campaign.id}`;
  return (
    <section className="sd-section sd-campaign" aria-labelledby={titleId}>
      <div className="sd-section__head">
        <h2 id={titleId} className="sd-section__title">
          {campaign.nameAr}
        </h2>
        <span className="sd-section__note">
          {t('حتى', 'Until')} <time dateTime={campaign.endsAt}>{endDate(campaign.endsAt, locale)}</time>
        </span>
        {campaign.couponCode ? (
          <span className="sd-campaign__coupon">
            <Icon name="star" size={14} />
            {t('استعمل الرمز', 'Use code')}
            <span className="sd-campaign__code num" dir="ltr">
              {campaign.couponCode}
            </span>
          </span>
        ) : null}
      </div>
      <ProductGrid products={campaign.products} locale={locale} />
    </section>
  );
}

/**
 * ST-01 — الرئيسية. البانرات والمميّز من لوحة الإدارة (AD-19)؛ ما لم تُضف
 * الإدارة شيئاً يبقى ما هو حقيقي: المتاجر وأحدث المنشور — لا صور مصطنعة.
 */
export default async function HomePage() {
  const [currency, locale] = await Promise.all([pageCurrency(), pageLocale()]);
  const t = translator(locale);
  const [shopsPage, latest, banners, middleBanners, featured, campaigns] = await Promise.all([
    getShops().catch(() => ({ items: [] })),
    listProducts({ sort: 'newest', pageSize: '12' }, currency, locale),
    getBanners('home_hero'),
    // «وسط الرئيسية» كان موضعاً في اللوحة لا يُعرض في أي صفحة (ACFG-052)
    getBanners('home_middle'),
    getFeatured(currency, locale),
    getCampaigns(currency, locale),
  ]);

  // رابط محفوظ قبل تشديد التحقق قد يكون `//موقع-آخر` — يُعاد فحصه عند العرض
  const slideOf = (b: (typeof banners)[number]): HeroSlide | null => {
    const src = imageUrl(b.imageUrl);
    return src ? { id: b.id, title: b.titleAr, href: internalPath(b.linkUrl), src } : null;
  };
  const heroSlides = banners.map(slideOf).filter((s): s is HeroSlide => s !== null);
  const promos = middleBanners.map(slideOf).filter((s): s is HeroSlide => s !== null);
  const isEmpty = latest.items.length === 0;
  const tiles = shopsPage.items.slice(0, SHOP_TILES);
  const topCampaigns = campaigns.filter((c) => c.placement === 'home_top');
  const middleCampaigns = campaigns.filter((c) => c.placement === 'home_middle');

  return (
    <div className="sd-home">
      {/* البطل — لوحة بلون العلامة ولافتات «أعلى الرئيسية» بجانبها تتبدّل إن وُجدت (ACFG-052) */}
      <HeroBanners
        slides={heroSlides}
        kicker={isEmpty ? t('منصّة جديدة', 'A new platform') : t('سوق المتاجر المستقلة', 'The marketplace of independent shops')}
        title={isEmpty ? t('بسطة تبدأ الآن', 'Basta starts now') : t('كل المتاجر المستقلة في سوق واحد', 'All independent shops in one marketplace')}
        body={
          isEmpty
            ? t(
                'أول المتاجر تنضم هذه الأيام. تصفّح المتاجر لترى ما وصل، وسجّل متجرك إن كنت تاجراً.',
                "The first shops are joining these days. Browse the shops to see what's arrived, and register your shop if you're a seller.",
              )
            : t('اشترِ من بائعين حقيقيين، بعملة بلدك، وتابع كل طلب من متجره.', "Buy from real sellers, in your country's currency, and track each order from its shop.")
        }
      />

      {tiles.length > 0 ? (
        <section className="sd-section" aria-labelledby="sd-shops-title">
          <div className="sd-section__head">
            <h2 id="sd-shops-title" className="sd-section__title">
              {t('تصفّح المتاجر', 'Browse shops')}
            </h2>
            <Link href="/shops" className="sd-section__link">
              {t('كل المتاجر', 'All shops')}
              <Icon name="chev-end" size={14} mirror />
            </Link>
          </div>
          <div className="sd-tiles">
            {tiles.map((c) => (
              <Link key={c.id} href={`/s/${encodeURIComponent(c.slug)}`} className="sd-tile">
                <span className="sd-tile__icon" aria-hidden>
                  <Icon name="store" size={21} />
                </span>
                <span className="sd-tile__label">{nameIn(locale, c)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {topCampaigns.map((c) => (
        <CampaignSection key={c.id} campaign={c} locale={locale} />
      ))}

      {featured.length > 0 ? (
        <section className="sd-section" aria-labelledby="sd-featured-title">
          <div className="sd-section__head">
            <h2 id="sd-featured-title" className="sd-section__title">
              {t('مختارات', 'Featured')}
            </h2>
          </div>
          <ProductGrid products={featured} locale={locale} />
        </section>
      ) : null}

      {/* ST-24 — من تخزين هذا الجهاز، يُرسم في المتصفّح ولا يظهر إن لم يُشاهَد شيء */}
      <RecentSection />

      {promos.length > 0 ? (
        <section className="sd-section sd-promo" aria-label={t('عروض', 'Offers')}>
          {promos.map((p) => {
            // eslint-disable-next-line @next/next/no-img-element
            const img = <img src={p.src} alt={p.title ?? t('عرض', 'Offer')} />;
            return p.href ? (
              <Link key={p.id} href={p.href} className="sd-promo__item">
                {img}
              </Link>
            ) : (
              <div key={p.id} className="sd-promo__item">
                {img}
              </div>
            );
          })}
        </section>
      ) : null}

      {middleCampaigns.map((c) => (
        <CampaignSection key={c.id} campaign={c} locale={locale} />
      ))}

      <section className="sd-section" aria-labelledby="sd-latest-title">
        <div className="sd-section__head">
          <h2 id="sd-latest-title" className="sd-section__title">
            {t('وصل حديثاً', 'New arrivals')}
          </h2>
        </div>
        {!isEmpty ? (
          <LatestProducts first={latest} currency={currency} />
        ) : (
          <EmptyState
            icon="store"
            title={t('لا منتجات لعرضها', 'No products to show')}
            actions={
              <Link className="btn btn--secondary" href="/vendor/register">
                {t('افتح متجرك', 'Open your shop')}
              </Link>
            }
          >
            {t('لا منتجات منشورة بعد. أول البائعين يجهّزون متاجرهم الآن.', 'No published products yet. The first sellers are setting up their shops now.')}
          </EmptyState>
        )}
      </section>

      <CompareBar />
      {/* SH-08 — لا يُرسم إلا حين يعرض المتصفّح التثبيت */}
      <InstallPrompt />
    </div>
  );
}
