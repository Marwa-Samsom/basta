'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading, Tabs } from '@/components/admin';
import { Card } from '@/components/ui';
import { TONE, useAdminData, VENDOR_STATUS } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Item {
  id: string;
  nameAr: string;
  slug: string;
  country: string;
  status: string;
  submittedAt: string | null;
  waitingHours: number | null;
  documentsAccepted: number;
  documentsTotal: number;
}

/** AD-04 طابور المراجعة (الأقدم أولاً) · AD-06 كل البائعين بحالاتهم */
export default function AdminVendorsPage() {
  const [status, setStatus] = useState('in_review');
  const { data, error, forbidden } = useAdminData<{ items: Item[]; total: number }>(`/admin/vendors?status=${status}&limit=100`);

  return (
    <div className="stack stack--loose">
      <AdminHeader title="البائعون" hint="الطابور بالأقدم أولاً — كل ساعة انتظار بائع يفقد حماسه." />
      <Tabs
        value={status}
        onChange={setStatus}
        options={['in_review', 'approved', 'suspended', 'rejected', 'pending', 'banned'].map((k) => ({ key: k, label: VENDOR_STATUS[k] ?? k }))}
      />
      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.items.length === 0 ? (
        <Card>
          <Empty>لا بائعين بهذه الحالة.</Empty>
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>المتجر</th>
                <th>البلد</th>
                <th>أُرسل</th>
                <th>ينتظر</th>
                <th>الوثائق</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link href={`/admin/vendors/${v.id}`}>{v.nameAr}</Link>
                    <div className="small muted num">{v.slug}</div>
                  </td>
                  <td className="num">{v.country}</td>
                  <td className="small">{when(v.submittedAt)}</td>
                  <td className="num">{v.waitingHours === null ? '—' : `${v.waitingHours} س`}</td>
                  <td className="num">
                    {v.documentsAccepted}/{v.documentsTotal}
                  </td>
                  <td>
                    <span className={`badge ${TONE[v.status] ?? ''}`}>{VENDOR_STATUS[v.status] ?? v.status}</span>
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
