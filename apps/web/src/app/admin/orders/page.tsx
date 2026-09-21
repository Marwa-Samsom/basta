'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, ReasonButton, Tabs } from '@/components/admin';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { PARENT_STATUS, useAction, useAdminData } from '@/lib/admin';
import { labelOf, money, toneOf, when, type SubOrderView } from '@/lib/orders';

interface Row {
  orderNumber: string;
  status: string;
  currency: string;
  grandTotalMinorUnits: string;
  placedAt: string;
  guestEmail: string | null;
  customer: { fullName: string | null; email: string | null } | null;
  payment: { status: string } | null;
  subOrders: { id: string; subOrderNumber: string; status: string; vendor: { nameAr: string } }[];
}

interface Detail {
  number: string;
  status: string;
  currency: string;
  grandTotalMinorUnits: string;
  paymentStatus: string | null;
  stores: SubOrderView[];
}

/** AD-12 — الطلبات: بحث برقم الطلب أو العميل أو المتجر، وتفاصيل كل متجر بمساره، وإلغاء الإدارة قبل الشحن */
function OrdersInner() {
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [openNumber, setOpenNumber] = useState<string | null>(null);
  const q = new URLSearchParams({ ...(search.trim() ? { q: search.trim() } : {}), ...(status ? { status } : {}) });
  const { data, error, forbidden, reload } = useAdminData<{ items: Row[]; total: number }>(`/admin/orders?${q}`);

  return (
    <div className="stack stack--loose">
      <AdminHeader title="الطلبات" hint={data ? `${data.total} طلب` : undefined}>
        <input className="field__control" placeholder="رقم الطلب، بريد العميل، أو المتجر" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="بحث" />
      </AdminHeader>
      <Tabs value={status} onChange={setStatus} options={[{ key: '', label: 'الكل' }, ...['processing', 'partially_completed', 'completed', 'canceled', 'refunded', 'payment_failed'].map((k) => ({ key: k, label: PARENT_STATUS[k]! }))]} />
      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.items.length === 0 ? (
        <Card>
          <Empty>لا طلبات.</Empty>
        </Card>
      ) : (
        <div className="stack">
          {data.items.map((o) => (
            <Card key={o.orderNumber}>
              <button type="button" className="row row--between" style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', width: '100%' }} onClick={() => setOpenNumber(openNumber === o.orderNumber ? null : o.orderNumber)} aria-expanded={openNumber === o.orderNumber}>
                <span>
                  <strong className="num">{o.orderNumber}</strong> · <span className="small muted">{when(o.placedAt)}</span>
                  <div className="small">{o.customer?.fullName ?? o.guestEmail ?? 'ضيف'} · {o.subOrders.map((s) => s.vendor.nameAr).join('، ')}</div>
                </span>
                <span className="stack stack--tight" style={{ alignItems: 'flex-end' }}>
                  <span className="money">{money(o.grandTotalMinorUnits, o.currency)}</span>
                  <span className="badge badge--pending">{PARENT_STATUS[o.status] ?? o.status}</span>
                </span>
              </button>
              {openNumber === o.orderNumber ? <OrderDetail number={o.orderNumber} onChange={reload} /> : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ number, onChange }: { number: string; onChange: () => void }) {
  const { data, error, reload } = useAdminData<Detail>(`/admin/orders/${number}`);
  const act = useAction();
  if (!data) return <Loading error={error} />;
  return (
    <div className="stack">
      <Feedback error={act.error} notice={act.notice} />
      <p className="small muted">الدفع: {data.paymentStatus ?? '—'}</p>
      {data.stores.map((s) => (
        <div key={s.id} className="card stack stack--tight">
          <div className="row row--between">
            <span>
              {s.vendor.nameAr} · <span className="num small">{s.number}</span>
            </span>
            <span className={`badge ${toneOf(s.status)}`}>{labelOf(s.status)}</span>
          </div>
          <ol className="small stack stack--tight">
            {s.history.map((h, i) => (
              <li key={i}>
                {h.toLabel} · {when(h.createdAt)} {h.reason ? <span className="muted">«{h.reason}»</span> : null}
              </li>
            ))}
          </ol>
          {s.shipment ? <p className="small">التتبّع: <span className="num">{s.shipment.trackingNumber}</span></p> : null}
          {s.refunds.length ? (
            <p className="small">
              استردادات: {s.refunds.map((r) => `${money(r.amountMinorUnits, data.currency)} (${r.status})`).join('، ')}
            </p>
          ) : null}
          {s.actions.includes('canceled_by_admin') ? (
            <ReasonButton
              label="إلغاء هذا المتجر ورد المبلغ"
              presets={['نفاد المخزون لدى البائع', 'احتيال مشتبه في الطلب', 'البائع لا يستجيب']}
              disabled={act.busy}
              onSubmit={(r) =>
                act.run(async () => {
                  await api(`/admin/orders/stores/${s.id}/cancel`, { method: 'POST', body: { reason: r } });
                  reload();
                  onChange();
                }, 'أُلغي ويُردّ المبلغ للمشتري.')
              }
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense>
      <OrdersInner />
    </Suspense>
  );
}
