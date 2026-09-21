'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { Alert, Card, Spinner, TextArea } from '@/components/ui';
import { api, session } from '@/lib/api';
import {
  DISPUTE_REASONS,
  RETURN_REASONS,
  labelOf,
  money,
  toneOf,
  when,
  type SubOrderView,
} from '@/lib/orders';

interface Store extends SubOrderView {
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

  if (!order) {
    return <main className="page">{error ? <Alert tone="danger">{error}</Alert> : <Spinner label="جارٍ فتح طلبك…" />}</main>;
  }

  return (
    <main className="page stack stack--loose">
      <header className="stack stack--tight">
        <Link href="/account/orders" className="small">
          → طلباتي
        </Link>
        <h1 className="num">{order.number}</h1>
        <p className="small muted">
          {when(order.placedAt)} · {order.stores.length === 1 ? 'متجر واحد' : order.stores.length === 2 ? 'متجران' : `${order.stores.length} متاجر`} · الإجمالي{' '}
          <span className="money">{money(order.grandTotalMinorUnits, order.currency)}</span>
        </p>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

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
    </main>
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
    <Card title={s.vendor.nameAr} aside={<span className={`badge ${toneOf(s.status)}`}>{labelOf(s.status)}</span>}>
      <div className="stack">
        {canceled ? (
          <Alert tone="info">
            {labelOf(s.status)}
            {s.cancelReason ? ` — «${s.cancelReason}»` : ''}
            {s.refunds.length ? ` · رُدّ ${s.refunds.filter((r) => r.status === 'succeeded').length ? 'المبلغ' : '— قيد التنفيذ'}` : ''}
          </Alert>
        ) : (
          <ol className="stepper" aria-label="مسار الطلب">
            {TRACK.map((t, i) => (
              <li
                key={t.key}
                className="stepper__item"
                data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}
                {...(i === step ? { 'aria-current': 'step' as const } : {})}
              >
                <span className="stepper__dot" aria-hidden>
                  {i < step ? '✓' : i + 1}
                </span>
                {t.label}
                {i < TRACK.length - 1 ? <span className="stepper__sep" aria-hidden /> : null}
              </li>
            ))}
          </ol>
        )}

        {s.shipment ? (
          <div className="small">
            رقم التتبّع <span className="num">{s.shipment.trackingNumber}</span>
            {s.shipment.events.length ? (
              <ul className="stack stack--tight muted">
                {s.shipment.events.map((e, i) => (
                  <li key={i}>
                    {e.descriptionAr} · {when(e.occurredAt)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <ul className="stack stack--tight">
          {s.items.map((i) => (
            <li key={i.id} className="row row--between">
              <span>
                {i.productNameSnapshotAr}
                {i.variantLabelSnapshot ? <span className="small muted"> · {i.variantLabelSnapshot}</span> : null} ×{' '}
                <span className="num">{i.qty}</span>
                {i.refundedQty ? <span className="small muted"> (أُرجع {i.refundedQty})</span> : null}
              </span>
              <span className="row">
                {s.reviewable && !i.review && i.refundedQty < i.qty ? (
                  <span className="row small" aria-label="قيّم المنتج">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void review(i.id, n)} aria-label={`${n} من 5`}>
                        ★{n}
                      </button>
                    ))}
                  </span>
                ) : i.review ? (
                  <span className="small muted">قيّمته {i.review.rating}/5</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        <div className="row row--between small">
          <span className="muted">حصّة هذا المتجر من دفعتك</span>
          <span className="money">{money(s.chargeTotalMinorUnits, currency)}</span>
        </div>

        {s.refunds.length ? (
          <ul className="small stack stack--tight">
            {s.refunds.map((r) => (
              <li key={r.id}>
                استرداد <span className="money">{money(r.amountMinorUnits, currency)}</span> ({r.reason}) ·{' '}
                {r.status === 'succeeded' ? 'رُدّ إلى وسيلة دفعك' : 'قيد التنفيذ'}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="row">
          {s.actions.includes('canceled_by_customer') ? (
            <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void cancel()}>
              إلغاء هذا المتجر
            </button>
          ) : null}
          {s.returnable ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setMode('return'), setReason('damaged'))}>
              طلب إرجاع
            </button>
          ) : null}
          {openDispute ? (
            <Link href={`/account/disputes/${openDispute.id}`} className="btn btn--ghost btn--sm">
              متابعة النزاع
            </Link>
          ) : disputable ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => (setMode('dispute'), setReason('not_received'))}>
              لديّ مشكلة
            </button>
          ) : null}
        </div>

        {mode === 'return' ? (
          <div className="stack">
            <p className="small muted">اختر القطع وكمياتها. يُردّ نصيبها فور استلام البائع لها — لا يُردّ الشحن في الإرجاع الجزئي.</p>
            {s.items.map((i) => (
              <label key={i.id} className="row row--between">
                <span>{i.productNameSnapshotAr}</span>
                <select
                  className="field__control"
                  style={{ maxWidth: '6rem' }}
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
            <ReasonSelect options={RETURN_REASONS} value={reason} onChange={setReason} />
            <TextArea label="تفاصيل" optional value={text} onChange={(e) => setText(e.target.value)} rows={2} />
            <div className="row">
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
          <div className="stack">
            <ReasonSelect options={DISPUTE_REASONS} value={reason} onChange={setReason} />
            <TextArea label="اشرح المشكلة للبائع" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
            <div className="row">
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
    </Card>
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
