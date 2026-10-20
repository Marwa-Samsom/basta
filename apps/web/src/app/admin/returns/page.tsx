'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { TONE, useAction, useAdminData } from '@/lib/admin';
import { labelOf, money, REFUND_STATUS, RETURN_REASONS, when } from '@/lib/orders';

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

/** ثلاثة أيام بلا ردّ من المتجر — يظهر العمر بالأحمر ويصير التدخّل الإجراء الأوّل */
// العتبة نفسها التي ينبّه بها الخادم المديرين (RETURN_STALL_DAYS في admin-alerts.scheduler)
const STALL_MS = 3 * 24 * 3_600_000;

/**
 * AD-15 — المرتجعات والاستردادات. الإدارة تتدخّل حين يتعثّر متجر: تستلم
 * المرتجع بدلاً منه (الانتقال نفسه بفاعل admin)، والاسترداد يظهر بمرجع
 * البوابة، والرصيد السالب للبائع إن نتج بجانبه.
 */
export default function AdminReturnsPage() {
  const { data, error, forbidden, reload } = useAdminData<Data>('/admin/returns');
  const act = useAction();
  // لحظة فتح الصفحة — يُقاس بها عمر الطلب، ولا تتغيّر بين رسم ورسم
  const [now] = useState(() => Date.now());
  if (!data) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;

  const receive = (subOrderId: string, returnRequestId: string) =>
    act.run(async () => {
      await api(`/admin/orders/stores/${subOrderId}/transition`, { method: 'POST', body: { to: 'returned', returnRequestId } });
      reload();
    }, 'سُجّل الاستلام: عادت القطع للمخزون ويُردّ نصيبها للمشتري.');

  return (
    <div className="ao-page">
      <AdminHeader title="المرتجعات والمبالغ المعادة" />
      <Feedback error={act.error} notice={act.notice} />

      <section className="card card--flush">
        <header className="card__head">
          <h2>طلبات الإرجاع</h2>
          <span className="ao-card-count num">{data.requests.length}</span>
        </header>
        {data.requests.length === 0 ? (
          <Empty icon="return" title="لا طلبات إرجاع">
            تظهر هنا طلبات الإرجاع حين يفتحها المشترون.
          </Empty>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="طلبات الإرجاع">
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>المتجر</th>
                  <th>السبب</th>
                  <th className="end">القطع</th>
                  <th>منذ</th>
                  <th>الحالة</th>
                  <th className="end">
                    <span className="visually-hidden">الإجراء</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => {
                  const stalled = r.status === 'requested' && now - new Date(r.requestedAt).getTime() >= STALL_MS;
                  return (
                    <tr key={r.id}>
                      <td className="num ao-strong">{r.subOrder.subOrderNumber}</td>
                      <td data-label="المتجر" className="ao-strong">
                        {r.subOrder.vendor.nameAr}
                      </td>
                      <td data-label="السبب" className="wrap">
                        <span className="ao-stack">
                          <span>{RETURN_REASONS[r.reasonCode] ?? r.reasonCode}</span>
                          {r.description ? <span className="ao-stack__sub">«{r.description}»</span> : null}
                        </span>
                      </td>
                      <td data-label="القطع" className="end num">
                        {r.itemsJson.reduce((a, i) => a + i.qty, 0)}
                      </td>
                      <td data-label="منذ" className="ao-date" data-late={stalled}>
                        {when(r.requestedAt)}
                      </td>
                      <td data-label="الحالة">
                        <span className="ao-stack">
                          <span className={`badge ${TONE[r.status] ?? 'badge--warning'}`}>{RETURN_STATUS[r.status] ?? r.status}</span>
                          <span className="ao-stack__sub">{labelOf(r.subOrder.status)}</span>
                        </span>
                      </td>
                      <td data-label="" className="end">
                        {r.status === 'requested' ? (
                          <button type="button" className={`btn btn--sm ${stalled ? 'btn--primary' : 'btn--secondary'}`} disabled={act.busy} onClick={() => void receive(r.subOrder.id, r.id)}>
                            تسجيل الاستلام بدل المتجر
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card--flush">
        <header className="card__head">
          <h2>المبالغ المعادة</h2>
          <span className="ao-card-count num">{data.refunds.length}</span>
        </header>
        {data.refunds.length === 0 ? (
          <Empty icon="wallet" title="لا استردادات">
            تظهر هنا المبالغ المعادة للمشترين بمرجع البوابة أو التحويل.
          </Empty>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="الاستردادات">
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th className="end">للمشتري</th>
                  <th className="end">على البائع</th>
                  <th>السبب</th>
                  <th>الحالة</th>
                  <th>المرجع</th>
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((r) => (
                  <tr key={r.id} data-late={Boolean(r.vendorNegative)}>
                    <td>
                      <span className="ao-stack">
                        <span className="num ao-strong">{r.subOrder.subOrderNumber}</span>
                        <span className="ao-stack__sub">{when(r.createdAt)}</span>
                      </span>
                    </td>
                    <td data-label="للمشتري" className="end">
                      <span className="money num">{money(r.amountMinorUnits, r.currency)}</span>
                    </td>
                    <td data-label="على البائع" className="end">
                      <span className="ao-stack ao-stack--end">
                        {r.vendorAmountMinorUnits ? <span className="money num">{money(r.vendorAmountMinorUnits, r.subOrder.settlementCurrency)}</span> : '—'}
                        {r.vendorNegative ? (
                          <span className="ao-rownote">
                            <Icon name="alert" size={13} />
                            <span>
                              رصيد {r.subOrder.vendor.nameAr} سالب: <span className="num">{money(r.vendorNegative, r.subOrder.settlementCurrency)}</span>
                            </span>
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td data-label="السبب" className="wrap">
                      {r.reason}
                    </td>
                    <td data-label="الحالة">
                      <span className={`badge ${r.status === 'succeeded' ? 'badge--approved' : 'badge--warning'}`}>{REFUND_STATUS[r.status] ?? r.status}</span>
                    </td>
                    <td data-label="المرجع" className="num">
                      {r.providerRefundId?.replace(/^manual:/, '') ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
