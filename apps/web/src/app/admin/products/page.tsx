'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading, MoreButton, SearchBox, SortButton, Tabs } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { localized } from '@/lib/i18n';
import { media, PRODUCT_STATUS, PRODUCT_STATUS_EN, TONE, useAdminList } from '@/lib/admin';
import { PRODUCTS, counted } from '@/lib/arabic-count';
import { money, when } from '@/lib/orders';

interface Item {
  id: string;
  nameAr: string;
  status: string;
  rejectReason: string | null;
  vendor: { id: string; nameAr: string; status: string };
  /** فئة المنتج في متجره — null إن لم يضعه البائع في فئة */
  vendorCategoryNameAr: string | null;
  variantCount: number;
  priceFrom: { minorUnits: string; currency: string } | null;
  thumbnail: string | null;
  updatedAt: string;
}

/**
 * AD-07 — المنتجات. لا مراجعة قبل النشر (قرار صاحب المشروع 15 أكتوبر 2026): البائع
 * ينشر فيظهر منتجه، والإدارة تتابع المنشور وتوقف المخالف بسبب يصل البائع. الأحدث أولاً.
 */
export default function AdminProductsPage() {
  const t = useT();
  const locale = useLocale();
  const productStatus = localized(locale, PRODUCT_STATUS, PRODUCT_STATUS_EN);
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  // بتاريخ آخر تعديل
  const [sort, setSort] = useState<SortOrder>('newest');
  const q = new URLSearchParams({ status, pageSize: '100', sort, ...(search.trim() ? { search: search.trim() } : {}) });
  const list = useAdminList<Item>(`/admin/products?${q}`, (p) => p.id);
  const { data, error, forbidden, reload } = list;

  return (
    <div className="ao-page">
      <AdminHeader
        title={t('المنتجات', 'Products')}
        count={data ? t(counted(data.total, PRODUCTS), `${data.total} ${data.total === 1 ? 'product' : 'products'}`) : undefined}
        hint={t(
          'البائع ينشر بلا مراجعة. افتح أي منتج لتوقفه إن خالف — السبب يصل البائع حرفياً.',
          'Sellers publish without review. Open any product to take it down if it breaks the rules — the seller receives the reason word for word.',
        )}
      />
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={setStatus}
          label={t('حالة المنتج', 'Product status')}
          options={['active', 'rejected', 'draft', 'archived'].map((k) => ({ key: k, label: productStatus[k]! }))}
        />
        <div className="toolbar__end">
          <SearchBox value={search} onChange={setSearch} placeholder={t('اسم المنتج أو المتجر', 'Product or shop name')} label={t('بحث في المنتجات', 'Search products')} />
          <SortButton value={sort} onChange={setSort} />
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        search.trim() ? (
          <Empty
            icon="search"
            title={t('لا منتجات بهذا البحث', 'No products match this search')}
            actions={
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>
                {t('أزل التصفية', 'Clear filters')}
              </button>
            }
          >
            {t('جرّب اسماً آخر أو امسح البحث.', 'Try another name or clear the search.')}
          </Empty>
        ) : (
          <Empty icon="package" title={t('لا منتجات بهذه الحالة', 'No products with this status')} />
        )
      ) : (
        <ul className="ao-plist" aria-label={t('المنتجات', 'Products')}>
          {list.items.map((p) => {
            const thumb = media(p.thumbnail);
            return (
              <li key={p.id}>
                <Link href={`/admin/products/${p.id}`} className="ao-pitem">
                  <span className="ao-pitem__thumb" aria-hidden>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {thumb ? <img src={thumb} alt="" width={42} height={42} /> : <Icon name="image" size={19} />}
                  </span>
                  <span className="ao-pitem__text">
                    <span className="ao-pitem__name">{p.nameAr}</span>
                    <span className="ao-pitem__sub">
                      {p.vendor.nameAr}
                      {p.vendorCategoryNameAr ? ` · ${p.vendorCategoryNameAr}` : ''}
                    </span>
                    <span className="ao-pitem__tags">
                      <span className={`badge ${TONE[p.status] ?? ''}`}>{productStatus[p.status] ?? p.status}</span>
                      <span className="ao-pitem__meta">
                        <span className="num">{p.variantCount}</span> {t('متغيّراً', p.variantCount === 1 ? 'variant' : 'variants')}
                      </span>
                      <span className="ao-pitem__meta">
                        {t('عُدّل', 'Edited')} {when(p.updatedAt, locale)}
                      </span>
                    </span>
                    {p.rejectReason ? <span className="ao-pitem__reason">
                        {t('«', '“')}
                        {p.rejectReason}
                        {t('»', '”')}
                      </span> : null}
                  </span>
                  <span className="ao-pitem__end">
                    {p.priceFrom ? <span className="money num">{money(p.priceFrom.minorUnits, p.priceFrom.currency, locale)}</span> : <span className="muted">—</span>}
                    <Icon name="chev-end" size={16} mirror />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <MoreButton list={list} />
    </div>
  );
}
