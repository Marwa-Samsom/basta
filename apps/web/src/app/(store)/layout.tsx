import Link from 'next/link';
import '@/styles/screens/storefront-discovery.css';
import '@/styles/screens/storefront-purchase.css';
import { Icon } from '@/components/icons';
import { NotificationBell } from '@/components/notification-bell';
import { SearchBox } from '@/components/search-box';
import { CartButton, ShopStrip } from '@/components/store-chrome';
import { getShops } from '@/lib/storefront';

/** المتاجر الظاهرة في شريط الرأس — البقية في «كل المتاجر» */
const TOP_SHOPS = 6;

const FOOTER: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'بسطة',
    links: [
      { href: '/pages/about', label: 'من نحن' },
      { href: '/pages/faq', label: 'الأسئلة الشائعة' },
      { href: '/pages/contact', label: 'اتصل بنا' },
    ],
  },
  {
    title: 'التسوّق',
    links: [
      { href: '/shops', label: 'كل المتاجر' },
      { href: '/pages/returns', label: 'سياسة الإرجاع' },
      { href: '/account/orders', label: 'طلباتي' },
    ],
  },
  {
    title: 'للتجّار',
    links: [
      { href: '/vendor/register', label: 'سجّل متجرك' },
      { href: '/vendor', label: 'لوحة التاجر' },
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
  const top = await getShops()
    .then((r) => r.items.slice(0, TOP_SHOPS))
    .catch(() => []);

  return (
    <div className="store" data-density="comfortable">
      <header className="store__head">
        <div className="store__bar">
          <Link href="/" className="store__brand">
            بسطة
          </Link>
          <SearchBox />
          <div className="store__tools">
            <NotificationBell />
            <Link href="/account" className="icon-btn" aria-label="حسابي وطلباتي">
              <Icon name="user" size={19} />
            </Link>
            <CartButton />
          </div>
        </div>
        <nav className="store__cats" aria-label="المتاجر">
          <Link href="/shops" className="store__all">
            <Icon name="store" size={15} />
            كل المتاجر
          </Link>
          <ShopStrip shops={top} />
          <Link href="/sell" className="btn btn--soft btn--sm store__sell">
            بِع على بسطة
          </Link>
        </nav>
      </header>

      <main className="store__main">{children}</main>

      <footer className="store__foot">
        <div className="store__foot-cols">
          <div className="store__foot-col">
            <span className="store__foot-brand">بسطة</span>
            <p className="store__foot-note">سوق يجمع متاجر مستقلة في مكان واحد.</p>
          </div>
          {FOOTER.map((col) => (
            <div key={col.title} className="store__foot-col">
              <span className="store__foot-title">{col.title}</span>
              {col.links.map((l) => (
                <Link key={l.href} href={l.href}>
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="store__foot-base">
          <span>© {new Date().getFullYear()} بسطة. جميع الحقوق محفوظة.</span>
        </div>
      </footer>
    </div>
  );
}
