'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { Icon } from '@/components/icons';
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

/**
 * التبويبات بترتيب العمل اليومي: ما ينتظرك أولاً، ثم ما انتهى. كل حالة لها
 * تبويب — طلب في حالة بلا تبويب كان يُعدّ في «الكل» ولا يظهر في غيره. الحالات
 * الأربع التي يخرج بها الطلب ملغى أو مردود المال تجتمع في تبويب واحد.
 */
const TABS: { statuses: string[]; label: string }[] = [
  { statuses: [], label: 'الكل' },
  ...(['awaiting_vendor', 'accepted', 'preparing', 'ready_to_ship', 'shipped', 'delivery_failed', 'delivered', 'return_requested', 'returned', 'completed'] as const).map(
    (s) => ({ statuses: [s], label: labelOf(s) }),
  ),
  { statuses: ['rejected_by_vendor', 'canceled_by_customer', 'canceled_by_admin', 'refunded'], label: 'ملغى أو مُسترَد' },
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
  const all = data ? Object.values(data.counts).reduce((a, n) => a + n, 0) : 0;
  const filtered = Boolean(tab || search.trim());

  return (
    <div className="vm-page">
      <PageHead
        title="الطلبات"
        count={
          data ? (
            <>
              الطلبات الفرعية {all} · بانتظار قبولك {waiting}
            </>
          ) : undefined
        }
        actions={
          <span className="input-icon vm-search">
            <Icon name="search" size={16} />
            <input
              className="field__control"
              type="search"
              placeholder="ابحث برقم الطلب"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="ابحث برقم الطلب"
            />
          </span>
        }
      />

      {waiting > 0 ? (
        <Alert tone="warning" title={`${waiting} ${waiting === 1 ? 'طلب ينتظر' : 'طلبات تنتظر'} قبولك`}>
          الطلب الذي لا يُقبل خلال 48 ساعة يُلغى آلياً ويُردّ مال المشتري.
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <section className="card card--flush">
        <div className="tabs vm-tabs" role="tablist" aria-label="حالة الطلب">
          {TABS.map((t) => {
            const key = t.statuses.join(',');
            const count = t.statuses.length ? t.statuses.reduce((n, s) => n + (data?.counts[s] ?? 0), 0) : all;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                className="tabs__tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {t.label}
                {data ? <span className="tabs__count">{count}</span> : null}
              </button>
            );
          })}
        </div>

        {!data && !error ? (
          <div className="vm-loading" role="status">
            <span className="visually-hidden">جارٍ جلب الطلبات…</span>
            <span className="skeleton vm-loading__row" />
            <span className="skeleton vm-loading__row" />
            <span className="skeleton vm-loading__row" />
          </div>
        ) : null}

        {data ? (
          data.items.length === 0 ? (
            <EmptyState
              icon="truck"
              title={filtered ? 'لا طلبات في هذه المرحلة' : 'لا طلبات بعد'}
              actions={
                filtered ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      setTab('');
                      setSearch('');
                    }}
                  >
                    أزل التصفية
                  </button>
                ) : undefined
              }
            >
              {filtered
                ? 'جرّب مرحلة أخرى من الأعلى، أو ابحث برقم طلب آخر.'
                : 'تصلك الطلبات هنا فور شراء أحدهم من متجرك، والجديد منها أولاً مع مهلة القبول.'}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table vm-table">
                <thead>
                  <tr>
                    <th>الطلب الفرعي</th>
                    <th>التاريخ</th>
                    <th>المستلم</th>
                    <th className="end">القطع</th>
                    <th className="end">الإجمالي</th>
                    <th className="end">صافيك</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} data-status={r.status}>
                      <td data-label="الطلب الفرعي">
                        <Link href={`/vendor/orders/${r.id}`} className="num vm-order-link">
                          {r.number}
                        </Link>
                      </td>
                      <td data-label="التاريخ" className="vm-muted">
                        {when(r.placedAt)}
                      </td>
                      <td data-label="المستلم" className="vm-strong">
                        {r.buyer ?? '—'}
                      </td>
                      <td data-label="القطع" className="num end">
                        {r.itemCount}
                      </td>
                      <td data-label="الإجمالي" className="money num end">
                        {money(r.totalMinorUnits, r.currency)}
                      </td>
                      <td data-label="صافيك" className="money num end">
                        {money(r.netMinorUnits, r.currency)}
                      </td>
                      <td data-label="الحالة">
                        <span className={`badge ${toneOf(r.status)}`}>{labelOf(r.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}
