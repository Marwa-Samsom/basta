import Link from 'next/link';
import { DismissableDetails } from '@/components/dismissable-details';
import { Icon } from '@/components/icons';
import { ProductGrid } from '@/components/product-card';
import { num, type ListResult } from '@/lib/storefront';

type Search = Record<string, string | undefined>;

/** معاملات التصفية — ما عداها (البحث والترتيب) يبقى عند «أزل الكل» */
const FILTER_KEYS = ['inStock', 'attrs', 'vendorId'] as const;

/** رابط يغيّر معاملاً واحداً ويُبقي الباقي — الأوجه روابط لا نماذج، فتعمل بلا سكربت */
function withParam(base: string, current: Search, key: string, value: string | undefined): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v && k !== key && k !== 'page') next.set(k, v);
  if (value) next.set(key, value);
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
}

/** رابط بلا أي تصفية — يُبقي كلمة البحث والترتيب */
function withoutFilters(base: string, current: Search): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v && k !== 'page' && !(FILTER_KEYS as readonly string[]).includes(k)) next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
}

function toggleAttr(current: Search, valueId: string): string | undefined {
  const set = new Set((current['attrs'] ?? '').split(',').filter(Boolean));
  if (set.has(valueId)) set.delete(valueId);
  else set.add(valueId);
  return set.size > 0 ? [...set].join(',') : undefined;
}

/** هل في العنوان تصفية مطبّقة؟ — تُفرّق «لا نتائج بعد التصفية» عن «لا منتجات أصلاً» */
export function hasFilters(params: Search): boolean {
  return FILTER_KEYS.some((k) => Boolean(params[k]));
}

/**
 * مسار التصفّح — ST-03 و ST-04 و ST-07. الأخير نصّ لا رابط: هو الصفحة نفسها.
 */
