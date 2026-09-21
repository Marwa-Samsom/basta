import Link from 'next/link';
import { SearchBox } from '@/components/search-box';

/**
 * قشرة المتجر — كثافة `comfortable`: المتجر يُقرأ، اللوحة تُشغَّل.
 *
 * مكوّن خادم: الرأس والتذييل جزء من مصدر HTML لا من سكربت. صندوق البحث
 * وحده عميل لأنه يقترح أثناء الكتابة — ومع ذلك هو نموذج GET حقيقي، فيعمل
 * بلا JavaScript ويذهب إلى صفحة النتائج.
 */
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="store" data-density="comfortable">
      <header className="store__bar">
        <Link href="/" className="store__brand">
          بسطة
        </Link>
        <SearchBox />
        <nav className="row small" aria-label="روابط سريعة">
          <Link href="/categories">الفئات</Link>
          <Link href="/cart">السلة</Link>
          <Link href="/account/orders">طلباتي</Link>
          <Link href="/vendor">بِع على بسطة</Link>
          <Link href="/login">دخول</Link>
        </nav>
      </header>

      <main className="store__main">{children}</main>

      <footer className="store__foot small muted">
        <p>بسطة — سوق يجمع متاجر مستقلة في مكان واحد.</p>
      </footer>
    </div>
  );
}
