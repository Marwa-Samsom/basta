'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Alert, TextArea, TextInput } from '@/components/ui';
import { AcceptDeadline } from '@/components/accept-countdown';
import { Icon, type IconName } from '@/components/icons';
import { api } from '@/lib/api';
import {
  ACTION_LABEL,
  ACTION_LABEL_EN,
  RETURN_REASONS,
  RETURN_REASONS_EN,
  ROLE_LABEL,
  ROLE_LABEL_EN,
  carrierName,
  historyReason,
  labelOf,
  money,
  toneOf,
  trackingLabel,
  when,
  type SubOrderStatus,
  type SubOrderView,
} from '@/lib/orders';
import { regionName } from '@/lib/places';
import { localized } from '@/lib/i18n';
import { useLocale, useT } from '@/components/locale';
import { useReturnTick } from '@/lib/fresh';

interface VendorDetail extends SubOrderView {
  orderNumber: string;
  /** مهلة القبول كما تضبطها الإدارة — المهمة تلغي بها */
  acceptanceHours: number;
  /** موعد الإلغاء الآلي ما دام ينتظر التاجر، من الخادم */
  acceptBy: string | null;
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
  const t = useT();
  const locale = useLocale();
  const { id } = use(params);
  const [order, setOrder] = useState<VendorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState<'reject' | 'deny' | null>(null);
  /**
   * فتح خانة السبب أو «تراجع» عنها يبدأها فارغة. كان «تراجع» يُبقي ما كُتب، فوصل المشتري «مكسو«…»»:
   * كلمة تُركت ثم سبب كُتب بعدها (VOPS-044، 29 أكتوبر 2026) — والخانة نفسها لرفض الطلب ورفض الإرجاع
   */
  const ask = (which: 'reject' | 'deny' | null) => {
    setAsking(which);
    setReason('');
  };
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

