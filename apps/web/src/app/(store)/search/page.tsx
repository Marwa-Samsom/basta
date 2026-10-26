import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Crumbs, Listing, hasFilters } from '@/components/listing';
import { EmptyState } from '@/components/ui';
import { requestCurrency } from '@/lib/currency-server';
import { getShops, listParams, listProducts } from '@/lib/storefront';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = listParams(await searchParams);
  // نتائج البحث لا تُفهرس: كل كلمة صفحة، والصفحات الرقيقة تضرّ بترتيب الموقع
  return { title: q ? `بحث: ${q}` : 'بحث', robots: { index: false, follow: true } };
}

/**
 * ST-04 نتائج البحث، و ST-05 بلا نتائج.
 *
 * «بلا نتائج» ليست طريقاً مسدوداً: تقترح المتاجر وتقول ما يمكن تجربته،
 * لأن المشتري الذي يُترك أمام صفحة فارغة يغادر.
 */
export default async function SearchPage({ searchParams }: Props) {
  // ما يعرفه الخادم بقيمته الصالحة وحده — روابط الإعلانات (utm_*) والمعطوب لا تُسقط الصفحة (DISC-033)،
  // ولا تُحمل في روابط الترتيب والتصفية والصفحات
  const query = listParams(await searchParams);
  const q = query['q'] ?? '';

  if (!q) {
    return (
      <EmptyState icon="search" title="ابحث في بسطة">
        اكتب ما تبحث عنه في الأعلى — اسم منتج، أو ماركة، أو متجر.
      </EmptyState>
    );
  }

  const [result, shops] = await Promise.all([
    listProducts(query, await requestCurrency()),
    getShops().then((r) => r.items.slice(0, 6)).catch(() => []),
  ]);
  const filtered = hasFilters(query);

  // ST-05 — لا شيء يطابق الكلمة أصلاً (لا التصفية): صفحة تقترح بدل شبكة فارغة
  if (result.total === 0 && !filtered) {
    return (
      <div className="sd-noresults">
        <section className="sd-noresults__card">
          <h1 className="sd-noresults__title">لا نتائج لـ «{q}»</h1>
          <p className="sd-noresults__body">جرّب كلمات أقل أو تحقّق من الإملاء.</p>
          <ul className="sd-noresults__tips">
            <li>جرّب كلمة أعمّ: «قميص» بدل «قميص قطني أزرق مقاس M».</li>
            <li>الأخطاء الإملائية والهمزات مقبولة، والمرادفات الشائعة كذلك.</li>
          </ul>
        </section>

        {shops.length > 0 ? (
          <section className="sd-section" aria-labelledby="sd-nr-shops">
            <div className="sd-section__head">
              <h2 id="sd-nr-shops" className="sd-section__title">
                تصفّح المتاجر
              </h2>
              <Link href="/shops" className="sd-section__link">
                كل المتاجر
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
      base="/search"
      params={query}
      result={result}
      title={<>نتائج «{q}»</>}
      crumbs={<Crumbs items={[{ href: '/', label: 'الرئيسية' }, { label: 'نتائج البحث' }]} />}
      empty={
        <EmptyState
          icon="filter"
          title="لا نتائج مع هذه التصفية"
          actions={
            <Link className="btn btn--primary" href={`/search?q=${encodeURIComponent(q)}`}>
              امسح التصفية
            </Link>
          }
        >
          لم نجد منتجاً يطابق «{q}» مع التصفية المطبّقة. أزل آخر تصفية أضفتها لترى نتائج أوسع.
        </EmptyState>
      }
    />
  );
}
