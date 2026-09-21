'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Card, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { labelOf, money, toneOf, when } from '@/lib/orders';

interface Row {
  id: string;
  number: string;
  status: string;
  currency: string;
  totalMinorUnits: string;
  netMinorUnits: string;
  placedAt: string;
  itemCount: number;
  buyer: string | null;
}

interface ListView {
  items: Row[];
  total: number;
  counts: Record<string, number>;
}

/** التبويبات بترتيب العمل اليومي: ما ينتظرك أولاً */
const TABS: { key: string; label: string }[] = [
  { key: '', label: 'الكل' },
  { key: 'awaiting_vendor', label: 'بانتظار القبول' },
  { key: 'accepted', label: 'مقبولة' },
  { key: 'preparing', label: 'قيد التجهيز' },
  { key: 'ready_to_ship', label: 'جاهزة للشحن' },
  { key: 'shipped', label: 'مشحونة' },
  { key: 'delivered', label: 'مسلَّمة' },
  { key: 'return_requested', label: 'طلبات إرجاع' },
];

/**
 * VD-12 — طلبات المتجر.
 *
 * البائع يرى فرعيّه وحده: رقمه وحالته وصافيه بعملته. «بانتظار القبول» أعلى
 * التبويبات بعدّاده لأن مهلة القبول 48 ساعة ثم يُلغى الطلب آلياً.
 */
export default function VendorOrdersPage() {
  const [tab, setTab] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ListView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams();
    if (tab) q.set('status', tab);
    if (search.trim()) q.set('search', search.trim());
    api<ListView>(`/vendor/orders?${q}`)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [tab, search]);

  const waiting = data?.counts['awaiting_vendor'] ?? 0;

  return (
    <div className="stack stack--loose">
      <header className="row row--between">
        <h1>الطلبات</h1>
        <input
          className="field__control"
          style={{ maxWidth: '16rem' }}
          placeholder="ابحث برقم الطلب"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="ابحث برقم الطلب"
        />
      </header>

      {waiting > 0 ? (
        <Alert tone="warning" title={`${waiting} ${waiting === 1 ? 'طلب ينتظر' : 'طلبات تنتظر'} قبولك`}>
          الطلب الذي لا يُقبل خلال 48 ساعة يُلغى آلياً ويُردّ مال المشتري.
        </Alert>
      ) : null}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="tabs__tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key && data?.counts[t.key] ? <span className="num small"> ({data.counts[t.key]})</span> : null}
          </button>
        ))}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!data && !error ? <Spinner label="جارٍ جلب الطلبات…" /> : null}

      {data ? (
        data.items.length === 0 ? (
          <Card>
            <p className="empty muted">لا طلبات في هذا التبويب.</p>
          </Card>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>التاريخ</th>
                  <th>المستلم</th>
                  <th>القطع</th>
                  <th>الإجمالي</th>
                  <th>صافيك</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/vendor/orders/${r.id}`} className="num">
                        {r.number}
                      </Link>
                    </td>
                    <td className="small">{when(r.placedAt)}</td>
                    <td className="small">{r.buyer ?? '—'}</td>
                    <td className="num">{r.itemCount}</td>
                    <td className="money">{money(r.totalMinorUnits, r.currency)}</td>
                    <td className="money">{money(r.netMinorUnits, r.currency)}</td>
                    <td>
                      <span className={`badge ${toneOf(r.status)}`}>{labelOf(r.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}