  const returned = useReturnTick();
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
  }, [id, returned]);

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
          {t('الطلبات', 'Orders')}
        </Link>
        <div className="empty">
          <span className="empty__icon vm-error-icon" aria-hidden>
            <Icon name="alert" size={26} />
          </span>
          <p className="empty__title">{t('تعذّر فتح الطلب', 'Could not open the order')}</p>
          <Alert tone="danger">{error}</Alert>
        </div>
      </div>
    ) : (
      <div className="vm-loading vm-loading--page" role="status">
        <span className="visually-hidden">{t('جارٍ فتح الطلب…', 'Opening the order…')}</span>
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
  const address = [addr['street'], addr['building'], addr['area'], addr['city'], addr['region'] && regionName(addr['country'] ?? '', addr['region'], locale)]
    .filter(Boolean)
    .join(locale === 'en' ? ', ' : '، ');
  const returnReasons = localized(locale, RETURN_REASONS, RETURN_REASONS_EN);
  const roleLabel = localized(locale, ROLE_LABEL, ROLE_LABEL_EN);
  const actionLabel = localized(locale, ACTION_LABEL, ACTION_LABEL_EN);

  return (
    <div className="vm-page">
      <div className="vm-detail-head">
        <Link href="/vendor/orders" className="vm-back">
          <Icon name="back" size={14} mirror />
          {t('الطلبات', 'Orders')}
        </Link>
        <h1 className="num">{order.number}</h1>
        <span className={`badge vm-status ${toneOf(order.status)}`}>
          <span className="vm-status__dot" aria-hidden />
          {labelOf(order.status, locale)}
        </span>
        <span className="vm-detail-head__meta">
          {t(`أُنشئ ${when(order.placedAt)} · طلب المشتري`, `Created ${when(order.placedAt, locale)} · Buyer order`)}{' '}
          <span className="num">{order.orderNumber}</span>
        </span>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {order.status === 'awaiting_vendor' && order.acceptBy ? (
        <AcceptDeadline by={new Date(order.acceptBy)} hours={order.acceptanceHours} />
      ) : null}

      {order.status === 'awaiting_vendor' || order.status === 'accepted' ? (
        <p className="vm-note">
          <Icon name="info" size={16} />
          {t('بعد بدء التجهيز لا يستطيع المشتري إلغاء الطلب.', 'Once preparation starts, the buyer can no longer cancel the order.')}
        </p>
      ) : null}

      <div className="vm-detail">
        <div className="vm-detail__main">
          {/* VD-16 — طلب الإرجاع */}
          {openReturn ? (
            <section className="card vm-return">
              <div className="vm-return__head">
                <h2>{t('طلب إرجاع', 'Return request')}</h2>
                <span className="badge badge--warning">{t('بانتظار قرارك', 'Awaiting your decision')}</span>
                <span className="vm-return__date">{when(openReturn.requestedAt, locale)}</span>
              </div>
              <div className="vm-field">
                <span className="vm-field__label">{t('سبب المشتري', 'Buyer’s reason')}</span>
                <p className="vm-field__text">
                  {returnReasons[openReturn.reasonCode] ?? openReturn.reasonCode}
                  {openReturn.description ? <> — «{openReturn.description}»</> : null}
                </p>
              </div>
              <div className="vm-field">
                <span className="vm-field__label">{t('القطع المطلوب إرجاعها', 'Items to return')}</span>
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
              <p className="vm-hint">
                {t(
                  'عند الاستلام تعود القطع للمخزون ويُردّ ثمنها للمشتري آلياً. الشحن لا يُردّ في الإرجاع.',
                  'On receipt, the items go back to stock and the buyer is refunded automatically. Shipping is not refunded on returns.',
                )}
              </p>
              <div className="row">
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void move('returned', { returnRequestId: openReturn.id })}>
                  <Icon name="package" size={15} />
                  {t('استلمت المرتجع', 'Return received')}
                </button>
                <button type="button" className="btn btn--danger" disabled={busy} onClick={() => ask('deny')}>
                  <Icon name="x" size={15} />
                  {t('رفض الإرجاع', 'Reject return')}
                </button>
              </div>
              {asking === 'deny' ? (
                <div className="vm-subpanel">
                  <TextArea
                    label={t('سبب رفض الإرجاع — يُعرض للمشتري', 'Reason for rejecting the return — shown to the buyer')}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                  />
                  <div className="row">
                    <button type="button" className="btn btn--danger" disabled={busy || reason.trim().length < 5} onClick={() => void denyReturn()}>
                      <Icon name="x" size={15} />
                      {t('تأكيد الرفض', 'Confirm rejection')}
                    </button>
                    <button type="button" className="btn btn--secondary" onClick={() => ask(null)}>
                      {t('تراجع', 'Cancel')}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="card">
            <h2 className="vm-card-title">{t('بيانات الشحن', 'Shipping details')}</h2>
            <dl className="vm-kv">
              <div>
                <dt>{t('المستلم', 'Recipient')}</dt>
                <dd className="vm-kv__strong">{addr['recipientName'] ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('الجوال', 'Mobile')}</dt>
                <dd className="num">{addr['phone'] ?? '—'}</dd>
              </div>
              <div className="vm-kv__wide">
                <dt>{t('العنوان', 'Address')}</dt>
                <dd className="vm-kv__body">{address || '—'}</dd>
              </div>
              {order.shipment ? (
                <div>
                  <dt>{t('الناقل', 'Carrier')}</dt>
                  <dd>{carrierName(order.shipment.carrierCode, locale)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{order.shipment ? trackingLabel(order.shipment.carrierCode, locale) : t('رقم التتبّع', 'Tracking number')}</dt>
                {order.shipment ? (
                  <dd className="num">{order.shipment.trackingNumber}</dd>
                ) : (
                  <dd className="vm-kv__empty">{t('لم يُشحن بعد', 'Not shipped yet')}</dd>
                )}
              </div>
              {order.customerNote ? (
                <div className="vm-kv__wide">
                  <dt>{t('ملاحظة المشتري', 'Buyer’s note')}</dt>
                  <dd className="vm-kv__body">{order.customerNote}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="card card--flush">
            <header className="card__head">
              <h2>{t('المنتجات', 'Products')}</h2>
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
                        {[
                          i.returnedQty ? t(`أُرجع ${i.returnedQty}`, `${i.returnedQty} returned`) : '',
                          i.refundedQty > i.returnedQty
                            ? t(`أُلغي ${i.refundedQty - i.returnedQty}`, `${i.refundedQty - i.returnedQty} canceled`)
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        )
                      </span>
                    ) : null}
                  </span>
                  {/* سعر القطعة × الكمية كالتصميم VD-13، ومجموعها «المنتجات» في التفصيل — لا الإجمالي بضريبة
                      ليست للمتجر: كان «230.00» جنب «المنتجات 200.00» حيث الضريبة تُضاف (VOPS-010، 29 أكتوبر 2026) */}
                  <span className="money num vm-line__total">{money(i.lineSubtotalMinorUnits, order.currency, locale)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2 className="vm-card-title">{t('مسار الطلب', 'Order timeline')}</h2>
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
                      <span className="vm-timeline__label">{locale === 'en' ? labelOf(h.toStatus, locale) : h.toLabel}</span>
                      <span className="vm-timeline__meta">
                        <span className="vm-timeline__date">{when(h.createdAt, locale)}</span>
                        <span>
                          {t('المنفّذ:', 'By:')} {h.actorRole ? roleLabel[h.actorRole] ?? h.actorRole : t('آلي', 'Automatic')}
                        </span>
                      </span>
                      {h.reason ? <span className="vm-timeline__note">«{historyReason(h, locale)}»</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="vm-detail__side">
          <section className="card vm-amounts">
            <h2 className="vm-card-title">{t('تفصيل المبالغ', 'Amount breakdown')}</h2>
            <dl className="vm-amounts__rows">
              <div>
                <dt>{t('المنتجات', 'Products')}</dt>
                <dd className="money num">{money(f.itemsSubtotalMinorUnits, order.currency, locale)}</dd>
              </div>
              {/* حصّتك وحدها: خصم كوبون المنصّة لا يُنقص صافيك، فلا يُطرح هنا — والسطور تجمع إلى الصافي (VOPS-012) */}
              {BigInt(f.vendorDiscountMinorUnits) > 0n ? (
                <div>
                  <dt>{t('الخصم', 'Discount')}</dt>
                  <dd className="money num">−{money(f.vendorDiscountMinorUnits, order.currency, locale)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t(`عمولة بسطة (${rate}%)`, `Basta commission (${rate}%)`)}</dt>
                <dd className="money num">−{money(f.commissionMinorUnits, order.currency, locale)}</dd>
              </div>
              <div>
                <dt>{t('الشحن', 'Shipping')}</dt>
                <dd className="money num">+{money(f.shippingMinorUnits, order.currency, locale)}</dd>
              </div>
              {BigInt(f.refundedMinorUnits) > 0n ? (
                <div>
                  <dt>{t('رُدّ للمشتري من نصيبك', 'Refunded to the buyer from your share')}</dt>
                  <dd className="money num">−{money(f.refundedMinorUnits, order.currency, locale)}</dd>
                </div>
              ) : null}
              {/* من الدفتر لا من لقطة الطلب — طلب رُدّ كله صافيه صفر لا 92.000 (J-03) */}
              <div className="vm-amounts__total">
                <dt>{t('صافي أرباحك', 'Your net earnings')}</dt>
                <dd className="money num">{money(f.netAfterRefundsMinorUnits, order.currency, locale)}</dd>
              </div>
            </dl>
            <p className="vm-hint">{t(`العمولة ${rate}% على القطع لا على الشحن.`, `The ${rate}% commission applies to items, not shipping.`)}</p>
            {BigInt(f.platformDiscountMinorUnits) > 0n ? (
              <p className="vm-hint">
                {t(
                  `خصم كوبون بسطة ${money(f.platformDiscountMinorUnits, order.currency)} على حساب المنصّة — لا يُنقص صافيك.`,
                  `The Basta coupon discount of ${money(f.platformDiscountMinorUnits, order.currency, locale)} is covered by the platform — it does not reduce your net.`,
                )}
              </p>
            ) : null}
            {order.refunds.length > 0 ? (
              <ul className="vm-refunds">
                {order.refunds.map((r) => (
                  <li key={r.id}>
                    {t('استرداد للمشتري', 'Refund to buyer')} ({r.reason}) ·{' '}
                    {r.status === 'succeeded' ? t('تمّ', 'Done') : t('قيد التنفيذ', 'In progress')}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="card vm-actions">
            <h2 className="vm-card-title">{t('الإجراءات المتاحة', 'Available actions')}</h2>
            <p className="vm-hint">
              {order.actions.length > 0
                ? t('الأزرار المعروضة هي المسموحة في هذه الحالة فقط.', 'Only the actions allowed in this status are shown.')
                : t('لا إجراءات متاحة في هذه الحالة.', 'No actions available in this status.')}
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
                {actionLabel[to] ?? labelOf(to, locale)}
              </button>
            ))}

            {order.actions.includes('rejected_by_vendor') ? (
              <button type="button" className="btn btn--danger" disabled={busy} onClick={() => ask('reject')}>
                <Icon name="x" size={16} />
                {t('رفض الطلب', 'Reject order')}
              </button>
            ) : null}

            {asking === 'reject' ? (
              <div className="vm-subpanel">
                <TextArea
                  label={t('سبب الرفض — يُعرض للمشتري كما تكتبه', 'Reason for rejection — shown to the buyer as you write it')}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                />
                <div className="row">
                  <button type="button" className="btn btn--danger" disabled={busy || reason.trim().length < 5} onClick={() => void move('rejected_by_vendor', { reason })}>
                    <Icon name="x" size={15} />
                    {t('تأكيد الرفض', 'Confirm rejection')}
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => ask(null)}>
                    {t('تراجع', 'Cancel')}
                  </button>
                </div>
              </div>
            ) : null}

            {order.actions.includes('shipped') ? (
              <div className="vm-subpanel">
                {hasCarrier ? (
                  <>
                    <p className="vm-hint">
                      {t(
                        'أصدر بوليصة من شركة الشحن، أو أدخل رقم تتبّع توصيلك الذاتي.',
                        'Issue a waybill from the shipping company, or enter your self-delivery tracking number.',
                      )}
                    </p>
                    <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void issueWaybill()}>
                      <Icon name="file" size={16} />
                      {t('إصدار بوليصة', 'Issue waybill')}
                    </button>
                    {waybill ? <pre className="vm-waybill">{waybill.labelText}</pre> : null}
                  </>
                ) : (
                  <p className="vm-hint">
                    {t(
                      'التوصيل ذاتي: سلّم الطلب بنفسك أو بمندوبك، واكتب مرجعاً تعرفه به (رقم إيصال أو اسم المندوب). بعد أن يستلمه المشتري أكّد التسليم — يُبلَّغ المشتري، وله فتح نزاع قبل أن يُحرَّر مالك.',
                      'Self-delivery: hand the order over yourself or through your courier, and write a reference you know it by (a receipt number or the courier’s name). Once the buyer receives it, confirm delivery — the buyer is notified and can open a dispute before your money is released.',
                    )}
                  </p>
                )}
                <TextInput
                  label={hasCarrier ? t('رقم التتبّع', 'Tracking number') : t('مرجع التوصيل', 'Delivery reference')}
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
                  {t('تأكيد الشحن', 'Confirm shipment')}
                </button>
              </div>
            ) : null}

            {/* شحنة لم تصل وعادت للمتجر — كالتصميم VD-13: القطع للمخزون وكل المبلغ للمشتري. كان الخادم يقبل
                الانتقال ولا زرّ له، فلا يملك البائع إلا إعادة الشحن (VOPS-036، 29 أكتوبر 2026) */}
            {order.status === 'delivery_failed' && order.actions.includes('returned') ? (
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void move('returned')}>
                <Icon name="store" size={16} />
                {t('أرجعه للمتجر', 'Return to shop')}
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