export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="sd-crumbs" aria-label="مسار التصفّح">
      <ol>
        {items.map((c, i) => (
          <li key={`${i}-${c.label}`}>
            {i > 0 ? <Icon name="chev-end" size={12} mirror className="sd-crumbs__sep" /> : null}
            {c.href ? (
              <Link href={c.href}>{c.label}</Link>
            ) : (
              <span className="sd-crumbs__here" aria-current="page">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const SORTS = [
  { key: 'relevance', label: 'الأكثر ملاءمة' },
  { key: 'newest', label: 'الأحدث' },
  { key: 'price_asc', label: 'السعر من الأقل' },
  { key: 'price_desc', label: 'السعر من الأعلى' },
] as const;

/** مربّع اختيار مرسوم داخل رابط — الرابط هو العنصر التفاعلي، والمربّع زينة */
function Check({ on }: { on: boolean }) {
  return (
    <span className="sd-check" data-on={on} aria-hidden>
      <Icon name="check" size={11} />
    </span>
  );
}

/** مجموعات الأوجه — تُصيَّر في الشريط الجانبي على الشاشة الواسعة وفي درج «تصفية» على الجوال */
function FacetGroups({ base, params, result }: { base: string; params: Search; result: ListResult }) {
  const selectedAttrs = new Set((params['attrs'] ?? '').split(',').filter(Boolean));
  const inStock = params['inStock'] === 'true';

  return (
    <>
      <section className="sd-facet">
        <h3 className="sd-facet__title">التوفّر</h3>
        <Link
          className="sd-facet__item"
          href={withParam(base, params, 'inStock', inStock ? undefined : 'true')}
          {...(inStock ? { 'aria-current': 'true' as const } : {})}
        >
          <Check on={inStock} />
          <span className="sd-facet__label">المتوفّر فقط</span>
        </Link>
      </section>

      {result.facets.attributes.map((attr) => (
        <section key={attr.attributeId} className="sd-facet">
          <h3 className="sd-facet__title">{attr.nameAr}</h3>
          <div className="sd-facet__chips">
            {attr.values.map((v) => (
              <Link
                key={v.id}
                className="sd-fchip"
                href={withParam(base, params, 'attrs', toggleAttr(params, v.id))}
                {...(selectedAttrs.has(v.id) ? { 'aria-current': 'true' as const } : {})}
              >
                {v.label} <span className="num sd-fchip__count">{num(v.count)}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {result.facets.vendors.length > 1 ? (
        <section className="sd-facet">
          <h3 className="sd-facet__title">المتجر</h3>
          {result.facets.vendors.map((v) => {
            const on = params['vendorId'] === v.id;
            return (
              <Link
                key={v.id}
                className="sd-facet__item"
                href={withParam(base, params, 'vendorId', on ? undefined : v.id)}
                {...(on ? { 'aria-current': 'true' as const } : {})}
              >
                <Check on={on} />
                <span className="sd-facet__label">{v.label}</span>
                <span className="num sd-facet__count">{num(v.count)}</span>
              </Link>
            );
          })}
        </section>
      ) : null}
    </>
  );
}

/**
 * قائمة بأوجه تصفية — ST-03 و ST-04.
 *
 * **كل وجه رابط لا زرّ:** الحالة في العنوان، فالصفحة المصفّاة تُشارك
 * وتُفهرس وتعمل بلا JavaScript، وزرّ الرجوع يعيد الفلتر السابق.
 * والترتيب ودرج التصفية على الجوال `<details>` — يُفتحان بلا سكربت كذلك.
 */
export function Listing({
  base,
  params,
  result,
  title,
  crumbs,
  subcats,
  empty,
}: {
  base: string;
  params: Search;
  result: ListResult;
  /** عنوان الصفحة — يُصيَّر h1 */
  title: React.ReactNode;
  /** مسار التصفّح فوق العنوان */
  crumbs: React.ReactNode;
  /** رقائق الفروع تحت العنوان (ST-03) */
  subcats?: React.ReactNode;
  empty: React.ReactNode;
}) {
  const selectedAttrs = (params['attrs'] ?? '').split(',').filter(Boolean);
  const activeSort = params['sort'] ?? 'relevance';
  const activeSortLabel = SORTS.find((s) => s.key === activeSort)?.label ?? SORTS[0].label;
  const pages = Math.ceil(result.total / result.pageSize);

  // التصفية المطبّقة — بتسمياتها من الأوجه نفسها لا من المعرّفات
  const attrLabel = new Map<string, string>();
  for (const a of result.facets.attributes) for (const v of a.values) attrLabel.set(v.id, `${a.nameAr}: ${v.label}`);
  const applied: { key: string; label: string; href: string }[] = [];
  if (params['inStock'] === 'true') {
    applied.push({ key: 'inStock', label: 'المتوفّر فقط', href: withParam(base, params, 'inStock', undefined) });
  }
  for (const id of selectedAttrs) {
    applied.push({
      key: `attr-${id}`,
      label: attrLabel.get(id) ?? 'تصفية',
      href: withParam(base, params, 'attrs', toggleAttr(params, id)),
    });
  }
  if (params['vendorId']) {
    applied.push({
      key: 'vendor',
      label: result.facets.vendors.find((v) => v.id === params['vendorId'])?.label ?? 'المتجر',
      href: withParam(base, params, 'vendorId', undefined),
    });
  }

  const from = (result.page - 1) * result.pageSize + 1;
  const to = from + result.items.length - 1;

  return (
    <div className="sd-list">
      {crumbs}

      <div className="sd-list__head">
        <div className="sd-list__titles">
          <h1 className="sd-list__title">{title}</h1>
          <p className="sd-list__count">
            <span className="num">{num(result.total)}</span> نتيجة
          </p>
        </div>

        <DismissableDetails className="sd-sort" closeOnSelect>
          <summary className="sd-sort__btn">
            <span className="sd-sort__cap">الترتيب</span>
            {activeSortLabel}
            <Icon name="chev-down" size={15} className="sd-sort__chev" />
          </summary>
          <nav className="sd-sort__menu" aria-label="الترتيب">
            {SORTS.map((s) => (
              <Link
                key={s.key}
                href={withParam(base, params, 'sort', s.key === 'relevance' ? undefined : s.key)}
                aria-current={activeSort === s.key ? 'true' : undefined}
                className="sd-sort__opt"
              >
                {activeSort === s.key ? <Icon name="check" size={14} /> : <span className="sd-sort__pad" />}
                {s.label}
              </Link>
            ))}
          </nav>
        </DismissableDetails>
      </div>

      {subcats}

      {applied.length > 0 ? (
        <div className="sd-applied">
          <span className="sd-applied__cap">التصفية المطبّقة</span>
          {applied.map((a) => (
            <Link key={a.key} href={a.href} className="sd-applied__chip" aria-label={`أزل التصفية: ${a.label}`}>
              {a.label}
              <Icon name="x" size={12} />
            </Link>
          ))}
          <Link href={withoutFilters(base, params)} className="sd-applied__clear">
            أزل الكل
          </Link>
        </div>
      ) : null}

      {/* الجوال: التصفية زرّ يفتح درجاً فوق النتائج */}
      <DismissableDetails className="sd-facets-m">
        <summary className="sd-facets-m__btn">
          <Icon name="filter" size={16} />
          تصفية
          {applied.length > 0 ? <span className="num sd-facets-m__count">{num(applied.length)}</span> : null}
        </summary>
        <div className="sd-facets-m__body" aria-label="تصفية النتائج" role="group">
          <FacetGroups base={base} params={params} result={result} />
        </div>
      </DismissableDetails>

      <div className="sd-list__layout">
        <aside className="sd-facets" aria-label="تصفية النتائج">
          <FacetGroups base={base} params={params} result={result} />
        </aside>

        <div className="sd-list__results">
          {result.items.length > 0 ? <ProductGrid products={result.items} /> : empty}

          {result.items.length > 0 ? (
            <div className="sd-pager">
              {pages > 1 ? (
                <nav className="sd-pager__pages" aria-label="الصفحات">
                  {Array.from({ length: Math.min(pages, 10) }, (_, i) => i + 1).map((p) => (
                    <Link
                      key={p}
                      className="sd-pager__page"
                      href={withParam(base, params, 'page', p === 1 ? undefined : String(p))}
                      aria-current={result.page === p ? 'page' : undefined}
                    >
                      <span className="num">{num(p)}</span>
                    </Link>
                  ))}
                </nav>
              ) : null}
              <span className="sd-pager__shown">
                يُعرض <span className="num">{num(from)}</span>–<span className="num">{num(to)}</span> من{' '}
                <span className="num">{num(result.total)}</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
