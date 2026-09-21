'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Alert, Card, Spinner, TextArea, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import {
  ACTION_LABEL,
  RETURN_REASONS,
  ROLE_LABEL,
  labelOf,
  money,
  toneOf,
  when,
  type SubOrderStatus,
  type SubOrderView,
} from '@/lib/orders';

interface VendorDetail extends SubOrderView {
  orderNumber: string;
  shippingAddress: Record<string, string>;
  customerNote: string | null;
  financials: {
    itemsSubtotalMinorUnits: string;
    shippingMinorUnits: string;
    discountMinorUnits: string;
    commissionMinorUnits: string;
    commissionRateBps: number;
    netMinorUnits: string;
  };
}

interface Waybill {
  carrierCode: string;
  trackingNumber: string;
  labelText: string;
}

/**
 * VD-13 تفاصيل الطلب · VD-14 البوليصة والشحن · VD-16 الإرجاع.
 *
 * الأزرار هي `actions` من الخادم كما هي — مشتقّة من آلة الحالات التي ترفض
 * على الخادم. فلا زرّ يظهر لانتقال يُرفض، ولا انتقال يُقبل بلا زرّ.
 */
export default function VendorOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<VendorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState<'reject' | 'deny' | null>(null);
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('self');
  const [waybill, setWaybill] = useState<Waybill | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next = await api<VendorDetail>(`/vendor/orders/${id}`);
        if (alive) setOrder(next);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const move = async (to: SubOrderStatus, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      setOrder(await api<VendorDetail>(`/vendor/orders/${id}/transition`, { method: 'POST', body: { to, ...extra } }));
      setError(null);
      setAsking(null);
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const denyReturn = async () => {
    setBusy(true);
    try {
      setOrder(await api<VendorDetail>(`/vendor/orders/${id}/return/deny`, { method: 'POST', body: { reason } }));
      setAsking(null);
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const issueWaybill = async () => {
    setBusy(true);
    try {
      const w = await api<Waybill>(`/vendor/shipping/waybill/${id}`, { method: 'POST' });
      setWaybill(w);
      setTracking(w.trackingNumber);
      setCarrier(w.carrierCode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!order) {
    return error ? <Alert tone="danger">{error}</Alert> : <Spinner label="جارٍ فتح الطلب…" />;
  }

  const addr = order.shippingAddress;
  const openReturn = order.returns.find((r) => r.status === 'requested');
  const itemName = (itemId: string) => order.items.find((i) => i.id === itemId)?.productNameSnapshotAr ?? '—';
  const simple = order.actions.filter((a) => a !== 'rejected_by_vendor' && a !== 'shipped' && a !== 'returned' && !(a === 'delivered' && order.status === 'return_requested'));

  return (
    <div className="stack stack--loose">
      <header className="row row--between">
        <div className="stack stack--tight">
          <Link href="/vendor/orders" className="small">
            → كل الطلبات
          </Link>
          <h1 className="num">{order.number}</h1>
          <span className="small muted">
            {when(order.placedAt)} · طلب المشتري <span className="num">{order.orderNumber}</span>
          </span>
        </div>
        <span className={`badge ${toneOf(order.status)}`}>{labelOf(order.status)}</span>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {order.status === 'awaiting_vendor' ? (
        <Alert tone="warning">اقبل الطلب أو ارفضه خلال 48 ساعة من وصوله، وإلا أُلغي آلياً.</Alert>
      ) : null}

      {/* الإجراءات */}
      {order.actions.length > 0 ? (
        <Card title="الإجراء التالي">
          <div className="stack">
            <div className="row">
              {simple.map((to) => (
                <button key={to} type="button" className={`btn ${to === 'delivery_failed' ? 'btn--secondary' : 'btn--primary'}`} disabled={busy} onClick={() => void move(to)}>
                  {ACTION_LABEL[to] ?? labelOf(to)}
                </button>
              ))}
              {order.actions.includes('rejected_by_vendor') ? (
                <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setAsking('reject')}>
                  رفض الطلب
                </button>
              ) : null}
            </div>

            {asking ? (
              <div className="stack">
                <TextArea label={asking === 'reject' ? 'سبب الرفض — يُعرض للمشتري كما تكتبه' : 'سبب رفض الإرجاع — يُعرض للمشتري'} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
                <div className="row">
                  <button
                    type="button"
                    className="btn btn--danger"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() => void (asking === 'reject' ? move('rejected_by_vendor', { reason }) : denyReturn())}
                  >
                    تأكيد الرفض
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setAsking(null)}>
                    تراجع
                  </button>
                </div>
              </div>
            ) : null}

            {order.actions.includes('shipped') ? (
              <div className="stack">
                <p className="small muted">أصدر بوليصة من شركة الشحن، أو أدخل رقم تتبّع توصيلك الذاتي.</p>
                <div className="row">
                  <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void issueWaybill()}>
                    إصدار بوليصة
                  </button>
                </div>
                {waybill ? <pre className="card small" style={{ whiteSpace: 'pre-wrap' }}>{waybill.labelText}</pre> : null}
                <TextInput label="رقم التتبّع" value={tracking} onChange={(e) => setTracking(e.target.value)} dir="ltr" />
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || tracking.trim().length < 4}
                  onClick={() => void move('shipped', { tracking, carrierCode: carrier })}
                >
                  تأكيد الشحن
                </button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* VD-16 — طلب الإرجاع */}
      {openReturn ? (
        <Card title="طلب إرجاع" hint={`${RETURN_REASONS[openReturn.reasonCode] ?? openReturn.reasonCode} · ${when(openReturn.requestedAt)}`}>
          <div className="stack">
            {openReturn.description ? <p>«{openReturn.description}»</p> : null}
            <ul className="stack stack--tight">
              {openReturn.itemsJson.map((i) => (
                <li key={i.orderItemId}>
                  {itemName(i.orderItemId)} × <span className="num">{i.qty}</span>
                </li>
              ))}
            </ul>
            <p className="small muted">عند الاستلام تعود القطع للمخزون ويُردّ نصيبها للمشتري آلياً. لا يُردّ الشحن في الإرجاع الجزئي.</p>
            <div className="row">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void move('returned', { returnRequestId: openReturn.id })}>
                استلمت المرتجع
              </button>
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setAsking('deny')}>
                رفض الإرجاع
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid-2">
        <Card title="القطع">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>SKU</th>
                  <th>الكمية</th>
                  <th>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <td className="wrap">
                      {i.productNameSnapshotAr}
                      {i.variantLabelSnapshot ? <span className="small muted"> · {i.variantLabelSnapshot}</span> : null}
                    </td>
                    <td className="num small">{i.skuSnapshot}</td>
                    <td className="num">
                      {i.qty}
                      {i.refundedQty ? <span className="small muted"> (أُرجع {i.refundedQty})</span> : null}
                    </td>
                    <td className="money">{money(i.lineTotalMinorUnits, order.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="الحساب" hint={`العمولة ${(order.financials.commissionRateBps / 100).toFixed(1)}% على القطع لا على الشحن`}>
          <dl className="summary__rows">
            <div className="row row--between"><dt>القطع</dt><dd className="money">{money(order.financials.itemsSubtotalMinorUnits, order.currency)}</dd></div>
            <div className="row row--between"><dt>الشحن</dt><dd className="money">{money(order.financials.shippingMinorUnits, order.currency)}</dd></div>
            <div className="row row--between"><dt>الخصم</dt><dd className="money">−{money(order.financials.discountMinorUnits, order.currency)}</dd></div>
            <div className="row row--between"><dt>العمولة</dt><dd className="money">−{money(order.financials.commissionMinorUnits, order.currency)}</dd></div>
            <div className="row row--between summary__total"><dt>صافيك</dt><dd className="money">{money(order.financials.netMinorUnits, order.currency)}</dd></div>
          </dl>
          {order.refunds.length > 0 ? (
            <ul className="stack stack--tight small">
              {order.refunds.map((r) => (
                <li key={r.id}>
                  استرداد للمشتري ({r.reason}) · {r.status === 'succeeded' ? 'تمّ' : 'قيد التنفيذ'}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card title="الشحن إلى">
          <p>{addr['recipientName']}</p>
          <p className="small">
            {[addr['street'], addr['building'], addr['area'], addr['city'], addr['region']].filter(Boolean).join('، ')}
          </p>
          <p className="num small" dir="ltr">{addr['phone']}</p>
          {order.customerNote ? <p className="small muted">ملاحظة المشتري: {order.customerNote}</p> : null}
          {order.shipment ? (
            <p className="small">
              التتبّع: <span className="num">{order.shipment.trackingNumber}</span>
            </p>
          ) : null}
        </Card>

        <Card title="السجل">
          <ol className="stack stack--tight">
            {order.history.map((h, i) => (
              <li key={i} className="small">
                <strong>{h.toLabel}</strong> · {when(h.createdAt)}
                {h.actorRole ? <span className="muted"> · {ROLE_LABEL[h.actorRole] ?? h.actorRole}</span> : <span className="muted"> · آلي</span>}
                {h.reason ? <div className="muted">«{h.reason}»</div> : null}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
