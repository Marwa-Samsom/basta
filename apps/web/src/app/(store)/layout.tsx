import Link from 'next/link';
import '@/styles/screens/storefront-discovery.css';
import '@/styles/screens/storefront-purchase.css';
import { Icon } from '@/components/icons';
import { NotificationBell } from '@/components/notification-bell';
import { SearchBox } from '@/components/search-box';
import { CartButton, CategoryStrip } from '@/components/store-chrome';
import { getCategories } from '@/lib/storefront';

/** الأقسام الظاهرة في شريط الرأس — البقية في «كل الأقسام» */
const TOP_CATEGORIES = 6;

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
      { href: '/categories', label: 'كل الأقسام' },
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
 * بلا JavaScript ويذهب إلى صفحة النتائج. والأقسام إن تعذّر جلبها يبقى
 * الرأس بلا رقائقها: سقوط شريط لا يُسقط الصفحة.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const categories = await getCategories().catch(() => []);
  const top = categories.filter((c) => c.depth === 0).slice(0, TOP_CATEGORIES);

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
        <nav className="store__cats" aria-label="الأقسام">
          <Link href="/categories" className="store__all">
            <Icon name="boxes" size={15} />
            كل الأقسام
          </Link>
          <CategoryStrip categories={top} />
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
