import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import { getShops, num, type ShopCard } from '@/lib/storefront';

/**
 * يُصيَّر عند الطلب لا وقت البناء: البناء لا يعتمد على خادم API حيّ (المرحلة 12).
 * التخزين باقٍ على مستوى البيانات — كل fetch يحمل مدة إعادة تحققه.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'كل المتاجر' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

/**
 * دليل المتاجر — حلّ محلّ «كل الأقسام» حين صارت الفئات لكل متجر (قرار صاحب المشروع
 * 14 أكتوبر 2026). المشتري يصل إلى ما يريد بالبحث أو بالمتجر، وداخل المتجر فئاته.
 * البحث نموذج GET حقيقي: يعمل بلا JavaScript.
 */
export default async function ShopsPage({ searchParams }: Props) {
  const query = await searchParams;
  // ?name= لا ?q=: صندوق البحث في الرأس يقرأ q فيملأ نفسه باسم المتجر
  const q = query['name']?.trim() ?? '';
  const page = Math.max(1, Number(query['page']) || 1);
  const result = await getShops({ q, page });
  const pages = Math.ceil(result.total / result.pageSize);
  const pageHref = (n: number) => `/shops?${new URLSearchParams({ ...(q ? { name: q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;

  return (
    <div className="sd-cats sd-shopdir">
      <div className="page-head">
        <h1>كل المتاجر</h1>
        {result.total > 0 ? <span className="page-head__meta">{num(result.total)} متجر</span> : null}
      </div>

      <form className="sd-shopdir__search" action="/shops" role="search">
        <label className="visually-hidden" htmlFor="sd-shop-q">
          ابحث عن متجر بالاسم
        </label>
        <input id="sd-shop-q" className="field__control" type="search" name="name" defaultValue={q} placeholder="ابحث عن متجر بالاسم" />
        <button type="submit" className="btn btn--secondary">
          <Icon name="search" size={16} />
          ابحث
        </button>
      </form>

      {result.items.length > 0 ? (
        <div className="sd-shops sd-shops--dir">
          {result.items.map((s) => (
            <ShopCardLink key={s.id} shop={s} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="store"
          title={q ? `لا متجر باسم «${q}»` : 'لا متاجر بعد'}
          actions={
            q ? (
              <Link className="btn btn--secondary" href="/shops">
                كل المتاجر
              </Link>
            ) : (
              <Link className="btn btn--secondary" href="/vendor/register">
                افتح متجرك
              </Link>
            )
          }
        >
          {q ? 'جرّب جزءاً من الاسم، أو ابحث عن المنتج نفسه من صندوق البحث أعلى الصفحة.' : 'أول المتاجر تجهّز منتجاتها الآن.'}
        </EmptyState>
      )}

      {/* لا متجر بالجملة كاملة: ما في اسمه كلمة منها — «متجر الصوف» يدلّ على «بيت الصوف» (DISC-075) */}
      {result.items.length === 0 && result.suggestions?.length ? (
        <section className="sd-shopdir__near" aria-labelledby="sd-shop-near">
          <h2 id="sd-shop-near">متاجر قريبة من بحثك</h2>
          <div className="sd-shops sd-shops--dir">
            {result.suggestions.map((s) => (
              <ShopCardLink key={s.id} shop={s} />
            ))}
          </div>
        </section>
      ) : null}

      {pages > 1 ? (
        <nav className="sd-pager" aria-label="صفحات المتاجر">
          {page > 1 ? (
            <Link className="btn btn--secondary btn--sm" href={pageHref(page - 1)}>
              السابق
            </Link>
          ) : null}
          <span className="small muted">
            صفحة <span className="num">{num(page)}</span> من <span className="num">{num(pages)}</span>
          </span>
          {page < pages ? (
            <Link className="btn btn--secondary btn--sm" href={pageHref(page + 1)}>
              التالي
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function ShopCardLink({ shop: s }: { shop: ShopCard }) {
  return (
    <Link href={`/s/${encodeURIComponent(s.slug)}`} className="sd-shopcard">
      <span className="sd-shopcard__logo" aria-hidden>
        <Icon name="store" size={22} />
      </span>
      <span className="sd-shopcard__body">
        <span className="sd-shopcard__name">{s.nameAr}</span>
        <span className="sd-shopcard__meta">
          <span className="num">{num(s.productCount)}</span> منتج
          {s.ratingCount > 0 ? (
            <>
              {' · '}
              <Icon name="star-fill" size={11} />{' '}
              <span className="num">{s.ratingAvg.toFixed(1)}</span>
            </>
          ) : null}
        </span>
        {s.categories.length > 0 ? <span className="sd-shopcard__cats">{s.categories.join(' · ')}</span> : null}
      </span>
      <Icon name="chev-end" size={16} mirror className="sd-shopcard__chev" />
    </Link>
  );
}
