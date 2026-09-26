import Link from 'next/link';
import { Icon } from '@/components/icons';
import { SearchBox } from '@/components/search-box';

/**
 * SH-05 — الصفحة غير موجودة. تقول ماذا تفعل الآن، لا «404» وحدها:
 * بحث في مكانه، والأقسام، والرئيسية.
 */
export default function NotFound() {
  return (
    <main className="sd-404" data-density="comfortable">
      <span className="num sd-404__code" aria-hidden>
        404
      </span>
      <h1 className="sd-404__title">لم نجد هذه الصفحة</h1>
      <p className="sd-404__body">
        قد يكون الرابط قديماً، أو نُقل المنتج أو أوقف البائع عرضه. ابحث عمّا تريد أو ابدأ من الأقسام.
      </p>
      <div className="sd-404__search">
        <SearchBox />
      </div>
      <div className="sd-404__actions">
        <Link className="btn btn--primary btn--lg" href="/categories">
          <Icon name="boxes" size={17} />
          تصفّح الأقسام
        </Link>
        <Link className="btn btn--secondary btn--lg" href="/">
          <Icon name="back" size={17} mirror />
          عُد إلى الرئيسية
        </Link>
      </div>
    </main>
  );
}
