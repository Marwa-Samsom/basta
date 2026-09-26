'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Alert, PageHead, Spinner, TextArea } from '@/components/ui';
import { api, session } from '@/lib/api';
import {
  DISPUTE_REASONS,
  RETURN_REASONS,
  labelOf,
  money,
  toneOf,
  when,
  type OrderItemView,
  type SubOrderView,
} from '@/lib/orders';
import { imageUrl } from '@/lib/storefront';

interface Item extends OrderItemView {
  imageKeySnapshot?: string | null;
}

interface Store extends Omit<SubOrderView, 'items'> {
  items: Item[];
  chargeTotalMinorUnits: string;
  returnable: boolean;
  reviewable: boolean;
}

interface OrderView {
  number: string;
  status: string;
  currency: string;
  placedAt: string;
  grandTotalMinorUnits: string;
  itemsSubtotalMinorUnits: string;
  shippingTotalMinorUnits: string;
  discountTotalMinorUnits: string;
  paymentStatus: string | null;
  stores: Store[];
}

/** مسار التتبّع بالترتيب الذي يراه المشتري — ST-19 */
const TRACK = [
  { key: 'awaiting_vendor', label: 'استُلم الطلب' },
  { key: 'accepted', label: 'قبله البائع' },
  { key: 'preparing', label: 'قيد التجهيز' },
  { key: 'shipped', label: 'تم الشحن' },
  { key: 'delivered', label: 'تم التسليم' },
] as const;

const ORDER_OF: Record<string, number> = {
  awaiting_vendor: 0,
  accepted: 1,
  preparing: 2,
  ready_to_ship: 2,
  shipped: 3,
  delivery_failed: 3,
  delivered: 4,
  return_requested: 4,
  returned: 4,
  completed: 4,
};

/** الصورة المصغّرة من لقطة صورة القطعة وقت الطلب */
const thumbOf = (key: string | null | undefined): string | null =>
  key ? imageUrl(`/uploads/${key}/thumb.webp`) : null;

/**
 * ST-19 تتبّع الطلب لكل متجر · ST-20 الإرجاع · ST-22 المراجعة · ST-21 النزاع.
 *
 * كل متجر بطاقة مستقلة بمساره وشحنته وأزراره: إلغاء متجر لا يمسّ غيره،
 * والإرجاع يُطلب من المتجر الذي شحن لا من الطلب كله.
 */
