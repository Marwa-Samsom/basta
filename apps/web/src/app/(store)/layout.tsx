import Link from 'next/link';
import '@/styles/screens/storefront-discovery.css';
import '@/styles/screens/storefront-purchase.css';
import { CurrencyPicker } from '@/components/currency-picker';
import { Icon } from '@/components/icons';
import { LanguageToggle } from '@/components/locale';
import { NotificationBell } from '@/components/notification-bell';
import { RefreshOnReturn } from '@/components/refresh-on-return';
import { SearchBox } from '@/components/search-box';
import { ThemeToggle } from '@/components/theme-toggle';
import { CartButton, ShopStrip } from '@/components/store-chrome';
import { pageCurrency } from '@/lib/currency-server';
import { pick, type Bilingual } from '@/lib/i18n';
import { pageLocale } from '@/lib/i18n-server';
import { getCurrencies, getShops } from '@/lib/storefront';

/** المتاجر الظاهرة في شريط الرأس — البقية في «كل المتاجر» */
const TOP_SHOPS = 6;

const FOOTER: { title: Bilingual; links: { href: string; label: Bilingual }[] }[] = [
  {
    title: { ar: 'بسطة', en: 'Basta' },
    links: [
      { href: '/pages/about', label: { ar: 'من نحن', en: 'About us' } },
      { href: '/pages/faq', label: { ar: 'الأسئلة الشائعة', en: 'FAQ' } },
      { href: '/pages/contact', label: { ar: 'اتصل بنا', en: 'Contact us' } },
    ],
  },
  {
    title: { ar: 'التسوّق', en: 'Shopping' },
    links: [
      { href: '/shops', label: { ar: 'كل المتاجر', en: 'All shops' } },
      { href: '/pages/returns', label: { ar: 'سياسة الإرجاع', en: 'Return policy' } },
      { href: '/account/orders', label: { ar: 'طلباتي', en: 'My orders' } },
    ],
  },
  {
    title: { ar: 'للتجّار', en: 'For sellers' },
    links: [
      { href: '/vendor/register', label: { ar: 'سجّل متجرك', en: 'Register your shop' } },
      { href: '/vendor', label: { ar: 'لوحة التاجر', en: 'Seller dashboard' } },
    ],
  },
];

/**
 * قشرة المتجر — ST-01، كثافة `comfortable`: المتجر يُقرأ، اللوحة تُشغَّل.
 *
 * مكوّن خادم: الرأس والتذييل جزء من مصدر HTML لا من سكربت. صندوق البحث
 * وحده عميل لأنه يقترح أثناء الكتابة — ومع ذلك هو نموذج GET حقيقي، فيعمل
 * بلا JavaScript ويذهب إلى صفحة النتائج. والمتاجر إن تعذّر جلبها يبقى
 * الرأس بلا رقائقها: سقوط شريط لا يُسقط الصفحة.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [top, money, currency, locale] = await Promise.all([
    getShops()
      .then((r) => r.items.slice(0, TOP_SHOPS))
      .catch(() => []),
    getCurrencies(),
    // ما تُطلب به أسعار الصفحة بالضبط — data-currency منه تقرأ السلة والمفضّلة
    pageCurrency(),
    pageLocale(),
  ]);
  const t = (ar: string, en: string) => pick(locale, { ar, en });

  return (
    <div className="store" data-density="comfortable" data-currency={currency}>
      <header className="store__head">
        <div className="store__bar">
          <Link href="/" className="store__brand">
            {t('بسطة', 'Basta')}
          </Link>
          <SearchBox />
          <div className="store__tools">
            <CurrencyPicker current={currency} options={money.currencies} />
            <LanguageToggle />
            <ThemeToggle />
            <NotificationBell />
            <Link href="/account" className="icon-btn" aria-label={t('حسابي وطلباتي', 'My account and orders')}>
              <Icon name="user" size={19} />
            </Link>
            <CartButton />
          </div>
        </div>
        <nav className="store__cats" aria-label={t('المتاجر', 'Shops')}>
          <Link href="/shops" className="store__all">
            <Icon name="store" size={15} />
            {t('كل المتاجر', 'All shops')}
          </Link>
          <ShopStrip shops={top} />
          <Link href="/sell" className="btn btn--soft btn--sm store__sell">
            {t('بِع على بسطة', 'Sell on Basta')}
          </Link>
        </nav>
      </header>

      <main className="store__main">
        <RefreshOnReturn />
        {children}
      </main>

      <footer className="store__foot">
        <div className="store__foot-cols">
          <div className="store__foot-col">
            <span className="store__foot-brand">{t('بسطة', 'Basta')}</span>
            <p className="store__foot-note">{t('سوق يجمع متاجر مستقلة في مكان واحد.', 'A marketplace that brings independent shops together.')}</p>
          </div>
          {FOOTER.map((col) => (
            <div key={col.title.ar} className="store__foot-col">
              <span className="store__foot-title">{pick(locale, col.title)}</span>
              {col.links.map((l) => (
                <Link key={l.href} href={l.href}>
                  {pick(locale, l.label)}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="store__foot-base">
          <span>
            © {new Date().getFullYear()} {t('بسطة. جميع الحقوق محفوظة.', 'Basta. All rights reserved.')}
          </span>
        </div>
      </footer>
    </div>
  );
}
