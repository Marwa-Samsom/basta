'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
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

/** مدّة الانتظار بالساعات حتى يوم، ثم بالأيام بتمييزها العربي */
function waited(hours: number): string {
  if (hours < 24) return `${hours} س`;
  const d = Math.floor(hours / 24);
  if (d === 1) return 'يوم';
  if (d === 2) return 'يومان';
  return d <= 10 ? `${d} أيام` : `${d} يوماً`;
}

/** فوق يومي عمل ينتظر المتجر — يظهر بالأحمر */
const LATE_HOURS = 48;

/** AD-04 طابور المراجعة (الأقدم أولاً) · AD-06 كل البائعين بحالاتهم */
export default function AdminVendorsPage() {
  const [status, setStatus] = useState('in_review');
  const { data, error, forbidden, reload } = useAdminData<{ items: Item[]; total: number }>(`/admin/vendors?status=${status}&limit=100`);
  const queue = status === 'in_review';

  return (
    <div className="ao-page">
      <AdminHeader
        title="المتاجر"
        count={data ? (queue ? `${data.total} طلب ينتظر` : `${data.total} متجر`) : undefined}
        hint={queue ? 'الأقدم أولاً — الانتظار فوق يومي عمل يظهر بالأحمر.' : 'كل المتاجر بحالاتها.'}
      />
      <Tabs
        value={status}
        onChange={setStatus}
        label="حالة المتجر"
        options={['in_review', 'approved', 'suspended', 'rejected', 'pending', 'banned'].map((k) => ({ key: k, label: VENDOR_STATUS[k] ?? k }))}
      />
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        queue ? (
          <Empty icon="check-circle" tone="success" title="لا طلبات اعتماد معلّقة">
            كل طلبات المتاجر مُراجَعة. ستظهر الطلبات الجديدة هنا فور إرسال التاجر لمستنداته.
          </Empty>
        ) : (
          <Empty icon="store" title="لا متاجر بهذه الحالة">
            جرّب حالة أخرى من الرقائق أعلاه.
          </Empty>
        )
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>المتجر</th>
                <th>البلد</th>
                <th>أُرسل</th>
                <th>الوثائق</th>
                {queue ? <th>ينتظر</th> : <th>الحالة</th>}
                <th className="end">
                  <span className="visually-hidden">الإجراء</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((v) => {
                const late = queue && v.waitingHours !== null && v.waitingHours >= LATE_HOURS;
                const docsDone = v.documentsTotal > 0 && v.documentsAccepted === v.documentsTotal;
                return (
                  <tr key={v.id} data-late={late}>
                    <td>
                      <span className="ao-shop">
                        <span className="ao-tile" aria-hidden>
                          <Icon name="store" size={16} />
                        </span>
                        <span className="ao-shop__text">
                          <span className="ao-shop__name">{v.nameAr}</span>
                          <span className="ao-shop__sub num">{v.slug}</span>
                        </span>
                      </span>
                    </td>
                    <td data-label="البلد" className="num">
                      {v.country}
                    </td>
                    <td data-label="أُرسل" className="ao-date">
                      {when(v.submittedAt)}
                    </td>
                    <td data-label="الوثائق">
                      <span className={`badge ${docsDone ? 'badge--success' : 'badge--pending'}`} title="الوثائق المقبولة من المطلوبة">
                        <Icon name="file" size={12} />
                        <span className="num">
                          {v.documentsAccepted}/{v.documentsTotal}
                        </span>
                      </span>
                    </td>
                    {queue ? (
                      <td data-label="ينتظر">
                        {v.waitingHours === null ? (
                          '—'
                        ) : (
                          <span className="ao-wait" data-late={late}>
                            <Icon name="clock" size={12} />
                            {waited(v.waitingHours)}
                          </span>
                        )}
                      </td>
                    ) : (
                      <td data-label="الحالة">
                        <span className={`badge ${TONE[v.status] ?? ''}`}>{VENDOR_STATUS[v.status] ?? v.status}</span>
                      </td>
                    )}
                    <td data-label="" className="end">
                      <Link href={`/admin/vendors/${v.id}`} className={`btn btn--sm ${queue ? 'btn--primary' : 'btn--secondary'}`} aria-label={`${queue ? 'راجع' : 'افتح'} ${v.nameAr}`}>
                        {queue ? 'راجع' : 'افتح'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
