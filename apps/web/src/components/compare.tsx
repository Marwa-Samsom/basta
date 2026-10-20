'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { EmptyState, PageHead, Spinner } from '@/components/ui';
import {
  COMPARE_MAX,
  addToCompare,
  removeFromCompare,
  priceLabel,
  stockOf,
  useCompare,
  useProductPages,
  type CompareItem,
  type Fetched,
} from '@/lib/compare';
import { useHydrated } from '@/lib/recent';
import { imageUrl, num, type ProductPage } from '@/lib/storefront';

/** «منتج واحد» · «منتجان» · «3 منتجات» */
export function productCount(n: number): string {
  if (n === 1) return 'منتج واحد';
  if (n === 2) return 'منتجان';
  if (n >= 3 && n <= 10) return `${n} منتجات`;
  return `${n} منتجاً`;
}

// ================================================================ زرّ المقارنة

/**
 * «قارن» في صفحة المنتج — زرّ تبديل: مضغوط حين يكون المنتج في القائمة،
 * والضغط ثانيةً يزيله. اسمه ثابت («قارن») وحالته في aria-pressed.
 */
export function CompareToggle({ item }: { item: CompareItem }) {
  const list = useCompare();
  const inList = list.some((x) => x.slug === item.slug);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(t);
  }, [message]);

  function toggle(): void {
    if (inList) {
      removeFromCompare(item.slug);
      setMessage('أُزيل من المقارنة');
      return;
    }
    const result = addToCompare(item);
    if (result === 'added') setMessage('أُضيف إلى المقارنة');
    else if (result === 'full') setMessage(`الحد الأقصى ${COMPARE_MAX} منتجات للمقارنة. أزل منتجاً من الشريط أولاً.`);
  }

  return (
    <>
      <button
        type="button"
        className="sx-cmp-toggle"
        aria-pressed={inList}
        aria-label="قارن"
        title={inList ? 'في قائمة المقارنة — اضغط للإزالة' : 'أضف إلى المقارنة'}
        onClick={toggle}
      >
        <Icon name="scale" size={20} />
      </button>

      <p className="sx-toast" role="status">
        {message}
      </p>
    </>
  );
}

// ================================================================ شريط المقارنة

/**
 * الشريط العائم — يظهر ما دامت القائمة غير فارغة، ويلتصق بأسفل الشاشة
 * أثناء التمرير ثم يستقرّ في آخر الصفحة. أسماء المنتجات فيه قابلة للإزالة.
 */
export function CompareBar() {
  const list = useCompare();
  if (list.length === 0) return null;

  return (
    <aside className="sx-cmpbar" aria-label="شريط المقارنة">
      <span className="sx-cmpbar__lead">
        <span className="sx-cmpbar__icon" aria-hidden>
          <Icon name="scale" size={17} />
        </span>
        <span className="sx-cmpbar__text">
          <span className="sx-cmpbar__title">المقارنة: {productCount(list.length)}</span>
          <span className="sx-cmpbar__note">
            {list.length < 2 ? 'أضف منتجاً آخر لتقارن' : `حتى ${COMPARE_MAX} منتجات`}
          </span>
        </span>
      </span>
      <ul className="sx-cmpbar__items">
        {list.map((x) => (
          <li key={x.slug} className="sx-cmpbar__chip">
            <span className="sx-cmpbar__name">{x.nameAr}</span>
            <button
              type="button"
              className="sx-cmpbar__x"
              aria-label={`أزل ${x.nameAr} من المقارنة`}
              onClick={() => removeFromCompare(x.slug)}
            >
              <Icon name="x" size={12} />
            </button>
          </li>
        ))}
      </ul>
      <Link href="/compare" className="btn btn--primary sx-cmpbar__go">
        قارن الآن
        <Icon name="next" size={16} mirror />
      </Link>
    </aside>
  );
}

// ================================================================ صفحة المقارنة

interface Row {
  id: string;
  label: string;
  /** قيمة المقارنة لكل منتج مُحمَّل — تحدّد «مختلف» */
  keys: (string | null)[];
  cells: ReactNode[];
}

const attrValue = (a: ProductPage['attributes'][number]): string =>
  a.valueAr ?? a.number ?? (a.boolean === null ? '—' : a.boolean ? 'نعم' : 'لا');

