'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
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

const PAGE = 100;

/**
 * AD-04 طابور المراجعة (الأقدم أولاً) · AD-06 كل البائعين بحالاتهم.
 *
 * بحث وصفحات (20 أكتوبر 2026): كانت الصفحة تعرض أول مئة بالأقدم ولا شيء بعدها، فمتجر
 * «غزة» بين 5221 معتمداً لا يُوصل إليه إلا برابطه (J-11). البحث بالاسم أو الرابط أو بريد
 * صاحبه داخل الحالة المختارة، و«المزيد» يُلحق المئة التالية.
 */
export default function AdminVendorsPage() {
  const [status, setStatus] = useState('in_review');
  const [search, setSearch] = useState('');
  const [more, setMore] = useState<Item[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const query = new URLSearchParams({ status, limit: String(PAGE), ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, error, forbidden, reload } = useAdminData<{ items: Item[]; total: number }>(`/admin/vendors?${query}`);
  const queue = status === 'in_review';
  const items = data ? [...data.items, ...more] : [];

  // حالة أو بحث آخر: قائمة أخرى من أولها
  const changeStatus = (s: string) => {
    setStatus(s);
    setMore([]);
  };
  const changeSearch = (v: string) => {
    setSearch(v);
    setMore([]);
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await api<{ items: Item[] }>(`/admin/vendors?${query}&offset=${items.length}`);
      setMore((m) => [...m, ...next.items]);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="ao-page">
      <AdminHeader
        title="المتاجر"
        count={data ? (queue ? `${data.total} طلب ينتظر` : `${data.total} متجر`) : undefined}
        hint={queue ? 'الأقدم أولاً — الانتظار فوق يومي عمل يظهر بالأحمر.' : 'كل المتاجر بحالاتها.'}
      />
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={changeStatus}
          label="حالة المتجر"
          options={['in_review', 'approved', 'suspended', 'rejected', 'pending', 'banned'].map((k) => ({ key: k, label: VENDOR_STATUS[k] ?? k }))}
        />
        <div className="toolbar__end">
          <span className="input-icon ao-search">
            <Icon name="search" size={15} />
            <input
              className="field__control"
              type="search"
              placeholder="اسم المتجر أو رابطه أو بريد صاحبه"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
              aria-label="بحث في المتاجر"
            />
          </span>
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        search.trim() ? (
          <Empty
            icon="search"
            title="لا متاجر بهذا البحث"
            actions={
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => changeSearch('')}>
                أزل التصفية
              </button>
            }
          >
            جرّب اسماً آخر أو حالة أخرى من الرقائق أعلاه.
          </Empty>
        ) : queue ? (
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
              {items.map((v) => {
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
      {data && items.length < data.total ? (
        <div className="ao-more">
          <span className="ao-more__count num">
            {items.length} من {data.total}
          </span>
          <button type="button" className="btn btn--secondary btn--sm" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'جارٍ التحميل…' : 'المزيد'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
