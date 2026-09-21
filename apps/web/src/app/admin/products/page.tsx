'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading, Tabs } from '@/components/admin';
import { Card } from '@/components/ui';
import { PRODUCT_STATUS, TONE, useAdminData } from '@/lib/admin';
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
  const { data, error, forbidden } = useAdminData<{ items: Item[]; total: number }>(`/admin/products?${q}`);

  return (
    <div className="stack stack--loose">
      <AdminHeader title="مراجعة المنتجات" hint="الاعتماد ينشر فوراً، والرفض يصل البائع بسببه حرفياً.">
        <input className="field__control" placeholder="اسم المنتج أو المتجر" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="بحث" />
      </AdminHeader>
      <Tabs value={status} onChange={setStatus} options={['pending_review', 'active', 'rejected', 'draft', 'archived'].map((k) => ({ key: k, label: PRODUCT_STATUS[k]! }))} />
      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.items.length === 0 ? (
        <Card>
          <Empty>لا منتجات هنا.</Empty>
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>المتجر</th>
                <th>الفئة</th>
                <th>المتغيّرات</th>
                <th>من</th>
                <th>آخر تعديل</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td className="wrap">
                    <Link href={`/admin/products/${p.id}`}>{p.nameAr}</Link>
                  </td>
                  <td className="small">{p.vendor.nameAr}</td>
                  <td className="small">{p.categoryNameAr}</td>
                  <td className="num">{p.variantCount}</td>
                  <td className="money">{p.priceFrom ? money(p.priceFrom.minorUnits, p.priceFrom.currency) : '—'}</td>
                  <td className="small">{when(p.updatedAt)}</td>
                  <td>
                    <span className={`badge ${TONE[p.status] ?? ''}`}>{PRODUCT_STATUS[p.status] ?? p.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
