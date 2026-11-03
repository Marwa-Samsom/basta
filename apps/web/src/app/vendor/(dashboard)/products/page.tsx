'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, EmptyState, MoreButton, PageHead, SortButton, Spinner, type SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PRODUCTS, VARIANTS, counted } from '@/lib/arabic-count';
import { ProductThumb } from '@/components/product-editor';
import { useLocale, useT } from '@/components/locale';
import { intlLocale, localized, translator, type Locale } from '@/lib/i18n';
import {
  num,
  PRODUCT_STATUS,
  PRODUCT_STATUS_EN,
  type Page,
  type ProductListItem,
  type ProductStatus,
  type VendorCategory,
} from '@/lib/catalog';
import { useReturnTick } from '@/lib/fresh';

type TabKey = ProductStatus | 'all';

/**
 * التاريخ نصّ عربي باسم الشهر لا رقم: بصيغة «26/9/2026» العربية علامات
 * اتجاه خفية، فإن وُضع في خلية `num` اللاتينية انقلب إلى «262026/9/».
 */
const DAY = 86_400_000;
const formatsOf = (locale: Locale) => {
  const loc = intlLocale(locale);
  return {
    clock: new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    dayMonth: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long' }),
    dayMonthYear: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' }),
  };
};
const FORMATS: Readonly<Record<Locale, ReturnType<typeof formatsOf>>> = { ar: formatsOf('ar'), en: formatsOf('en') };
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * «آخر تعديل» كالتصميم (VD-06): «اليوم · 09:40»، «أمس · 18:20»، ثم «11 سبتمبر» — وبالسنة إن لم تكن
 * هذه. كان dateStyle: 'medium'، وهو في العربية أرقام وحدها «2026/10/28» (VCAT-001، 28 أكتوبر 2026).
 */
function edited(iso: string, locale: Locale, now = new Date()): string {
  const t = translator(locale);
  const { clock, dayMonth, dayMonthYear } = FORMATS[locale];
  const at = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return `${t('اليوم', 'Today')} · ${clock.format(at)}`;
  if (days === 1) return `${t('أمس', 'Yesterday')} · ${clock.format(at)}`;
  return (at.getFullYear() === now.getFullYear() ? dayMonth : dayMonthYear).format(at);
}

const TABS: readonly { key: TabKey; label: string; en: string }[] = [
  { key: 'all', label: 'الكل', en: 'All' },
  { key: 'draft', label: 'مسوّدة', en: 'Draft' },
  { key: 'active', label: 'منشور', en: 'Published' },
  { key: 'rejected', label: 'موقوف', en: 'Taken down' },
  { key: 'archived', label: 'مؤرشف', en: 'Archived' },
];

/** العدد ومعدوده بالعربية (طلب الدمج 179)، وبالإنجليزية جمعها */
const productCount = (n: number, locale: Locale): string =>
  locale === 'en' ? `${num(n, locale)} ${n === 1 ? 'product' : 'products'}` : counted(n, PRODUCTS);

/**
 * VD-07 — قائمة المنتجات.
 *
 * التبويب والبحث يُرسلان إلى الخادم لا يُصفّيان صفحةً محمّلة: البائع صاحب
 * 500 منتج لا تُحمَّل عنده القائمة كلها ليبحث فيها. وعدّاد كل تبويب مجموعه
 * من الخادم (`total` بصفحة من سطر واحد) لا عدّ ما في الصفحة.
 */
/** التبويب من `?status=` — الرئيسية تفتح الموقوفة، وتقرير الاستيراد المسوّدات */
const tabOf = (status: string | null): TabKey => TABS.find((t) => t.key === status)?.key ?? 'all';

// useSearchParams يحتاج حدّ Suspense في صفحة تُبنى مسبقاً
export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsList />
    </Suspense>
  );
}