/** صفوف الجدول من بيانات المنتجات الحيّة — لا صفّ بلا مصدر */
function buildRows(pages: Fetched[]): Row[] {
  const loaded = pages.map((p) => (p && p !== 'error' ? p : null));
  const pending = (p: Fetched): ReactNode =>
    p === undefined ? <span className="skeleton sx-cmp__skel" aria-hidden /> : <span className="sx-cmp__none">—</span>;

  const row = (id: string, label: string, get: (p: ProductPage) => { key: string; node: ReactNode }): Row => ({
    id,
    label,
    keys: loaded.map((p) => (p ? get(p).key : null)),
    cells: pages.map((p, i) => (loaded[i] ? get(loaded[i]).node : pending(p))),
  });

  const rows: Row[] = [
    row('price', 'السعر', (p) => {
      const { prefix, formatted } = priceLabel(p);
      return {
        key: `${p.priceFrom.minorUnits} ${p.priceFrom.currency}`,
        node: (
          <span className="sx-cmp__price">
            {prefix ? <span className="sx-cmp__from">{prefix}</span> : null}
            <span className="money num">{formatted}</span>
          </span>
        ),
      };
    }),
    row('stock', 'التوفّر', (p) => {
      const s = stockOf(p);
      return {
        key: s.tone,
        node: (
          <span className="sx-stock" data-tone={s.tone}>
            <span className="sx-stock__dot" aria-hidden />
            {s.label}
          </span>
        ),
      };
    }),
    row('shop', 'المتجر', (p) => ({
      key: p.vendor.id,
      node: (
        <Link href={`/s/${p.vendor.slug}`} className="sx-cmp__shop">
          <Icon name="store" size={14} />
          {p.vendor.nameAr}
        </Link>
      ),
    })),
    row('rating', 'تقييم المتجر', (p) =>
      p.vendor.ratingCount > 0
        ? {
            key: `${p.vendor.ratingAvg.toFixed(1)}/${p.vendor.ratingCount}`,
            node: (
              <span className="sx-cmp__rating">
                <Icon name="star-fill" size={14} className="sx-cmp__star" />
                <span className="num">{p.vendor.ratingAvg.toFixed(1)}</span>
                <span className="sx-cmp__muted">
                  (<span className="num">{num(p.vendor.ratingCount)}</span>)
                </span>
              </span>
            ),
          }
        : { key: 'none', node: <span className="sx-cmp__muted">لا تقييمات بعد</span> },
    ),
    row('shipping', 'الشحن', (p) => ({
      key: p.vendor.shippingPolicyAr ?? '',
      node: p.vendor.shippingPolicyAr ? (
        <span className="sx-cmp__prose">{p.vendor.shippingPolicyAr}</span>
      ) : (
        <span className="sx-cmp__muted">يحدّده البائع عند الطلب</span>
      ),
    })),
  ];

  if (loaded.some((p) => p?.brand)) {
    rows.push(
      row('brand', 'العلامة التجارية', (p) => ({ key: p.brand?.id ?? '', node: p.brand?.nameAr ?? '—' })),
    );
  }

  // محاور المتغيّرات (المقاس، اللون…) بترتيب أول ظهور
  const axes = new Map<string, string>();
  for (const p of loaded) for (const v of p?.variants ?? []) for (const o of v.options) axes.set(o.attributeId, o.nameAr);
  for (const [attributeId, nameAr] of axes) {
    rows.push(
      row(`axis-${attributeId}`, nameAr, (p) => {
        const values = [
          ...new Set(p.variants.flatMap((v) => v.options.filter((o) => o.attributeId === attributeId).map((o) => o.valueAr))),
        ];
        const text = values.length ? values.join(' · ') : '—';
        return { key: text, node: text };
      }),
    );
  }

  // سمات القسم
  const attrs = new Map<string, string>();
  for (const p of loaded) for (const a of p?.attributes ?? []) if (!axes.has(a.attributeId)) attrs.set(a.attributeId, a.nameAr);
  for (const [attributeId, nameAr] of attrs) {
    rows.push(
      row(`attr-${attributeId}`, nameAr, (p) => {
        const a = p.attributes.find((x) => x.attributeId === attributeId);
        const text = a ? attrValue(a) : '—';
        return { key: text, node: text };
      }),
    );
  }

  return rows;
}

const differs = (keys: (string | null)[]): boolean => {
  const known = keys.filter((k): k is string => k !== null);
  return known.length > 1 && known.some((k) => k !== known[0]);
};

