import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Crumbs, Listing, hasFilters } from '@/components/listing';
import { EmptyState } from '@/components/ui';
import { getCategories, listProducts } from '@/lib/storefront';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  // نتائج البحث لا تُفهرس: كل كلمة صفحة، والصفحات الرقيقة تضرّ بترتيب الموقع
  return { title: q ? `بحث: ${q}` : 'بحث', robots: { index: false, follow: true } };
}

/**
 * ST-04 نتائج البحث، و ST-05 بلا نتائج.
 *
 * «بلا نتائج» ليست طريقاً مسدوداً: تقترح الفئات وتقول ما يمكن تجربته،
 * لأن المشتري الذي يُترك أمام صفحة فارغة يغادر.
 */
export default async function SearchPage({ searchParams }: Props) {
  const query = await searchParams;
  const q = query['q']?.trim() ?? '';

  if (!q) {
    return (
      <EmptyState icon="search" title="ابحث في بسطة">
        اكتب ما تبحث عنه في الأعلى — اسم منتج، أو ماركة، أو متجر.
      </EmptyState>
    );
  }

  const [result, categories] = await Promise.all([listProducts(query), getCategories()]);
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

        {categories.length > 0 ? (
          <section className="sd-section" aria-labelledby="sd-nr-cats">
            <div className="sd-section__head">
              <h2 id="sd-nr-cats" className="sd-section__title">
                تصفّح الأقسام
              </h2>
            </div>
            <div className="sd-tiles">
              {categories.map((c) => (
                <Link key={c.id} href={`/c/${c.slug}`} className="sd-tile">
                  <span className="sd-tile__icon" aria-hidden>
                    <Icon name="boxes" size={19} />
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
