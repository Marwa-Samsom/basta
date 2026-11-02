'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
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
import type { Locale, Translate } from '@/lib/i18n';
import { useHydrated } from '@/lib/recent';
import { imageUrl, num, type ProductPage } from '@/lib/storefront';

/** «منتج واحد» · «منتجان» · «3 منتجات» */
export function productCount(n: number, locale: Locale = 'ar'): string {
  if (locale === 'en') return `${n} ${n === 1 ? 'product' : 'products'}`;
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
  const t = useT();
  const list = useCompare();
  const inList = list.some((x) => x.slug === item.slug);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  function toggle(): void {
    if (inList) {
      removeFromCompare(item.slug);
      setMessage(t('أُزيل من المقارنة', 'Removed from compare'));
      return;
    }
    const result = addToCompare(item);
    if (result === 'added') setMessage(t('أُضيف إلى المقارنة', 'Added to compare'));
    else if (result === 'full')
      setMessage(
        t(
          `الحد الأقصى ${COMPARE_MAX} منتجات للمقارنة. أزل منتجاً من الشريط أولاً.`,
          `You can compare up to ${COMPARE_MAX} products. Remove one from the bar first.`,
        ),
      );
  }

  return (
    <>
      <button
        type="button"
        className="sx-cmp-toggle"
        aria-pressed={inList}
        aria-label={t('قارن', 'Compare')}
        title={inList ? t('في قائمة المقارنة — اضغط للإزالة', 'In your compare list — press to remove') : t('أضف إلى المقارنة', 'Add to compare')}
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
  const t = useT();
  const locale = useLocale();
  const list = useCompare();
  if (list.length === 0) return null;

  return (
    <aside className="sx-cmpbar" aria-label={t('شريط المقارنة', 'Compare bar')}>
      <span className="sx-cmpbar__lead">
        <span className="sx-cmpbar__icon" aria-hidden>
          <Icon name="scale" size={17} />
        </span>
        <span className="sx-cmpbar__text">
          <span className="sx-cmpbar__title">
            {t(`المقارنة: ${productCount(list.length)}`, `Compare: ${productCount(list.length, locale)}`)}
          </span>
          <span className="sx-cmpbar__note">
            {list.length < 2 ? t('أضف منتجاً آخر لتقارن', 'Add another product to compare') : t(`حتى ${COMPARE_MAX} منتجات`, `Up to ${COMPARE_MAX} products`)}
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
              aria-label={t(`أزل ${x.nameAr} من المقارنة`, `Remove ${x.nameAr} from compare`)}
              onClick={() => removeFromCompare(x.slug)}
            >
              <Icon name="x" size={12} />
            </button>
          </li>
        ))}
      </ul>
      <Link href="/compare" className="btn btn--primary sx-cmpbar__go">
        {t('قارن الآن', 'Compare now')}
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

const attrValue = (a: ProductPage['attributes'][number], t: Translate): string =>
  a.valueAr ?? a.number ?? (a.boolean === null ? '—' : a.boolean ? t('نعم', 'Yes') : t('لا', 'No'));