export default function MyOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrder(await api<OrderView>(`/me/orders/${encodeURIComponent(decodeURIComponent(number))}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [number]);

  useEffect(() => {
    if (!session.read()) {
      router.replace(`/login?next=/account/orders/${number}`);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const next = await api<OrderView>(`/me/orders/${encodeURIComponent(decodeURIComponent(number))}`);
        if (alive) setOrder(next);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [number, router]);

  const back = (
    <Link href="/account/orders" className="sp-back">
      <Icon name="back" size={16} mirror />
      طلباتي
    </Link>
  );

  if (!order) {
    return (
      <div className="sp-page">
        {back}
        {error ? <Alert tone="danger">{error}</Alert> : <Spinner label="جارٍ فتح طلبك…" />}
      </div>
    );
  }

  const storeCount =
    order.stores.length === 1 ? 'متجر واحد' : order.stores.length === 2 ? 'متجران' : `${order.stores.length} متاجر`;

  return (
    <div className="sp-page">
      {back}
      <PageHead title={<span className="num">{order.number}</span>} meta={`${when(order.placedAt)} · ${storeCount}`} />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="sp-detail">
        <div className="sp-detail__main">
          {order.stores.map((s) => (
            <StoreCard
              key={s.id}
              store={s}
              orderNumber={order.number}
              currency={order.currency}
              onChange={(o, msg) => {
                if (o) setOrder(o);
                else void load();
                setNotice(msg);
                setError(null);
              }}
              onError={setError}
            />
          ))}
        </div>

        <aside className="sp-detail__aside" aria-label="ملخّص الدفع">
          <div className="sp-sum">
            <h2 className="sp-sum__title">ملخّص الدفع</h2>
            <dl className="sp-sum__rows">
              <div>
                <dt>قيمة المنتجات</dt>
                <dd className="num">{money(order.itemsSubtotalMinorUnits, order.currency)}</dd>
              </div>
              <div>
                <dt>الشحن</dt>
                <dd className="num">{money(order.shippingTotalMinorUnits, order.currency)}</dd>
              </div>
              {order.discountTotalMinorUnits !== '0' ? (
                <div>
                  <dt>الخصم</dt>
                  <dd className="num sp-sum__saving">− {money(order.discountTotalMinorUnits, order.currency)}</dd>
                </div>
              ) : null}
              <div className="sp-sum__total">
                <dt>الإجمالي</dt>
                <dd className="money num">{money(order.grandTotalMinorUnits, order.currency)}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StoreCard({
  store: s,
  orderNumber,
  currency,
  onChange,
  onError,
}: {
  store: Store;
  orderNumber: string;
  currency: string;
  onChange: (o: OrderView | null, msg: string) => void;
  onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<'return' | 'dispute' | null>(null);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('damaged');
  const [text, setText] = useState('');
  const canceled = ['rejected_by_vendor', 'canceled_by_customer', 'canceled_by_admin', 'refunded'].includes(s.status);
  const step = ORDER_OF[s.status] ?? -1;
  const openDispute = s.disputes.find((d) => d.status === 'open' || d.status === 'escalated');
  const disputable = ['shipped', 'delivery_failed', 'delivered', 'return_requested', 'returned'].includes(s.status);

  /** تاريخ بلوغ كل مرحلة من سجلّ الحالات — المرحلة الأولى تاريخ الطلب نفسه */
  const reachedAt = (key: string, i: number): string | null =>
    i === 0 ? s.placedAt : (s.history.find((h) => h.toStatus === key)?.createdAt ?? null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () =>
    run(async () => {
      if (!window.confirm(`إلغاء ما طلبته من ${s.vendor.nameAr}؟ يُردّ مبلغه كاملاً، وباقي الطلب يكمل كما هو.`)) return;
      const o = await api<OrderView>(`/me/orders/${orderNumber}/stores/${s.id}/cancel`, { method: 'POST', body: {} });
      onChange(o, `أُلغي طلبك من ${s.vendor.nameAr} ويُردّ مبلغه إلى وسيلة دفعك.`);
    });

  const submitReturn = () =>
    run(async () => {
      const items = Object.entries(qty)
        .filter(([, n]) => n > 0)
        .map(([orderItemId, n]) => ({ orderItemId, qty: n }));
      const res = await api<{ order: OrderView }>(`/me/orders/${orderNumber}/stores/${s.id}/return`, {
        method: 'POST',
        body: { items, reasonCode: reason, ...(text.trim() ? { description: text.trim() } : {}) },
      });
      setMode(null);
      onChange(res.order, 'أُرسل طلب الإرجاع للبائع. يُردّ المبلغ فور استلامه القطع.');
    });

  const submitDispute = () =>
    run(async () => {
      await api(`/me/disputes`, { method: 'POST', body: { subOrderId: s.id, reasonCode: reason, message: text } });
      setMode(null);
      onChange(null, 'فُتح النزاع. يردّ البائع هنا، ويمكنك تصعيده للإدارة.');
    });

  const review = (orderItemId: string, rating: number) =>
    run(async () => {
      await api(`/me/reviews`, { method: 'POST', body: { orderItemId, rating } });
      onChange(null, 'شكراً — نُشرت مراجعتك بشارة «شراء موثّق».');
    });

  return (
    <section className="sp-store" aria-labelledby={`store-${s.id}`}>
      <header className="sp-store__head">
        <span className="tile-icon sp-tile" aria-hidden>
          <Icon name="store" size={15} />
        </span>
        <h2 className="sp-store__name" id={`store-${s.id}`}>
          {s.vendor.nameAr}
        </h2>
        <span className="sp-store__no num">{s.number}</span>
        <span className={`badge ${toneOf(s.status)}`}>{labelOf(s.status)}</span>
      </header>

      <div className="sp-store__body">
        {canceled ? (
          <Alert tone="info">
            {labelOf(s.status)}
            {s.cancelReason ? ` — «${s.cancelReason}»` : ''}
            {s.refunds.length ? ` · رُدّ ${s.refunds.filter((r) => r.status === 'succeeded').length ? 'المبلغ' : '— قيد التنفيذ'}` : ''}
          </Alert>
        ) : (
          <ol className="sp-track" aria-label="مسار الطلب">
            {TRACK.map((t, i) => {
              const state = i < step ? 'done' : i === step ? 'current' : 'todo';
              const at = i <= step ? reachedAt(t.key, i) : null;
              return (
                <li
                  key={t.key}
                  className="sp-track__step"
                  data-state={state}
                  {...(i === step ? { 'aria-current': 'step' as const } : {})}
                >
                  <span className="sp-track__dot" aria-hidden>
                    <Icon name={state === 'done' ? 'check' : state === 'current' ? 'clock' : 'minus'} size={15} />
                  </span>
                  <span className="sp-track__label">{t.label}</span>
                  <span className="sp-track__date">{at ? when(at) : '—'}</span>
                </li>
              );
            })}
          </ol>
        )}

        {s.shipment ? (
          <div className="sp-ship">
            <p className="sp-ship__head">
              <Icon name="truck" size={17} />
              رقم التتبّع <span className="sp-ship__no num">{s.shipment.trackingNumber}</span>
              <span className="sp-ship__carrier num">{s.shipment.carrierCode}</span>
            </p>
            {s.shipment.events.length ? (
              <ul className="sp-events">
                {s.shipment.events.map((e, i) => (
                  <li key={i}>
                    <span>
                      {e.descriptionAr}
                      {e.location ? ` · ${e.location}` : ''}
                    </span>
                    <span className="sp-events__when">{when(e.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <ul className="sp-items">
          {s.items.map((i) => {
            const src = thumbOf(i.imageKeySnapshot);
            const rating = i.review?.rating ?? null;
            return (
              <li key={i.id} className="sp-items__row">
                <span className="sp-thumb sp-thumb--sm" aria-hidden>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" loading="lazy" width={34} height={34} />
                  ) : (
                    <Icon name="image" size={16} />
                  )}
                </span>
                <span className="sp-items__text">
                  <span className="sp-items__name">{i.productNameSnapshotAr}</span>
                  {i.variantLabelSnapshot || i.refundedQty ? (
                    <span className="sp-items__sub">
                      {i.variantLabelSnapshot}
                      {i.variantLabelSnapshot && i.refundedQty ? ' · ' : ''}
                      {i.refundedQty ? `أُرجع ${i.refundedQty}` : ''}
                    </span>
                  ) : null}
                </span>
                <span className="sp-items__qty num">× {i.qty}</span>
                <span className="sp-items__total money num">{money(i.lineTotalMinorUnits, currency)}</span>

                {s.reviewable && !i.review && i.refundedQty < i.qty ? (
                  <span className="sp-rate" role="group" aria-label="قيّم المنتج">
                    <span className="sp-rate__label" aria-hidden>
                      قيّم المنتج
                    </span>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="sp-rate__star"
                        disabled={busy}
                        onClick={() => void review(i.id, n)}
                        aria-label={`${n} من 5`}
                      >
                        <Icon name="star" size={18} />
                      </button>
                    ))}
                  </span>
                ) : rating !== null ? (
                  <span className="sp-rated" role="img" aria-label={`قيّمته ${rating}/5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Icon key={n} name={n <= rating ? 'star-fill' : 'star'} size={14} />
                    ))}
                    <span className="sp-rated__text" aria-hidden>
                      قيّمته {rating}/5
                    </span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="sp-store__foot">
        <p className="sp-kv">
          <span>حصّة هذا المتجر من دفعتك</span>
          <span className="sp-kv__v money num">{money(s.chargeTotalMinorUnits, currency)}</span>
        </p>

        {s.refunds.length ? (
          <ul className="sp-refunds">
            {s.refunds.map((r) => (
              <li key={r.id}>
                استرداد <span className="money num">{money(r.amountMinorUnits, currency)}</span> ({r.reason}) ·{' '}
                {r.status === 'succeeded' ? 'رُدّ إلى وسيلة دفعك' : 'قيد التنفيذ'}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="sp-store__actions">
          {s.actions.includes('canceled_by_customer') ? (
            <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void cancel()}>
              <Icon name="x" size={14} />
              إلغاء هذا المتجر
            </button>
          ) : null}
          {s.returnable ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setMode('return'), setReason('damaged'))}>
              <Icon name="return" size={14} />
              طلب إرجاع
            </button>
          ) : null}
          {openDispute ? (
            <Link href={`/account/disputes/${openDispute.id}`} className="btn btn--ghost btn--sm">
              <Icon name="msg" size={14} />
              متابعة النزاع
            </Link>
          ) : disputable ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => (setMode('dispute'), setReason('not_received'))}>
              <Icon name="alert" size={14} />
              لديّ مشكلة
            </button>
          ) : null}
        </div>

        {mode === 'return' ? (
          <div className="sp-panel">
            <p className="sp-panel__title">طلب إرجاع</p>
            <p className="sp-note sp-note--xs">
              <Icon name="info" size={14} />
              اختر القطع وكمياتها. يُردّ نصيبها فور استلام البائع لها — لا يُردّ الشحن في الإرجاع الجزئي.
            </p>
            <div className="sp-panel__lines">
              {s.items.map((i) => (
                <label key={i.id} className="sp-panel__line">
                  <span>{i.productNameSnapshotAr}</span>
                  <select
                    className="field__control"
                    value={qty[i.id] ?? 0}
                    onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })}
                  >
                    {Array.from({ length: i.qty - i.refundedQty + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <ReasonSelect options={RETURN_REASONS} value={reason} onChange={setReason} />
            <TextArea label="تفاصيل" optional value={text} onChange={(e) => setText(e.target.value)} rows={2} />
            <div className="sp-panel__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || !Object.values(qty).some((n) => n > 0)}
                onClick={() => void submitReturn()}
              >
                أرسل طلب الإرجاع
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setMode(null)}>
                تراجع
              </button>
            </div>
          </div>
        ) : null}

        {mode === 'dispute' ? (
          <div className="sp-panel">
            <p className="sp-panel__title">افتح نزاعاً مع {s.vendor.nameAr}</p>
            <ReasonSelect options={DISPUTE_REASONS} value={reason} onChange={setReason} />
            <TextArea label="اشرح المشكلة للبائع" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
            <div className="sp-panel__actions">
              <button type="button" className="btn btn--primary" disabled={busy || text.trim().length < 10} onClick={() => void submitDispute()}>
                افتح النزاع
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setMode(null)}>
                تراجع
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ReasonSelect({ options, value, onChange }: { options: Record<string, string>; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="field__label">السبب</span>
      <select className="field__control" value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