export function CompareView() {
  const hydrated = useHydrated();
  const list = useCompare();
  const [attempt, setAttempt] = useState(0);
  const [highlight, setHighlight] = useState(false);
  const pages = useProductPages(
    list.map((x) => x.slug),
    attempt,
  );

  if (!hydrated) {
    return (
      <div className="sx-page">
        <PageHead title="قارن المنتجات" />
        <Spinner label="جارٍ فتح قائمة المقارنة…" />
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="sx-page">
        <PageHead title="قارن المنتجات" />
        <div className="card">
          <EmptyState
            icon="scale"
            title="لا منتجات للمقارنة"
            actions={
              <Link className="btn btn--primary" href="/shops">
                تصفّح المتاجر
              </Link>
            }
          >
            أضف حتى أربعة منتجات من زرّ المقارنة في صفحة المنتج.
          </EmptyState>
        </div>
      </div>
    );
  }

  const fetched = list.map((x) => pages[x.slug]);
  const failed = fetched.some((p) => p === 'error');
  const rows = buildRows(fetched);

  return (
    <div className="sx-page">
      <PageHead
        title="قارن المنتجات"
        meta={
          <>
            <span className="num">{list.length}</span> من <span className="num">{COMPARE_MAX}</span> منتجات
          </>
        }
        actions={
          <button
            type="button"
            role="switch"
            aria-checked={highlight}
            className="sx-switch"
            onClick={() => setHighlight((v) => !v)}
          >
            <span className="sx-switch__track" aria-hidden>
              <span className="sx-switch__thumb" />
            </span>
            أبرِز الفروق
          </button>
        }
      />

      {failed ? (
        <div className="alert alert--danger" role="alert">
          <p>تعذّر تحميل بعض المنتجات. تحقّق من الاتصال ثم أعد المحاولة.</p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAttempt((n) => n + 1)}>
            <Icon name="refresh" size={15} />
            أعد المحاولة
          </button>
        </div>
      ) : null}

      <div className="sx-cmp__scroll card" role="region" aria-label="جدول المقارنة" tabIndex={0}>
        <table className="sx-cmp__table" style={{ '--sx-cols': list.length } as CSSProperties}>
          <thead>
            <tr>
              <th scope="col" className="sx-cmp__corner">
                المنتج
              </th>
              {list.map((x, i) => (
                <ProductHead key={x.slug} item={x} page={fetched[i]} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = highlight && differs(r.keys);
              return (
                <tr key={r.id} data-differs={diff || undefined}>
                  <th scope="row">
                    <span className="sx-cmp__label">{r.label}</span>
                    {diff ? <span className="sx-cmp__diff">مختلف</span> : null}
                  </th>
                  {r.cells.map((c, i) => (
                    <td key={list[i]!.slug}>{c}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {list.length < COMPARE_MAX ? (
        <p className="sx-cmp__more">
          <Icon name="info" size={15} />
          {list.length < 2 ? 'أضف منتجاً آخر لتقارن.' : 'يمكنك إضافة منتجات أخرى.'}{' '}
          <Link href="/shops">تصفّح المتاجر</Link>
        </p>
      ) : null}
    </div>
  );
}

function ProductHead({ item, page }: { item: CompareItem; page: Fetched }) {
  const live = page && page !== 'error' ? page : null;
  const thumb = imageUrl(live?.images[0]?.urls['thumb'] ?? item.thumb);
  const name = live?.nameAr ?? item.nameAr;

  return (
    <th scope="col" className="sx-cmp__head">
      <span className="sx-cmp__media">
        <span className="sx-cmp__thumb" aria-hidden>
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" width={56} height={70} loading="lazy" />
          ) : (
            <Icon name="image" size={22} />
          )}
        </span>
        <button
          type="button"
          className="sx-cmp__remove"
          aria-label={`أزل ${name} من المقارنة`}
          onClick={() => removeFromCompare(item.slug)}
        >
          <Icon name="x" size={15} />
        </button>
      </span>
      {page === null ? (
        <span className="sx-cmp__name">
          {name}
          <span className="sx-cmp__gone">لم يعد معروضاً في المتجر</span>
        </span>
      ) : (
        <Link href={`/p/${item.slug}`} className="sx-cmp__name">
          {name}
        </Link>
      )}
    </th>
  );
}
