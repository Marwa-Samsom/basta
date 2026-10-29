'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Alert, TextArea, TextInput } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { api } from '@/lib/api';
import {
  ACTION_LABEL,
  RETURN_REASONS,
  ROLE_LABEL,
  carrierName,
  historyReason,
  labelOf,
  money,
  toneOf,
  trackingLabel,
  when,
  hoursAr,
  type SubOrderStatus,
  type SubOrderView,
} from '@/lib/orders';

interface VendorDetail extends SubOrderView {
  orderNumber: string;
  /** مهلة القبول كما تضبطها الإدارة — المهمة تلغي بها */
  acceptanceHours: number;
  shippingAddress: Record<string, string>;
  customerNote: string | null;
  financials: {
    itemsSubtotalMinorUnits: string;
    shippingMinorUnits: string;
    discountMinorUnits: string;
    /** حصّتك من الخصم (كوبونك) — تُطرح؛ وحصّة المنصّة (كوبونها) لا تُطرح منك */
    vendorDiscountMinorUnits: string;
    platformDiscountMinorUnits: string;
    commissionMinorUnits: string;
    commissionRateBps: number;
    netMinorUnits: string;
    /** ما رجع من نصيبك للمشتري، وصافيك بعده كما في دفترك */
    refundedMinorUnits: string;
    netAfterRefundsMinorUnits: string;
  };
}

interface Waybill {
  carrierCode: string;
  trackingNumber: string;
  labelText: string;
}

/** أيقونة كل انتقال في «الإجراءات المتاحة» — كما في VD-13 */
const ACTION_ICON: Partial<Record<SubOrderStatus, IconName>> = {
  accepted: 'check',
  preparing: 'package',
  ready_to_ship: 'boxes',
  shipped: 'truck',
  delivered: 'check-circle',
  delivery_failed: 'alert',
  returned: 'package',
  canceled_by_customer: 'x',
};

