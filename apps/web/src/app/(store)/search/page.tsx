import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Crumbs, Listing, hasFilters } from '@/components/listing';
import { EmptyState } from '@/components/ui';
import { pageCurrency } from '@/lib/currency-server';
import { pageLocale, serverT } from '@/lib/i18n-server';
import { getShops, listParams, listProducts } from '@/lib/storefront';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = listParams(await searchParams);
  const t = await serverT();
  // نتائج البحث لا تُفهرس: كل كلمة صفحة، والصفحات الرقيقة تضرّ بترتيب الموقع
  return { title: q ? t(`بحث: ${q}`, `Search: ${q}`) : t('بحث', 'Search'), robots: { index: false, follow: true } };
}

/**
 * ST-04 نتائج البحث، و ST-05 بلا نتائج.
 *
 * «بلا نتائج» ليست طريقاً مسدوداً: تقترح المتاجر وتقول ما يمكن تجربته،
 * لأن المشتري الذي يُترك أمام صفحة فارغة يغادر.
 */
export default async function SearchPage({ searchParams }: Props) {
  const locale = await pageLocale();
  // ما يعرفه الخادم بقيمته الصالحة وحده — روابط الإعلانات (utm_*) والمعطوب لا تُسقط الصفحة (DISC-033)،
  // ولا تُحمل في روابط الترتيب والتصفية والصفحات
  const query = listParams(await searchParams);
  const q = query['q'] ?? '';
  const t = await serverT();

  if (!q) {
    return (
      <EmptyState icon="search" title={t('ابحث في بسطة', 'Search Basta')}>
        {t('اكتب ما تبحث عنه في الأعلى — اسم منتج، أو ماركة، أو متجر.', "Type what you're looking for above — a product name, a brand, or a shop.")}
      </EmptyState>
    );
  }

  const [result, shops] = await Promise.all([
    listProducts(query, await pageCurrency(), locale),
    getShops().then((r) => r.items.slice(0, 6)).catch(() => []),
  ]);
  const filtered = hasFilters(query);

  // ST-05 — لا شيء يطابق الكلمة أصلاً (لا التصفية): صفحة تقترح بدل شبكة فارغة
  if (result.total === 0 && !filtered) {
    return (
      <div className="sd-noresults">
        <section className="sd-noresults__card">
          <h1 className="sd-noresults__title">{t(`لا نتائج لـ «${q}»`, `No results for “${q}”`)}</h1>
          <p className="sd-noresults__body">{t('جرّب كلمات أقل أو تحقّق من الإملاء.', 'Try fewer words or check the spelling.')}</p>
          <ul className="sd-noresults__tips">
            <li>
              {t(
                'جرّب كلمة أعمّ: «قميص» بدل «قميص قطني أزرق مقاس M».',
                'Try a more general word: “shirt” instead of “blue cotton shirt size M”.',
              )}
            </li>
            <li>{t('الأخطاء الإملائية والهمزات مقبولة، والمرادفات الشائعة كذلك.', 'Spelling mistakes are fine, and so are common synonyms.')}</li>
          </ul>
        </section>

        {shops.length > 0 ? (
          <section className="sd-section" aria-labelledby="sd-nr-shops">
            <div className="sd-section__head">
              <h2 id="sd-nr-shops" className="sd-section__title">
                {t('تصفّح المتاجر', 'Browse shops')}
              </h2>
              <Link href="/shops" className="sd-section__link">
                {t('كل المتاجر', 'All shops')}
                <Icon name="chev-end" size={14} mirror />
              </Link>
            </div>
            <div className="sd-tiles">
              {shops.map((c) => (
                <Link key={c.id} href={`/s/${encodeURIComponent(c.slug)}`} className="sd-tile">
                  <span className="sd-tile__icon" aria-hidden>
                    <Icon name="store" size={19} />
                  </span>
                  <span className="sd-tile__label">{c.nameAr}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <Listing
      locale={locale}
      base="/search"
      params={query}
      result={result}
      title={t(`نتائج «${q}»`, `Results for “${q}”`)}
      crumbs={<Crumbs locale={locale} items={[{ href: '/', label: t('الرئيسية', 'Home') }, { label: t('نتائج البحث', 'Search results') }]} />}
      empty={
        <EmptyState
          icon="filter"
          title={t('لا نتائج مع هذه التصفية', 'No results with these filters')}
          actions={
            <Link className="btn btn--primary" href={`/search?q=${encodeURIComponent(q)}`}>
              {t('امسح التصفية', 'Clear filters')}
            </Link>
          }
        >
          {t(
            `لم نجد منتجاً يطابق «${q}» مع التصفية المطبّقة. أزل آخر تصفية أضفتها لترى نتائج أوسع.`,
            `We found no product matching “${q}” with the applied filters. Remove the last filter you added to see broader results.`,
          )}
        </EmptyState>
      }
    />
  );
}
