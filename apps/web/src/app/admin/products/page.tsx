'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading, MoreButton, SearchBox, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
import { media, PRODUCT_STATUS, TONE, useAdminList } from '@/lib/admin';
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
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const q = new URLSearchParams({ status, pageSize: '100', ...(search.trim() ? { search: search.trim() } : {}) });
  const list = useAdminList<Item>(`/admin/products?${q}`, (p) => p.id);
  const { data, error, forbidden, reload } = list;

  return (
    <div className="ao-page">
      <AdminHeader title="المنتجات" count={data ? `${data.total} منتج` : undefined} hint="البائع ينشر بلا مراجعة. افتح أي منتج لتوقفه إن خالف — السبب يصل البائع حرفياً." />
      <div className="toolbar">
        <Tabs value={status} onChange={setStatus} label="حالة المنتج" options={['active', 'rejected', 'draft', 'archived'].map((k) => ({ key: k, label: PRODUCT_STATUS[k]! }))} />
        <div className="toolbar__end">
          <SearchBox value={search} onChange={setSearch} placeholder="اسم المنتج أو المتجر" label="بحث في المنتجات" />
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        search.trim() ? (
          <Empty icon="search" title="لا منتجات بهذا البحث" actions={<button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>أزل التصفية</button>}>
            جرّب اسماً آخر أو امسح البحث.
          </Empty>
        ) : (
          <Empty icon="package" title="لا منتجات بهذه الحالة" />
        )
      ) : (
        <ul className="ao-plist" aria-label="المنتجات">
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
                      <span className={`badge ${TONE[p.status] ?? ''}`}>{PRODUCT_STATUS[p.status] ?? p.status}</span>
                      <span className="ao-pitem__meta">
                        <span className="num">{p.variantCount}</span> متغيّراً
                      </span>
                      <span className="ao-pitem__meta">عُدّل {when(p.updatedAt)}</span>
                    </span>
                    {p.rejectReason ? <span className="ao-pitem__reason">«{p.rejectReason}»</span> : null}
                  </span>
                  <span className="ao-pitem__end">
                    {p.priceFrom ? <span className="money num">{money(p.priceFrom.minorUnits, p.priceFrom.currency)}</span> : <span className="muted">—</span>}
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
