'use client';

import { AdminHeader, Empty, Feedback, Loading } from '@/components/admin';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { TONE, useAction, useAdminData } from '@/lib/admin';
import { labelOf, money, RETURN_REASONS, when } from '@/lib/orders';

interface Data {
  requests: {
    id: string;
    reasonCode: string;
    description: string | null;
    status: string;
    requestedAt: string;
    itemsJson: { orderItemId: string; qty: number }[];
    subOrder: { id: string; subOrderNumber: string; status: string; vendor: { nameAr: string } };
  }[];
  refunds: {
    id: string;
    amountMinorUnits: string;
    vendorAmountMinorUnits: string | null;
    currency: string;
    reason: string;
    status: string;
    providerRefundId: string | null;
    createdAt: string;
    vendorNegative: string | null;
    subOrder: { subOrderNumber: string; settlementCurrency: string; vendor: { nameAr: string } };
  }[];
}

const RETURN_STATUS: Record<string, string> = { requested: 'بانتظار البائع', received: 'استُلم', rejected: 'رُفض' };

/**
 * AD-15 — المرتجعات والاستردادات. الإدارة تتدخّل حين يتعثّر متجر: تستلم
 * المرتجع بدلاً منه (الانتقال نفسه بفاعل admin)، والاسترداد يظهر بمرجع
 * البوابة، والرصيد السالب للبائع إن نتج بجانبه.
 */
export default function AdminReturnsPage() {
  const { data, error, forbidden, reload } = useAdminData<Data>('/admin/returns');
  const act = useAction();
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const receive = (subOrderId: string, returnRequestId: string) =>
    act.run(async () => {
      await api(`/admin/orders/stores/${subOrderId}/transition`, { method: 'POST', body: { to: 'returned', returnRequestId } });
      reload();
    }, 'سُجّل الاستلام: عادت القطع للمخزون ويُردّ نصيبها للمشتري.');

  return (
    <div className="stack stack--loose">
      <AdminHeader title="المرتجعات والاستردادات" />
      <Feedback error={act.error} notice={act.notice} />

      <Card title="طلبات الإرجاع">
        {data.requests.length === 0 ? (
          <Empty>لا طلبات إرجاع.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>المتجر</th>
                  <th>السبب</th>
                  <th>القطع</th>
                  <th>منذ</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => (
                  <tr key={r.id}>
                    <td className="num small">{r.subOrder.subOrderNumber}</td>
                    <td className="small">{r.subOrder.vendor.nameAr}</td>
                    <td className="wrap small">
                      {RETURN_REASONS[r.reasonCode] ?? r.reasonCode}
                      {r.description ? <div className="muted">«{r.description}»</div> : null}
                    </td>
                    <td className="num">{r.itemsJson.reduce((a, i) => a + i.qty, 0)}</td>
                    <td className="small">{when(r.requestedAt)}</td>
                    <td>
                      <span className={`badge ${TONE[r.status] ?? 'badge--warning'}`}>{RETURN_STATUS[r.status] ?? r.status}</span>
                      <div className="small muted">{labelOf(r.subOrder.status)}</div>
                    </td>
                    <td>
                      {r.status === 'requested' ? (
                        <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => void receive(r.subOrder.id, r.id)}>
                          تسجيل الاستلام بدل المتجر
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="الاستردادات">
        {data.refunds.length === 0 ? (
          <Empty>لا استردادات.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>للمشتري</th>
                  <th>على البائع</th>
                  <th>السبب</th>
                  <th>الحالة</th>
                  <th>مرجع البوابة</th>
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((r) => (
                  <tr key={r.id}>
                    <td className="num small">
                      {r.subOrder.subOrderNumber}
                      <div className="muted">{when(r.createdAt)}</div>
                    </td>
                    <td className="money">{money(r.amountMinorUnits, r.currency)}</td>
                    <td className="money">
                      {r.vendorAmountMinorUnits ? money(r.vendorAmountMinorUnits, r.subOrder.settlementCurrency) : '—'}
                      {r.vendorNegative ? <div className="small" style={{ color: 'var(--danger-text)' }}>رصيد {r.subOrder.vendor.nameAr} سالب: {money(r.vendorNegative, r.subOrder.settlementCurrency)}</div> : null}
                    </td>
                    <td className="small">{r.reason}</td>
                    <td>
                      <span className={`badge ${r.status === 'succeeded' ? 'badge--approved' : 'badge--warning'}`}>{r.status === 'succeeded' ? 'تمّ' : 'قيد التنفيذ'}</span>
                    </td>
                    <td className="num small">{r.providerRefundId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
