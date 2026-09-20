'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Card, Spinner, TextInput } from '@/components/ui';
import { num, PRODUCT_STATUS, type Page, type ProductListItem, type ProductStatus } from '@/lib/catalog';

const TABS: readonly { key: ProductStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'draft', label: 'مسوّدات' },
  { key: 'pending_review', label: 'قيد المراجعة' },
  { key: 'active', label: 'منشور' },
  { key: 'rejected', label: 'مرفوض' },
  { key: 'archived', label: 'مؤرشف' },
];

/**
 * VD-07 — قائمة المنتجات.
 *
 * التبويب والبحث يُرسلان إلى الخادم لا يُصفّيان صفحةً محمّلة: البائع صاحب
 * 500 منتج لا تُحمَّل عنده القائمة كلها ليبحث فيها.
 */
export default function ProductsPage() {
  const [tab, setTab] = useState<ProductStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<Page<ProductListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (status: ProductStatus | 'all', term: string): Promise<void> => {
      const params = new URLSearchParams({ pageSize: '20' });
      if (status !== 'all') params.set('status', status);
      if (term.trim()) params.set('search', term.trim());
      try {
        const next = await api<Page<ProductListItem>>(`/vendor/products?${params.toString()}`);
        setPage(next);
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
    const timer = setTimeout(() => void load(tab, search), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [tab, search, load]);

  return (
    <>
      <header className="row row--between">
        <h1>المنتجات</h1>
        <Link className="btn btn--primary" href="/vendor/products/new">
          منتج جديد
        </Link>
      </header>

      <div className="tabs" role="tablist">
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
          </button>
        ))}
      </div>

      <TextInput
        label="بحث"
        hint="بالاسم أو رمز SKU."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {loading && !page ? <Spinner label="جارٍ تحميل المنتجات…" /> : null}

      {page && page.items.length === 0 ? (
        <div className="empty">
          <p>
            {search || tab !== 'all'
              ? 'لا منتجات تطابق هذا الفلتر.'
              : 'لم تُضف منتجاً بعد. ابدأ بواحد، أو استورد قائمتك دفعةً واحدة.'}
          </p>
          <div className="row">
            <Link className="btn btn--primary" href="/vendor/products/new">
              أضف أول منتج
            </Link>
            <Link className="btn btn--secondary" href="/vendor/products/import">
              استيراد من ملف
            </Link>
          </div>
        </div>
      ) : null}

      {page && page.items.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">المنتج</th>
                  <th scope="col">المتغيّرات</th>
                  <th scope="col">السعر</th>
                  <th scope="col">المتاح</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">آخر تعديل</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((p) => (
                  <tr key={p.id}>
                    <td className="wrap">
                      <Link href={`/vendor/products/${p.id}`}>{p.nameAr}</Link>
                    </td>
                    <td className="num" data-label="المتغيّرات">{p.variantCount > 1 ? num(p.variantCount) : '—'}</td>
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
                    <td className="num" data-label="المتاح">
                      {num(p.available)}
                      {p.isLow ? <span className="badge badge--warning badge--after">منخفض</span> : null}
                    </td>
                    <td data-label="الحالة">
                      <span className={`badge ${PRODUCT_STATUS[p.status].tone}`}>
                        {PRODUCT_STATUS[p.status].label}
                      </span>
                    </td>
                    <td className="num" data-label="آخر تعديل">{new Date(p.updatedAt).toLocaleDateString('ar-JO-u-nu-latn')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            {num(page.items.length)} من {num(page.total)} منتجاً
          </p>
        </>
      ) : null}

      {page && page.total > page.pageSize ? (
        <Card hint="الصفحات الكاملة في المرحلة القادمة — اعرض بالبحث حتى ذلك الحين." title="">
          <span className="small muted">تُعرض أول {num(page.pageSize)} نتيجة.</span>
        </Card>
      ) : null}
    </>
  );
}
