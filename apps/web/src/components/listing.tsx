import Link from 'next/link';
import { ProductGrid } from '@/components/product-card';
import { num, type ListResult } from '@/lib/storefront';

type Search = Record<string, string | undefined>;

/** رابط يغيّر معاملاً واحداً ويُبقي الباقي — الأوجه روابط لا نماذج، فتعمل بلا سكربت */
function withParam(base: string, current: Search, key: string, value: string | undefined): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v && k !== key && k !== 'page') next.set(k, v);
  if (value) next.set(key, value);
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
}

function toggleAttr(current: Search, valueId: string): string | undefined {
  const set = new Set((current['attrs'] ?? '').split(',').filter(Boolean));
  if (set.has(valueId)) set.delete(valueId);
  else set.add(valueId);
  return set.size > 0 ? [...set].join(',') : undefined;
}

const SORTS = [
  { key: 'relevance', label: 'الأنسب' },
  { key: 'newest', label: 'الأحدث' },
  { key: 'price_asc', label: 'الأرخص' },
  { key: 'price_desc', label: 'الأغلى' },
] as const;

/**
 * قائمة بأوجه تصفية — ST-03 و ST-04.
 *
 * **كل وجه رابط لا زرّ:** الحالة في العنوان، فالصفحة المصفّاة تُشارك
 * وتُفهرس وتعمل بلا JavaScript، وزرّ الرجوع يعيد الفلتر السابق.
 */
export function Listing({
  base,
  params,
  result,
  empty,
}: {
  base: string;
  params: Search;
  result: ListResult;
  empty: React.ReactNode;
}) {
  const selectedAttrs = new Set((params['attrs'] ?? '').split(',').filter(Boolean));
  const activeSort = params['sort'] ?? 'relevance';
  const pages = Math.ceil(result.total / result.pageSize);

  return (
    <div className="listing">
      <aside className="facets" aria-label="تصفية النتائج">
        {params['inStock'] === 'true' ? (
          <Link className="chip chip--on" href={withParam(base, params, 'inStock', undefined)}>
            المتوفّر فقط ✕
          </Link>
        ) : (
          <Link className="chip" href={withParam(base, params, 'inStock', 'true')}>
            المتوفّر فقط
          </Link>
        )}

        {result.facets.attributes.map((attr) => (
          <section key={attr.attributeId} className="facet">
            <h3 className="facet__title">{attr.nameAr}</h3>
            <div className="chips">
              {attr.values.map((v) => (
                <Link
                  key={v.id}
                  className={`chip ${selectedAttrs.has(v.id) ? 'chip--on' : ''}`}
                  href={withParam(base, params, 'attrs', toggleAttr(params, v.id))}
                  aria-pressed={selectedAttrs.has(v.id)}
                >
                  {v.label} <span className="num muted">{num(v.count)}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}

        {result.facets.vendors.length > 1 ? (
          <section className="facet">
            <h3 className="facet__title">المتجر</h3>
            <div className="chips">
              {result.facets.vendors.map((v) => (
                <Link
                  key={v.id}
                  className={`chip ${params['vendorId'] === v.id ? 'chip--on' : ''}`}
                  href={withParam(base, params, 'vendorId', params['vendorId'] === v.id ? undefined : v.id)}
                >
                  {v.label} <span className="num muted">{num(v.count)}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </aside>

      <div className="stack">
        <div className="row row--between">
          <p className="small muted">
            <span className="num">{num(result.total)}</span> نتيجة
          </p>
          <nav className="row small" aria-label="الترتيب">
            {SORTS.map((s) => (
              <Link
                key={s.key}
                href={withParam(base, params, 'sort', s.key === 'relevance' ? undefined : s.key)}
                aria-current={activeSort === s.key ? 'true' : undefined}
                className={activeSort === s.key ? 'sort sort--on' : 'sort'}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        </div>

        {result.items.length > 0 ? <ProductGrid products={result.items} /> : empty}

        {pages > 1 ? (
          <nav className="row" aria-label="الصفحات">
            {Array.from({ length: Math.min(pages, 10) }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                className={`chip ${result.page === p ? 'chip--on' : ''}`}
                href={withParam(base, params, 'page', p === 1 ? undefined : String(p))}
                aria-current={result.page === p ? 'page' : undefined}
              >
                <span className="num">{num(p)}</span>
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
