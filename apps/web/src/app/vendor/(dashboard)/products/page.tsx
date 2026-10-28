'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, EmptyState, MoreButton, PageHead, SortButton, Spinner, type SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ProductThumb } from '@/components/product-editor';
import {
  num,
  PRODUCT_STATUS,
  type Page,
  type ProductListItem,
  type ProductStatus,
  type VendorCategory,
} from '@/lib/catalog';

type TabKey = ProductStatus | 'all';

/**
 * التاريخ نصّ عربي باسم الشهر لا رقم: بصيغة «26/9/2026» العربية علامات
 * اتجاه خفية، فإن وُضع في خلية `num` اللاتينية انقلب إلى «262026/9/».
 */
const DAY = 86_400_000;
const CLOCK = new Intl.DateTimeFormat('ar-u-nu-latn', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DAY_MONTH = new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * «آخر تعديل» كالتصميم (VD-06): «اليوم · 09:40»، «أمس · 18:20»، ثم «11 سبتمبر» — وبالسنة إن لم تكن
 * هذه. كان dateStyle: 'medium'، وهو في العربية أرقام وحدها «2026/10/28» (VCAT-001، 28 أكتوبر 2026).
 */
function edited(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return `اليوم · ${CLOCK.format(at)}`;
  if (days === 1) return `أمس · ${CLOCK.format(at)}`;
  return (at.getFullYear() === now.getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(at);
}

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'draft', label: 'مسوّدة' },
  { key: 'active', label: 'منشور' },
  { key: 'rejected', label: 'موقوف' },
  { key: 'archived', label: 'مؤرشف' },
];

/**
 * VD-07 — قائمة المنتجات.
 *
 * التبويب والبحث يُرسلان إلى الخادم لا يُصفّيان صفحةً محمّلة: البائع صاحب
 * 500 منتج لا تُحمَّل عنده القائمة كلها ليبحث فيها. وعدّاد كل تبويب مجموعه
 * من الخادم (`total` بصفحة من سطر واحد) لا عدّ ما في الصفحة.
 */
/**
 * التبويب الأول من `?status=` — تقرير الاستيراد يفتح المسوّدات مباشرة.
 * الصفحة لا تُصيَّر في الخادم (القشرة تنتظر حالة المتجر أولاً)، فقراءة
 * العنوان هنا لا تُحدث اختلافاً بين الخادم والمتصفّح.
 */
const initialTab = (): TabKey => {
  if (typeof window === 'undefined') return 'all';
  const wanted = new URLSearchParams(window.location.search).get('status');
  return TABS.find((t) => t.key === wanted)?.key ?? 'all';
};

/** الفئة من `?category=` — صفحة الفئات تفتح منتجات فئة بعينها، أو none لما بلا فئة */
const initialCategory = (): string =>
  typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('category') ?? '');

