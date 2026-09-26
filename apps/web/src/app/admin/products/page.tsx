'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
import { media, PRODUCT_STATUS, TONE, useAdminData } from '@/lib/admin';
import { money, when } from '@/lib/orders';

interface Item {
  id: string;
  nameAr: string;
  status: string;
  rejectReason: string | null;
  vendor: { id: string; nameAr: string; status: string };
  categoryNameAr: string;
  variantCount: number;
  priceFrom: { minorUnits: string; currency: string } | null;
  thumbnail: string | null;
  updatedAt: string;
}

/**
 * AD-07 — مراجعة المنتجات (Q-15): كل منتج ينتظر الاعتماد قبل ظهوره، ومنه
 * المنشور المعدَّل محتواه (Q-16). الأقدم أولاً.
 */
export default function AdminProductsPage() {
  const [status, setStatus] = useState('pending_review');
  const [search, setSearch] = useState('');
  const q = new URLSearchParams({ status, pageSize: '100', ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, error, forbidden, reload } = useAdminData<{ items: Item[]; total: number }>(`/admin/products?${q}`);
  const queue = status === 'pending_review';

  return (
    <div className="ao-page">
      <AdminHeader title="مراجعة المنتجات" count={data ? `${data.total} منتج` : undefined} hint="الاعتماد ينشر فوراً، والرفض يصل البائع بسببه حرفياً." />
      <div className="toolbar">
        <Tabs value={status} onChange={setStatus} label="حالة المنتج" options={['pending_review', 'active', 'rejected', 'draft', 'archived'].map((k) => ({ key: k, label: PRODUCT_STATUS[k]! }))} />
        <div className="toolbar__end">
          <span className="input-icon ao-search">
            <Icon name="search" size={15} />
            <input className="field__control" type="search" placeholder="اسم المنتج أو المتجر" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="بحث" />
          </span>
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        search.trim() ? (
          <Empty icon="search" title="لا منتجات بهذا البحث" actions={<button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>أزل التصفية</button>}>
            جرّب اسماً آخر أو امسح البحث.
          </Empty>
        ) : queue ? (
          <Empty icon="check-circle" tone="success" title="انتهى الطابور">
            لا منتجات تنتظر المراجعة الآن. ستظهر المنتجات الجديدة والمعدّلة بعد النشر هنا مباشرة.
          </Empty>
        ) : (
          <Empty icon="package" title="لا منتجات بهذه الحالة" />
        )
      ) : (
        <ul className="ao-plist" aria-label="المنتجات">
          {data.items.map((p) => {
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
                      {p.vendor.nameAr} · {p.categoryNameAr}
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
    </div>
  );
}