/** صفوف الجدول من بيانات المنتجات الحيّة — لا صفّ بلا مصدر */
function buildRows(pages: Fetched[], t: Translate, locale: Locale): Row[] {
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
    row('price', t('السعر', 'Price'), (p) => {
      const { prefix, formatted } = priceLabel(p, locale);
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
    row('stock', t('التوفّر', 'Availability'), (p) => {
      const s = stockOf(p, locale);
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
    row('shop', t('المتجر', 'Shop'), (p) => ({
      key: p.vendor.id,
      node: (
        <Link href={`/s/${p.vendor.slug}`} className="sx-cmp__shop">
          <Icon name="store" size={14} />
          {p.vendor.nameAr}
        </Link>
      ),
    })),
    row('rating', t('تقييم المتجر', 'Shop rating'), (p) =>
      p.vendor.ratingCount > 0
        ? {
            key: `${p.vendor.ratingAvg.toFixed(1)}/${p.vendor.ratingCount}`,
            node: (
              <span className="sx-cmp__rating">
                <Icon name="star-fill" size={14} className="sx-cmp__star" />
                <span className="num">{p.vendor.ratingAvg.toFixed(1)}</span>
                <span className="sx-cmp__muted">
                  (<span className="num">{num(p.vendor.ratingCount, locale)}</span>)
                </span>
              </span>
            ),
          }
        : { key: 'none', node: <span className="sx-cmp__muted">{t('لا تقييمات بعد', 'No ratings yet')}</span> },
    ),
    row('shipping', t('الشحن', 'Shipping'), (p) => ({
      key: p.vendor.shippingPolicyAr ?? '',
      node: p.vendor.shippingPolicyAr ? (
        <span className="sx-cmp__prose">{p.vendor.shippingPolicyAr}</span>
      ) : (
        <span className="sx-cmp__muted">{t('يحدّده البائع عند الطلب', 'Set by the seller at order time')}</span>
      ),
    })),
  ];

  if (loaded.some((p) => p?.brand)) {
    rows.push(
      row('brand', t('العلامة التجارية', 'Brand'), (p) => ({ key: p.brand?.id ?? '', node: p.brand?.nameAr ?? '—' })),
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
        const text = a ? attrValue(a, t) : '—';
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
  const t = useT();
  const locale = useLocale();
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
        <PageHead title={t('قارن المنتجات', 'Compare products')} />
        <Spinner label={t('جارٍ فتح قائمة المقارنة…', 'Opening your compare list…')} />
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="sx-page">
        <PageHead title={t('قارن المنتجات', 'Compare products')} />
        <div className="card">
          <EmptyState
            icon="scale"
            title={t('لا منتجات للمقارنة', 'No products to compare')}
            actions={
              <Link className="btn btn--primary" href="/shops">
                {t('تصفّح المتاجر', 'Browse shops')}
              </Link>
            }
          >
            {t('أضف حتى أربعة منتجات من زرّ المقارنة في صفحة المنتج.', 'Add up to four products with the compare button on the product page.')}
          </EmptyState>
        </div>
      </div>
    );
  }

  const fetched = list.map((x) => pages[x.slug]);
  const failed = fetched.some((p) => p === 'error');
  const rows = buildRows(fetched, t, locale);

  return (
    <div className="sx-page">
      <PageHead
        title={t('قارن المنتجات', 'Compare products')}
        meta={
          <>
            <span className="num">{list.length}</span> {t('من', 'of')} <span className="num">{COMPARE_MAX}</span>{' '}
            {t('منتجات', 'products')}
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
            {t('أبرِز الفروق', 'Highlight differences')}
          </button>
        }
      />

      {failed ? (
        <div className="alert alert--danger" role="alert">
          <p>{t('تعذّر تحميل بعض المنتجات. تحقّق من الاتصال ثم أعد المحاولة.', "Some products couldn't be loaded. Check your connection, then try again.")}</p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAttempt((n) => n + 1)}>
            <Icon name="refresh" size={15} />
            {t('أعد المحاولة', 'Try again')}
          </button>
        </div>
      ) : null}

      <div className="sx-cmp__scroll card" role="region" aria-label={t('جدول المقارنة', 'Comparison table')} tabIndex={0}>
        <table className="sx-cmp__table" style={{ '--sx-cols': list.length } as CSSProperties}>
          <thead>
            <tr>
              <th scope="col" className="sx-cmp__corner">
                {t('المنتج', 'Product')}
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
                    {diff ? <span className="sx-cmp__diff">{t('مختلف', 'Differs')}</span> : null}
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
          {list.length < 2 ? t('أضف منتجاً آخر لتقارن.', 'Add another product to compare.') : t('يمكنك إضافة منتجات أخرى.', 'You can add more products.')}{' '}
          <Link href="/shops">{t('تصفّح المتاجر', 'Browse shops')}</Link>
        </p>
      ) : null}
    </div>
  );
}

function ProductHead({ item, page }: { item: CompareItem; page: Fetched }) {
  const t = useT();
  const locale = useLocale();
  const live = page && page !== 'error' ? page : null;
  const thumb = imageUrl(live?.images[0]?.urls['thumb'] ?? item.thumb);
  const name = (locale === 'en' ? live?.nameEn : null) ?? live?.nameAr ?? item.nameAr;

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
          aria-label={t(`أزل ${name} من المقارنة`, `Remove ${name} from compare`)}
          onClick={() => removeFromCompare(item.slug)}
        >
          <Icon name="x" size={15} />
        </button>
      </span>
      {page === null ? (
        <span className="sx-cmp__name">
          {name}
          <span className="sx-cmp__gone">{t('لم يعد معروضاً في المتجر', 'No longer listed in the shop')}</span>
        </span>
      ) : (
        <Link href={`/p/${item.slug}`} className="sx-cmp__name">
          {name}
        </Link>
      )}
    </th>
  );
}