function ProductsList() {
  const t = useT();
  const locale = useLocale();
  const statuses = localized(locale, PRODUCT_STATUS, PRODUCT_STATUS_EN);
  const nameOf = (p: ProductListItem): string => (locale === 'en' && p.nameEn ? p.nameEn : p.nameAr);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  /**
   * التبويب والفئة (`?category=` من صفحة الفئات، أو none لما بلا فئة) من العنوان نفسه، لا حالةٌ تُقرأ
   * منه مرة. كانا يُقرآن من window.location عند التركيب، والانتقال بـ Link يركّب الصفحة قبل أن يتغيّر
   * العنوان: «موقوفة» من الرئيسية تفتح «الكل». والضغط على تبويب لا يغيّر العنوان، فالتحديث يعيد غير
   * المعروض (VON-055، 28 أكتوبر 2026).
   */
  const tab = tabOf(params.get('status'));
  const category = params.get('category') ?? '';
  const setFilter = (next: { tab?: TabKey; category?: string }): void => {
    const query = new URLSearchParams(params.toString());
    const nextTab = next.tab ?? tab;
    const nextCategory = next.category ?? category;
    if (nextTab === 'all') query.delete('status');
    else query.set('status', nextTab);
    if (nextCategory) query.set('category', nextCategory);
    else query.delete('category');
    const q = query.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const [search, setSearch] = useState('');
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
        setError(err instanceof Error ? err.message : t('تعذّر تحميل المنتجات.', "Couldn't load products."));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const returned = useReturnTick();
  useEffect(() => {
    const timer = setTimeout(() => void load(tab, search, category, sort), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [tab, search, category, sort, load, returned]);

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
  }, [returned]);

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
      if (listKey.current === key) setMoreError(err instanceof Error ? err.message : t('تعذّر تحميل المزيد.', "Couldn't load more."));
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
        title={t('المنتجات', 'Products')}
        count={
          total !== undefined
            ? page && filtered
              ? `${productCount(total, locale)} · ${t(`المعروض ${num(page.total)}`, `${num(page.total, locale)} shown`)}`
              : productCount(total, locale)
            : undefined
        }
        actions={
          <>
            <Link className="btn btn--secondary" href="/vendor/products/import">
              <Icon name="upload" size={16} />
              {t('استيراد', 'Import')}
            </Link>
            <Link className="btn btn--primary" href="/vendor/products/new">
              <Icon name="plus" size={16} />
              {t('أضف منتجاً', 'Add product')}
            </Link>
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {storeEmpty ? (
        <EmptyState
          icon="package"
          title={t('لا منتجات بعد', 'No products yet')}
          actions={
            <>
              <Link className="btn btn--primary" href="/vendor/products/new">
                <Icon name="plus" size={16} />
                {t('أضف منتجاً يدوياً', 'Add a product manually')}
              </Link>
              <Link className="btn btn--secondary" href="/vendor/products/import">
                <Icon name="upload" size={16} />
                {t('استورد ملفاً', 'Import a file')}
              </Link>
            </>
          }
        >
          {t(
            'ابدأ بمنتج واحد لتفهم الشكل، أو ارفع ملفاً إن كان عندك كتالوج جاهز. المسوّدات تُحفظ ولا تظهر للمشترين.',
            'Start with one product to get a feel for it, or upload a file if you already have a catalogue. Drafts are saved and hidden from buyers.',
          )}
        </EmptyState>
      ) : (
        <section className="card card--flush">
          <div className="card__head vp-toolbar">
            <div className="tabs" role="tablist" aria-label={t('حالة المنتج', 'Product status')}>
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  className="tabs__tab"
                  aria-selected={tab === item.key}
                  onClick={() => {
                    setFilter({ tab: item.key });
                    setLoading(true);
                  }}
                >
                  {t(item.label, item.en)}
                  {counts[item.key] !== undefined ? (
                    <span className="tabs__count">{num(counts[item.key] ?? 0, locale)}</span>
                  ) : null}
                </button>
              ))}
            </div>
            {categories.length > 0 || category ? (
              <select
                // يُعاد تركيبه حين تصل الفئات: مُركَّباً قبلها تضيع قيمة ?category= لغياب خيارها
                key={categories.length}
                className="field__control vp-catfilter"
                aria-label={t('تصفية بالفئة', 'Filter by category')}
                value={category}
                onChange={(e) => {
                  setFilter({ category: e.target.value });
                  setLoading(true);
                }}
              >
                <option value="">{t('كل الفئات', 'All categories')}</option>
                <option value="none">{t('بلا فئة', 'No category')}</option>
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
                aria-label={t('بحث في المنتجات بالاسم أو رمز SKU', 'Search products by name or SKU')}
                placeholder={t('ابحث بالاسم أو الرمز', 'Search by name or SKU')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </span>
            <SortButton value={sort} onChange={setSort} />
          </div>

          {loading && !page ? (
            <div className="card__body">
              <Spinner label={t('جارٍ تحميل المنتجات…', 'Loading products…')} />
            </div>
          ) : null}

          {page && page.items.length === 0 ? (
            <div className="vp-nomatch">
              <p className="vp-nomatch__title">
                {search.trim()
                  ? t(`لا نتائج تطابق «${search.trim()}»`, `No results for “${search.trim()}”`)
                  : t('لا منتجات تطابق هذا الفلتر.', 'No products match this filter.')}
              </p>
              {/* النصيحة على قدر التصفية: «اسماً أقصر» للبحث وحده — كانت تظهر وتبويب «مؤرشف» فارغ ولا بحث */}
              <p className="small muted">
                {search.trim()
                  ? t('جرّب اسماً أو رمزاً أقصر، أو انتقل إلى تبويب آخر.', 'Try a shorter name or code, or switch to another tab.')
                  : category
                    ? t('جرّب فئة أخرى، أو انتقل إلى تبويب آخر.', 'Try another category, or switch to another tab.')
                    : t('لا منتج في هذه الحالة الآن — انتقل إلى تبويب آخر.', 'No products in this status right now — switch to another tab.')}
              </p>
              {search || category ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setSearch('');
                    setFilter({ category: '' });
                  }}
                >
                  {t('امسح البحث والتصفية', 'Clear search and filters')}
                </button>
              ) : null}
            </div>
          ) : null}

          {page && page.items.length > 0 ? (
            <div className="table-wrap">
              <table className="table vp-products">
                <thead>
                  <tr>
                    <th scope="col">{t('المنتج', 'Product')}</th>
                    <th scope="col">{t('السعر', 'Price')}</th>
                    <th scope="col" className="end">{t('المتاح', 'Available')}</th>
                    <th scope="col">{t('الحالة', 'Status')}</th>
                    <th scope="col">{t('آخر تعديل', 'Last edited')}</th>
                    <th scope="col" className="end">
                      <span className="visually-hidden">{t('إجراءات', 'Actions')}</span>
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
                            <span className="vp-prod__name">{nameOf(p)}</span>
                            <span className="vp-prod__sub">
                              {p.vendorCategory ? `${p.vendorCategory.nameAr} · ` : ''}
                              {p.variantCount > 1
                                ? t(counted(p.variantCount, VARIANTS), `${num(p.variantCount, locale)} variants`)
                                : t('بلا متغيّرات', 'No variants')}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td data-label={t('السعر', 'Price')}>
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
                      <td className="end" data-label={t('المتاح', 'Available')}>
                        <span
                          className="num vp-avail"
                          data-tone={p.available <= 0 ? 'out' : p.isLow ? 'low' : undefined}
                        >
                          {num(p.available, locale)}
                        </span>
                        {p.isLow ? <span className="badge badge--warning badge--after">{t('منخفض', 'Low')}</span> : null}
                      </td>
                      <td data-label={t('الحالة', 'Status')}>
                        <span className={`badge ${statuses[p.status].tone}`} title={statuses[p.status].hint}>
                          {p.status === 'rejected' ? <Icon name="alert" size={11} /> : null}
                          {statuses[p.status].label}
                        </span>
                      </td>
                      <td data-label={t('آخر تعديل', 'Last edited')}>
                        {edited(p.updatedAt, locale)}
                      </td>
                      <td className="end" data-label="">
                        <Link
                          className="icon-btn icon-btn--sm"
                          href={`/vendor/products/${p.id}`}
                          aria-label={t(`حرّر ${p.nameAr}`, `Edit ${nameOf(p)}`)}
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
                  <span className="num">{num(items.length, locale)}</span> {t('من', 'of')}{' '}
                  {t(counted(page.total, { ...PRODUCTS, two: 'منتجين' }), `${num(page.total, locale)} ${page.total === 1 ? 'product' : 'products'}`)}
                </span>
              </div>
            )
          ) : null}
        </section>
      )}
    </div>
  );
}
