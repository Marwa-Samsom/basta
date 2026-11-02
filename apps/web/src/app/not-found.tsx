import Link from 'next/link';
import { Icon } from '@/components/icons';
import { SearchBox } from '@/components/search-box';
import { serverT } from '@/lib/i18n-server';

/**
 * SH-05 — الصفحة غير موجودة. تقول ماذا تفعل الآن، لا «404» وحدها:
 * بحث في مكانه، والمتاجر، والرئيسية.
 */
export default async function NotFound() {
  const t = await serverT();
  return (
    <main className="sd-404" data-density="comfortable">
      <span className="num sd-404__code" aria-hidden>
        404
      </span>
      <h1 className="sd-404__title">{t('لم نجد هذه الصفحة', "We couldn't find this page")}</h1>
      <p className="sd-404__body">
        {t(
          'قد يكون الرابط قديماً، أو نُقل المنتج أو أوقف البائع عرضه. ابحث عمّا تريد أو ابدأ من المتاجر.',
          'The link may be old, or the product was moved or the seller stopped listing it. Search for what you want or start from the shops.',
        )}
      </p>
      <div className="sd-404__search">
        <SearchBox />
      </div>
      <div className="sd-404__actions">
        <Link className="btn btn--primary btn--lg" href="/shops">
          <Icon name="store" size={17} />
          {t('تصفّح المتاجر', 'Browse shops')}
        </Link>
        <Link className="btn btn--secondary btn--lg" href="/">
          <Icon name="back" size={17} mirror />
          {t('عُد إلى الرئيسية', 'Back to home')}
        </Link>
      </div>
    </main>
  );
}
