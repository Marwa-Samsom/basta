import Link from 'next/link';
import { Icon } from '@/components/icons';
import { NotFoundText } from '@/components/not-found-text';
import { SearchBox } from '@/components/search-box';

/**
 * SH-05 — الصفحة غير موجودة. تقول ماذا تفعل الآن، لا «404» وحدها:
 * بحث في مكانه، والمتاجر، والرئيسية.
 *
 * متزامنة لا async: Next يرسمها في المتصفّح أيضاً حين يرمي المسار notFound()، ومكوّن async
 * هناك خطأ React رقم 441 يسقط قشرة المتجر كلها (2 نوفمبر 2026) — النصوص بلغة الصفحة من مكوّن عميل.
 */
export default function NotFound() {
  return (
    <main className="sd-404" data-density="comfortable">
      <span className="num sd-404__code" aria-hidden>
        404
      </span>
      <h1 className="sd-404__title">
        <NotFoundText part="title" />
      </h1>
      <p className="sd-404__body">
        <NotFoundText part="body" />
      </p>
      <div className="sd-404__search">
        <SearchBox />
      </div>
      <div className="sd-404__actions">
        <Link className="btn btn--primary btn--lg" href="/shops">
          <Icon name="store" size={17} />
          <NotFoundText part="shops" />
        </Link>
        <Link className="btn btn--secondary btn--lg" href="/">
          <Icon name="back" size={17} mirror />
          <NotFoundText part="home" />
        </Link>
      </div>
    </main>
  );
}