export default function ProductsPage() {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(initialCategory);
  // بتاريخ آخر تعديل
  const [sort, setSort] = useState<SortOrder>('newest');
  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [page, setPage] = useState<Page<ProductListItem> | null>(null);
  const [counts, setCounts] = useState<Partial<Record<TabKey, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // «المزيد»: الصفحات التالية تُلحق بالأولى، ومفتاح القائمة يمنع إلحاق صفحة بحث سابق بغيره
  const [extra, setExtra] = useState<ProductListItem[]>([]);
  // كم ألحقت كل ضغطة «المزيد» — «السابق» يُسقط آخرها بقدرها
  const [batches, setBatches] = useState<number[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const listKey = useRef('');

  const load = useCallback(
    async (status: TabKey, term: string, cat: string, order: SortOrder): Promise<void> => {
      const params = new URLSearchParams({ pageSize: '20', sort: order });
      if (status !== 'all') params.set('status', status);
      if (term.trim()) params.set('search', term.trim());
      if (cat) params.set('category', cat);
      try {
        const next = await api<Page<ProductListItem>>(`/vendor/products?${params.toString()}`);
        listKey.current = params.toString();
        setPage(next);
        setExtra([]);
        setBatches([]);
        setMoreError(null);
        setExhausted(false);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذّر تحميل المنتجات.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(tab, search, category, sort), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [tab, search, category, sort, load]);

  // قائمة الفئات للتصفية — فشلها يُبقي القائمة بلا تصفية لا يمنعها
  useEffect(() => {
    let alive = true;
    api<VendorCategory[]>('/vendor/categories')
      .then((list) => alive && setCategories(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // عدّادات التبويبات — مرة عند الفتح؛ فشلها لا يمنع القائمة، فالتبويب يبقى بلا رقم
  useEffect(() => {
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        TABS.map(async (t) => {
          const q = t.key === 'all' ? 'pageSize=1' : `status=${t.key}&pageSize=1`;
          try {
            const res = await api<Page<ProductListItem>>(`/vendor/products?${q}`);
            return [t.key, res.total] as const;
          } catch {
            return null;
          }
        }),
      );
      if (!alive) return;
      setCounts(Object.fromEntries(entries.filter((e) => e !== null)));
    })();
    return () => {
      alive = false;
    };
  }, []);

  // الأولى وما أُلحق بها، بلا صفّ مكرّر إن تحرّكت القائمة بين صفحتين
  const items = page ? [...page.items, ...extra].filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i) : [];

  const loadMore = async (): Promise<void> => {
    if (!page) return;
    const key = listKey.current;
    const params = new URLSearchParams(key);
    params.set('page', String(Math.floor((page.items.length + extra.length) / page.pageSize) + 1));
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await api<Page<ProductListItem>>(`/vendor/products?${params.toString()}`);
      if (listKey.current !== key) return;
      setExtra((e) => [...e, ...next.items]);
      setBatches((b) => [...b, next.items.length]);
      if (next.items.length === 0) setExhausted(true);
    } catch (err) {
      if (listKey.current === key) setMoreError(err instanceof Error ? err.message : 'تعذّر تحميل المزيد.');
    } finally {
      setLoadingMore(false);
    }
  };

  const loadLess = (): void => {
    const last = batches.at(-1);
    if (last === undefined) return;
    setExtra((e) => e.slice(0, e.length - last));
    setBatches((b) => b.slice(0, -1));
    setExhausted(false);
    setMoreError(null);
  };

  const filtered = Boolean(search.trim()) || tab !== 'all' || Boolean(category);
  const storeEmpty = page !== null && page.items.length === 0 && !filtered;
  const total = counts.all;

  return (
    <div className="vp-page">
      <PageHead
        title="المنتجات"
        count={
          total !== undefined
            ? page && filtered
              ? `${num(total)} منتج · ${num(page.total)} معروض`
              : `${num(total)} منتج`
            : undefined
        }
        actions={
          <>
            <Link className="btn btn--secondary" href="/vendor/products/import">
              <Icon name="upload" size={16} />
              استيراد
            </Link>
            <Link className="btn btn--primary" href="/vendor/products/new">
              <Icon name="plus" size={16} />
              أضف منتجاً
            </Link>
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {storeEmpty ? (
        <EmptyState
          icon="package"
          title="لا منتجات بعد"
          actions={
            <>
              <Link className="btn btn--primary" href="/vendor/products/new">
                <Icon name="plus" size={16} />
                أضف منتجاً يدوياً
              </Link>
              <Link className="btn btn--secondary" href="/vendor/products/import">
                <Icon name="upload" size={16} />
                استورد ملفاً
              </Link>
            </>
          }
        >
          ابدأ بمنتج واحد لتفهم الشكل، أو ارفع ملفاً إن كان عندك كتالوج جاهز. المسوّدات تُحفظ ولا
          تظهر للمشترين.
        </EmptyState>
      ) : (
        <section className="card card--flush">
          <div className="card__head vp-toolbar">
            <div className="tabs" role="tablist" aria-label="حالة المنتج">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  className="tabs__tab"
                  aria-selected={tab === t.key}
                  onClick={() => {
                    setTab(t.key);
                    setLoading(true);
                  }}
                >
                  {t.label}
                  {counts[t.key] !== undefined ? (
                    <span className="tabs__count">{num(counts[t.key] ?? 0)}</span>
                  ) : null}
                </button>
              ))}
            </div>
            {categories.length > 0 || category ? (
              <select
                // يُعاد تركيبه حين تصل الفئات: مُركَّباً قبلها تضيع قيمة ?category= لغياب خيارها
                key={categories.length}
                className="field__control vp-catfilter"
                aria-label="تصفية بالفئة"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setLoading(true);
                }}
              >
                <option value="">كل الفئات</option>
                <option value="none">بلا فئة</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameAr}
                  </option>
                ))}
              </select>
            ) : null}
            <span className="input-icon vp-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                className="field__control"
                aria-label="بحث في المنتجات بالاسم أو رمز SKU"
                placeholder="ابحث بالاسم أو الرمز"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </span>
            <SortButton value={sort} onChange={setSort} />
          </div>

          {loading && !page ? (
            <div className="card__body">
              <Spinner label="جارٍ تحميل المنتجات…" />
            </div>
          ) : null}

          {page && page.items.length === 0 ? (
            <div className="vp-nomatch">
              <p className="vp-nomatch__title">
                {search.trim() ? `لا نتائج تطابق «${search.trim()}»` : 'لا منتجات تطابق هذا الفلتر.'}
              </p>
              <p className="small muted">جرّب اسماً أو رمزاً أقصر، أو انتقل إلى تبويب آخر.</p>
              {search || category ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setSearch('');
                    setCategory('');
                  }}
                >
                  امسح البحث والتصفية
                </button>
              ) : null}
            </div>
          ) : null}

          {page && page.items.length > 0 ? (
            <div className="table-wrap">
              <table className="table vp-products">
                <thead>
                  <tr>
                    <th scope="col">المنتج</th>
                    <th scope="col">السعر</th>
                    <th scope="col" className="end">المتاح</th>
                    <th scope="col">الحالة</th>
                    <th scope="col">آخر تعديل</th>
                    <th scope="col" className="end">
                      <span className="visually-hidden">إجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td className="wrap">
                        <Link className="vp-prod" href={`/vendor/products/${p.id}`}>
                          <ProductThumb src={p.thumbnail} />
                          <span className="vp-prod__text">
                            <span className="vp-prod__name">{p.nameAr}</span>
                            <span className="vp-prod__sub">
                              {p.vendorCategory ? `${p.vendorCategory.nameAr} · ` : ''}
                              {p.variantCount > 1 ? (
                                <>
                                  <span className="num">{num(p.variantCount)}</span> متغيّرات
                                </>
                              ) : (
                                'بلا متغيّرات'
                              )}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td data-label="السعر">
                        {p.priceFrom ? (
                          <span className="money num">
                            {p.priceTo && p.priceTo.minorUnits !== p.priceFrom.minorUnits
                              ? `${p.priceFrom.formatted} – ${p.priceTo.formatted}`
                              : p.priceFrom.formatted}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="end" data-label="المتاح">
                        <span
                          className="num vp-avail"
                          data-tone={p.available <= 0 ? 'out' : p.isLow ? 'low' : undefined}
                        >
                          {num(p.available)}
                        </span>
                        {p.isLow ? <span className="badge badge--warning badge--after">منخفض</span> : null}
                      </td>
                      <td data-label="الحالة">
                        <span className={`badge ${PRODUCT_STATUS[p.status].tone}`} title={PRODUCT_STATUS[p.status].hint}>
                          {p.status === 'rejected' ? <Icon name="alert" size={11} /> : null}
                          {PRODUCT_STATUS[p.status].label}
                        </span>
                      </td>
                      <td data-label="آخر تعديل">
                        {edited(p.updatedAt)}
                      </td>
                      <td className="end" data-label="">
                        <Link
                          className="icon-btn icon-btn--sm"
                          href={`/vendor/products/${p.id}`}
                          aria-label={`حرّر ${p.nameAr}`}
                        >
                          <Icon name="file" size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {page && page.items.length > 0 ? (
            (items.length < page.total && !exhausted) || moreError || batches.length > 0 ? (
              <MoreButton
                list={{
                  items,
                  total: page.total,
                  hasMore: items.length < page.total && !exhausted,
                  loadingMore,
                  moreError,
                  more: () => void loadMore(),
                  less: loadLess,
                  canLess: batches.length > 0,
                }}
              />
            ) : (
              <div className="card__foot vp-foot">
                <span className="small muted">
                  <span className="num">{num(items.length)}</span> من <span className="num">{num(page.total)}</span> منتجاً
                </span>
              </div>
            )
          ) : null}
        </section>
      )}
    </div>
  );
}