/** حالات تُرسم في المسار بلون الخطر: خروج عن المسار السعيد */
const BAD = new Set(['delivery_failed', 'return_requested', 'returned', 'rejected_by_vendor', 'canceled_by_customer', 'canceled_by_admin', 'refunded']);

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
  /**
   * شركات الشحن الموصولة من الخادم: بلا شركة (SHIPPING_CARRIER=none) التوصيل ذاتي
   * وحده — زرّ البوليصة كان يوحي بمندوب يأتي، ولا أحد يأتي.
   */
  const [carriers, setCarriers] = useState<{ code: string; nameAr: string }[] | null>(null);
  const hasCarrier = carriers?.some((c) => c.code !== 'self') ?? false;

  useEffect(() => {
    let alive = true;
    api<{ code: string; nameAr: string }[]>('/vendor/shipping/carriers')
      .then((list) => {
        if (alive) setCarriers(list);
      })
      .catch(() => {
        if (alive) setCarriers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

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
    return error ? (
      <div className="vm-page">
        <Link href="/vendor/orders" className="vm-back">
          <Icon name="back" size={14} mirror />
          الطلبات
        </Link>
        <div className="empty">
          <span className="empty__icon vm-error-icon" aria-hidden>
            <Icon name="alert" size={26} />
          </span>
          <p className="empty__title">تعذّر فتح الطلب</p>
          <Alert tone="danger">{error}</Alert>
        </div>
      </div>
    ) : (
      <div className="vm-loading vm-loading--page" role="status">
        <span className="visually-hidden">جارٍ فتح الطلب…</span>
        <span className="skeleton vm-loading__title" />
        <span className="skeleton vm-loading__block" />
        <span className="skeleton vm-loading__panel" />
      </div>
    );
  }

  const addr = order.shippingAddress;
  const openReturn = order.returns.find((r) => r.status === 'requested');
  const itemOf = (itemId: string) => order.items.find((i) => i.id === itemId);
  const simple = order.actions.filter((a) => a !== 'rejected_by_vendor' && a !== 'shipped' && a !== 'returned' && !(a === 'delivered' && order.status === 'return_requested'));
  const f = order.financials;
  const rate = (f.commissionRateBps / 100).toFixed(1);
  const address = [addr['street'], addr['building'], addr['area'], addr['city'], addr['region']].filter(Boolean).join('، ');

  return (
    <div className="vm-page">
      <div className="vm-detail-head">
        <Link href="/vendor/orders" className="vm-back">
          <Icon name="back" size={14} mirror />
          الطلبات
        </Link>
        <h1 className="num">{order.number}</h1>
        <span className={`badge vm-status ${toneOf(order.status)}`}>
          <span className="vm-status__dot" aria-hidden />
          {labelOf(order.status)}
        </span>
        <span className="vm-detail-head__meta">
          أُنشئ {when(order.placedAt)} · طلب المشتري <span className="num">{order.orderNumber}</span>
        </span>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {order.status === 'awaiting_vendor' ? (
        <Alert tone="warning">اقبل الطلب أو ارفضه خلال {hoursAr(order.acceptanceHours)} من وصوله، وإلا أُلغي آلياً.</Alert>
      ) : null}

      {order.status === 'awaiting_vendor' || order.status === 'accepted' ? (
        <p className="vm-note">
          <Icon name="info" size={16} />
          بعد بدء التجهيز لا يستطيع المشتري إلغاء الطلب.
        </p>
      ) : null}

      <div className="vm-detail">
        <div className="vm-detail__main">
          {/* VD-16 — طلب الإرجاع */}
          {openReturn ? (
            <section className="card vm-return">
              <div className="vm-return__head">
                <h2>طلب إرجاع</h2>
                <span className="badge badge--warning">بانتظار قرارك</span>
                <span className="vm-return__date">{when(openReturn.requestedAt)}</span>
              </div>
              <div className="vm-field">
                <span className="vm-field__label">سبب المشتري</span>
                <p className="vm-field__text">
                  {RETURN_REASONS[openReturn.reasonCode] ?? openReturn.reasonCode}
                  {openReturn.description ? <> — «{openReturn.description}»</> : null}
                </p>
              </div>
              <div className="vm-field">
                <span className="vm-field__label">القطع المطلوب إرجاعها</span>
                <ul className="vm-return__items">
                  {openReturn.itemsJson.map((i) => {
                    const item = itemOf(i.orderItemId);
                    return (
                      <li key={i.orderItemId}>
                        <span className="vm-line__main">
                          <span className="vm-line__name">{item?.productNameSnapshotAr ?? '—'}</span>
                          {item ? <span className="num vm-line__sku">{item.skuSnapshot}</span> : null}
                        </span>
                        <span className="num vm-line__qty">× {i.qty}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <p className="vm-hint">عند الاستلام تعود القطع للمخزون ويُردّ ثمنها للمشتري آلياً. الشحن لا يُردّ في الإرجاع.</p>
              <div className="row">
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void move('returned', { returnRequestId: openReturn.id })}>
                  <Icon name="package" size={15} />
                  استلمت المرتجع
                </button>
                <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setAsking('deny')}>
                  <Icon name="x" size={15} />
                  رفض الإرجاع
                </button>
              </div>
              {asking === 'deny' ? (
                <div className="vm-subpanel">
                  <TextArea label="سبب رفض الإرجاع — يُعرض للمشتري" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
                  <div className="row">
                    <button type="button" className="btn btn--danger" disabled={busy || reason.trim().length < 5} onClick={() => void denyReturn()}>
                      <Icon name="x" size={15} />
                      تأكيد الرفض
                    </button>
                    <button type="button" className="btn btn--secondary" onClick={() => setAsking(null)}>
                      تراجع
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="card">
            <h2 className="vm-card-title">بيانات الشحن</h2>
            <dl className="vm-kv">
              <div>
                <dt>المستلم</dt>
                <dd className="vm-kv__strong">{addr['recipientName'] ?? '—'}</dd>
              </div>
              <div>
                <dt>الجوال</dt>
                <dd className="num">{addr['phone'] ?? '—'}</dd>
              </div>
              <div className="vm-kv__wide">
                <dt>العنوان</dt>
                <dd className="vm-kv__body">{address || '—'}</dd>
              </div>
              {order.shipment ? (
                <div>
                  <dt>الناقل</dt>
                  <dd>{carrierName(order.shipment.carrierCode)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{order.shipment ? trackingLabel(order.shipment.carrierCode) : 'رقم التتبّع'}</dt>
                {order.shipment ? (
                  <dd className="num">{order.shipment.trackingNumber}</dd>
                ) : (
                  <dd className="vm-kv__empty">لم يُشحن بعد</dd>
                )}
              </div>
              {order.customerNote ? (
                <div className="vm-kv__wide">
                  <dt>ملاحظة المشتري</dt>
                  <dd className="vm-kv__body">{order.customerNote}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="card card--flush">
            <header className="card__head">
              <h2>المنتجات</h2>
              <span className="num vm-count">{order.items.length}</span>
            </header>
            <ul className="vm-lines">
              {order.items.map((i) => (
                <li key={i.id}>
                  <span className="vm-line__main">
                    <span className="vm-line__name">
                      {i.productNameSnapshotAr}
                      {i.variantLabelSnapshot ? <span className="vm-line__variant"> · {i.variantLabelSnapshot}</span> : null}
                    </span>
                    <span className="num vm-line__sku">{i.skuSnapshot}</span>
                  </span>
                  <span className="num vm-line__qty">
                    × {i.qty}
                    {/* «أُرجع» لما عاد بإرجاع وحده — ما رُدّ ثمنه برفض أو إلغاء «أُلغي» (J-03) */}
                    {i.refundedQty ? (
                      <span className="vm-line__refund">
                        {' '}
                        (
                        {[i.returnedQty ? `أُرجع ${i.returnedQty}` : '', i.refundedQty > i.returnedQty ? `أُلغي ${i.refundedQty - i.returnedQty}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                        )
                      </span>
                    ) : null}
                  </span>
                  {/* سعر القطعة × الكمية كالتصميم VD-13، ومجموعها «المنتجات» في التفصيل — لا الإجمالي بضريبة
                      ليست للمتجر: كان «230.00» جنب «المنتجات 200.00» حيث الضريبة تُضاف (VOPS-010، 29 أكتوبر 2026) */}
                  <span className="money num vm-line__total">{money(i.lineSubtotalMinorUnits, order.currency)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2 className="vm-card-title">مسار الطلب</h2>
            <ol className="vm-timeline">
              {order.history.map((h, i) => {
                const last = i === order.history.length - 1;
                const state = BAD.has(h.toStatus) ? 'bad' : last ? 'current' : 'done';
                return (
                  <li key={i} className="vm-timeline__step" data-state={state}>
                    <span className="vm-timeline__rail" aria-hidden>
                      <span className="vm-timeline__dot">
                        <Icon name={state === 'bad' ? 'alert' : state === 'current' ? 'clock' : 'check'} size={14} />
                      </span>
                      {last ? null : <span className="vm-timeline__line" />}
                    </span>
                    <span className="vm-timeline__body">
                      <span className="vm-timeline__label">{h.toLabel}</span>
                      <span className="vm-timeline__meta">
                        <span className="vm-timeline__date">{when(h.createdAt)}</span>
                        <span>المنفّذ: {h.actorRole ? ROLE_LABEL[h.actorRole] ?? h.actorRole : 'آلي'}</span>
                      </span>
                      {h.reason ? <span className="vm-timeline__note">«{historyReason(h)}»</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="vm-detail__side">
          <section className="card vm-amounts">
            <h2 className="vm-card-title">تفصيل المبالغ</h2>
            <dl className="vm-amounts__rows">
              <div>
                <dt>المنتجات</dt>
                <dd className="money num">{money(f.itemsSubtotalMinorUnits, order.currency)}</dd>
              </div>
              {/* حصّتك وحدها: خصم كوبون المنصّة لا يُنقص صافيك، فلا يُطرح هنا — والسطور تجمع إلى الصافي (VOPS-012) */}
              {BigInt(f.vendorDiscountMinorUnits) > 0n ? (
                <div>
                  <dt>الخصم</dt>
                  <dd className="money num">−{money(f.vendorDiscountMinorUnits, order.currency)}</dd>
                </div>
              ) : null}
              <div>
                <dt>عمولة بسطة ({rate}%)</dt>
                <dd className="money num">−{money(f.commissionMinorUnits, order.currency)}</dd>
              </div>
              <div>
                <dt>الشحن</dt>
                <dd className="money num">+{money(f.shippingMinorUnits, order.currency)}</dd>
              </div>
              {BigInt(f.refundedMinorUnits) > 0n ? (
                <div>
                  <dt>رُدّ للمشتري من نصيبك</dt>
                  <dd className="money num">−{money(f.refundedMinorUnits, order.currency)}</dd>
                </div>
              ) : null}
              {/* من الدفتر لا من لقطة الطلب — طلب رُدّ كله صافيه صفر لا 92.000 (J-03) */}
              <div className="vm-amounts__total">
                <dt>صافي أرباحك</dt>
                <dd className="money num">{money(f.netAfterRefundsMinorUnits, order.currency)}</dd>
              </div>
            </dl>
            <p className="vm-hint">العمولة {rate}% على القطع لا على الشحن.</p>
            {BigInt(f.platformDiscountMinorUnits) > 0n ? (
              <p className="vm-hint">
                خصم كوبون بسطة {money(f.platformDiscountMinorUnits, order.currency)} على حساب المنصّة — لا يُنقص صافيك.
              </p>
            ) : null}
            {order.refunds.length > 0 ? (
              <ul className="vm-refunds">
                {order.refunds.map((r) => (
                  <li key={r.id}>
                    استرداد للمشتري ({r.reason}) · {r.status === 'succeeded' ? 'تمّ' : 'قيد التنفيذ'}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="card vm-actions">
            <h2 className="vm-card-title">الإجراءات المتاحة</h2>
            <p className="vm-hint">
              {order.actions.length > 0 ? 'الأزرار المعروضة هي المسموحة في هذه الحالة فقط.' : 'لا إجراءات متاحة في هذه الحالة.'}
            </p>

            {simple.map((to) => (
              <button
                key={to}
                type="button"
                className={`btn ${to === 'delivery_failed' ? 'btn--danger' : 'btn--primary'}`}
                disabled={busy}
                onClick={() => void move(to)}
              >
                {ACTION_ICON[to] ? <Icon name={ACTION_ICON[to]} size={16} /> : null}
                {ACTION_LABEL[to] ?? labelOf(to)}
              </button>
            ))}

            {order.actions.includes('rejected_by_vendor') ? (
              <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setAsking('reject')}>
                <Icon name="x" size={16} />
                رفض الطلب
              </button>
            ) : null}

            {asking === 'reject' ? (
              <div className="vm-subpanel">
                <TextArea label="سبب الرفض — يُعرض للمشتري كما تكتبه" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
                <div className="row">
                  <button type="button" className="btn btn--danger" disabled={busy || reason.trim().length < 5} onClick={() => void move('rejected_by_vendor', { reason })}>
                    <Icon name="x" size={15} />
                    تأكيد الرفض
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => setAsking(null)}>
                    تراجع
                  </button>
                </div>
              </div>
            ) : null}

            {order.actions.includes('shipped') ? (
              <div className="vm-subpanel">
                {hasCarrier ? (
                  <>
                    <p className="vm-hint">أصدر بوليصة من شركة الشحن، أو أدخل رقم تتبّع توصيلك الذاتي.</p>
                    <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void issueWaybill()}>
                      <Icon name="file" size={16} />
                      إصدار بوليصة
                    </button>
                    {waybill ? <pre className="vm-waybill">{waybill.labelText}</pre> : null}
                  </>
                ) : (
                  <p className="vm-hint">
                    التوصيل ذاتي: سلّم الطلب بنفسك أو بمندوبك، واكتب مرجعاً تعرفه به (رقم إيصال أو اسم المندوب). بعد أن
                    يستلمه المشتري أكّد التسليم — يُبلَّغ المشتري، وله فتح نزاع قبل أن يُحرَّر مالك.
                  </p>
                )}
                <TextInput
                  label={hasCarrier ? 'رقم التتبّع' : 'مرجع التوصيل'}
                  className="field__control vm-mono"
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  dir="ltr"
                />
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || tracking.trim().length < 4}
                  onClick={() => void move('shipped', { tracking, carrierCode: carrier })}
                >
                  <Icon name="truck" size={16} />
                  تأكيد الشحن
                </button>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
