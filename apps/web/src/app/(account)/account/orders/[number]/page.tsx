'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { AskShop } from '@/components/ask-shop';
import { useConfirm } from '@/components/confirm';
import { Icon, type IconName } from '@/components/icons';
import { plainAmount, TransferInstructions, type TransferInstructionsView } from '@/components/transfer-instructions';
import { Alert, PageHead, Spinner, TextArea } from '@/components/ui';
import { countryName } from '@/lib/addresses';
import { api, ApiError, session } from '@/lib/api';
import {
  DISPUTE_REASONS,
  REFUND_DISPUTE_DAYS,
  REFUND_DISPUTE_REASONS,
  RETURN_REASONS,
  carrierName,
  labelOf,
  money,
  toneOf,
  trackingLabel,
  when,
  type OrderItemView,
  type SubOrderView,
} from '@/lib/orders';
import { imageUrl } from '@/lib/storefront';

interface Item extends OrderItemView {
  imageKeySnapshot?: string | null;
  /** السطر بعملة الدفع قبل الضريبة والخصم — جزء «قيمة المنتجات» في الملخّص */
  chargeSubtotalMinorUnits: string;
}

interface Store extends Omit<SubOrderView, 'items'> {
  items: Item[];
  chargeTotalMinorUnits: string;
  returnable: boolean;
  reviewable: boolean;
}

interface DeliveryAddress {
  recipientName?: string | null;
  country: string;
  region?: string | null;
  city?: string | null;
  area?: string | null;
  street?: string | null;
  building?: string | null;
}

/** وسيلة الدفع بالعربية وأيقونتها — رأس الطلب (ST-19) */
const PAYMENT_METHODS: Record<string, { label: string; icon: IconName }> = {
  card: { label: 'بطاقة', icon: 'card' },
  bank_transfer: { label: 'تحويل بنكي', icon: 'cash' },
  wallet: { label: 'محفظة', icon: 'wallet' },
  cod: { label: 'الدفع عند الاستلام', icon: 'cash' },
};

const deliveredTo = (a: DeliveryAddress): string =>
  [countryName(a.country), a.region, a.city, a.area, a.street, a.building].filter(Boolean).join(' · ');

interface OrderView {
  number: string;
  status: string;
  currency: string;
  placedAt: string;
  grandTotalMinorUnits: string;
  itemsSubtotalMinorUnits: string;
  shippingTotalMinorUnits: string;
  discountTotalMinorUnits: string;
  couponCode?: string | null;
  taxTotalMinorUnits?: string;
  taxInclusive?: boolean;
  paymentStatus: string | null;
  paymentMethod?: string | null;
  /** لقطة العنوان لحظة الطلب — لا العنوان المحفوظ اليوم */
  shippingAddress?: DeliveryAddress | null;
  /** ينتظر التحويل: كيف يحوّل — قبل أن يُقسَّم الطلب على المتاجر */
  transfer?: TransferInstructionsView;
  /** أُغلق قبل أن يُدفع (انقضت مهلة التحويل أو ألغاه) */
  paymentFailure?: { code: string; message: string };
  /** أسطر الطلب من لقطته — حين لا متاجر بعد */
  lines?: { store: string | null; name: string; variantLabel: string | null; qty: number; imageKey: string | null }[];
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
  const ask = useConfirm();
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

  /**
   * إجراء رُفض: التنبيه يبقى، وإن كان الرفض لأن الحالة تغيّرت من طرف آخر (409) تُجلب
   * الحالة الجديدة فلا يبقى زرّ لم يعد مسموحاً تحت التنبيه — BUY-027 (27 أكتوبر 2026)
   */
  const fail = useCallback(
    (e: unknown) => {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) void load();
    },
    [load],
  );

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
  const unsplit = order.stores.length === 0;
  const method = order.paymentMethod ? PAYMENT_METHODS[order.paymentMethod] : undefined;
  const refunded = refundTotals(order.stores);

  const cancelTransfer = async () => {
    const sure = await ask({
      title: 'تلغي الطلب؟',
      body: 'تعود القطع للمتاجر ولا يُؤخذ منك شيء.',
      confirmLabel: 'ألغِ الطلب',
      danger: true,
    });
    if (!sure) return;
    setError(null);
    try {
      await api(`/checkout/orders/${encodeURIComponent(order.number)}/cancel`, { method: 'POST' });
      await load();
      setNotice('ألغيت الطلب، وعادت القطع للمتاجر.');
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="sp-page">
      {back}
      <PageHead
        title={<span className="num">{order.number}</span>}
        meta={unsplit ? when(order.placedAt) : `${when(order.placedAt)} · ${storeCount}`}
      />
      {/* إلى أين وبماذا دفع — ST-19، أُضيفا بطلب صاحبة المشروع في BUY-011 (27 أكتوبر 2026) */}
      {order.shippingAddress || method ? (
        <dl className="sp-orderinfo">
          {order.shippingAddress ? (
            <div>
              <dt>
                <Icon name="pin" size={15} />
                التوصيل إلى
              </dt>
              <dd>
                {order.shippingAddress.recipientName ? `${order.shippingAddress.recipientName} — ` : ''}
                {deliveredTo(order.shippingAddress)}
              </dd>
            </div>
          ) : null}
          {method ? (
            <div>
              <dt>
                <Icon name={method.icon} size={15} />
                الدفع
              </dt>
              <dd>{method.label}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="sp-detail">
        <div className="sp-detail__main">
          {order.transfer ? (
            <>
              <Alert tone="warning" title="بانتظار تحويلك">
                حجزنا القطع لك، ولم نأخذ شيئاً بعد. حين يصلنا التحويل نؤكّده ونرسل طلبك إلى المتاجر، ونبلغك حينها.
              </Alert>
              <TransferInstructions
                transfer={order.transfer}
                amount={money(order.grandTotalMinorUnits, order.currency)}
                amountMinor={plainAmount(order.grandTotalMinorUnits, order.currency)}
              />
              <div>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void cancelTransfer()}>
                  ألغِ الطلب
                </button>
              </div>
            </>
          ) : null}
          {order.paymentFailure ? (
            <Alert tone="danger" title={order.paymentFailure.code === 'canceled_by_customer' ? 'ألغيت الطلب' : 'أُلغي الطلب'}>
              {order.paymentFailure.code === 'transfer_expired'
                ? 'لم يصلنا تحويلك خلال المهلة، فأُلغي الطلب وعادت القطع للمتاجر. إن كنت حوّلت فعلاً فراسلنا بمرجع التحويل لنردّه لك.'
                : order.paymentFailure.message || 'لم يُدفع الطلب، ولم يصل إلى المتاجر.'}
            </Alert>
          ) : null}
          {unsplit && order.lines?.length ? (
            <section className="card sp-reasons" aria-label="ما طلبته">
              <h2 className="sp-reasons__title">ما طلبته</h2>
              <ul>
                {order.lines.map((l, i) => (
                  <li key={i}>
                    <Icon name="package" size={15} />
                    <span>
                      {l.name}
                      {l.variantLabel ? ` — ${l.variantLabel}` : ''} <span className="num">× {l.qty}</span>
                      {l.store ? <span className="sp-transfer__hint"> · {l.store}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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
              onError={fail}
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
                  <dt>
                    الخصم{order.couponCode ? <> (<bdi>{order.couponCode}</bdi>)</> : null}
                  </dt>
                  <dd className="num sp-sum__saving">− {money(order.discountTotalMinorUnits, order.currency)}</dd>
                </div>
              ) : null}
              {order.taxTotalMinorUnits && order.taxTotalMinorUnits !== '0' ? (
                <div>
                  <dt>{order.taxInclusive ? 'الضريبة (مشمولة)' : 'الضريبة'}</dt>
                  <dd className="num">{money(order.taxTotalMinorUnits, order.currency)}</dd>
                </div>
              ) : null}
              <div className="sp-sum__total">
                <dt>الإجمالي</dt>
                <dd className="money num">{money(order.grandTotalMinorUnits, order.currency)}</dd>
              </div>
              {refunded.done > 0n || refunded.pending > 0n ? (
                <>
                  {refunded.done > 0n ? (
                    <div>
                      <dt>المُسترَد</dt>
                      <dd className="num sp-sum__saving">− {money(refunded.done, order.currency)}</dd>
                    </div>
                  ) : null}
                  {refunded.pending > 0n ? (
                    <div>
                      <dt>استرداد قيد التنفيذ</dt>
                      <dd className="num">{money(refunded.pending, order.currency)}</dd>
                    </div>
                  ) : null}
                  <div className="sp-sum__total">
                    <dt>صافي ما دفعته</dt>
                    <dd className="money num">{money(BigInt(order.grandTotalMinorUnits) - refunded.done, order.currency)}</dd>
                  </div>
                </>
              ) : null}
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
  onError: (e: unknown) => void;
}) {
  const ask = useConfirm();
  const [mode, setMode] = useState<'return' | 'dispute' | null>(null);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('damaged');
  const [text, setText] = useState('');
  // لحظة فتح الصفحة: الحساب أثناء الرسم يتغيّر مع كل إعادة رسم
  const [now] = useState(() => Date.now());
  /** النجوم المختارة والرأي قبل النشر — لقطعة واحدة في كل مرة */
  const [draft, setDraft] = useState<{ itemId: string; rating: number; body: string } | null>(null);
  const canceled = ['rejected_by_vendor', 'canceled_by_customer', 'canceled_by_admin', 'refunded'].includes(s.status);
  const step = ORDER_OF[s.status] ?? -1;
  const openDispute = s.disputes.find((d) => d.status === 'open' || d.status === 'escalated');
  // «مُسترَد»: نزاع «لم يصلني الاسترداد» وحده خلال 14 يوماً منه، ويصل الإدارة — قرار صاحبة المشروع (BUY-052)
  const refundedAt = s.status === 'refunded' ? s.history.find((h) => h.toStatus === 'refunded')?.createdAt : undefined;
  const refundDisputable = !!refundedAt && now - new Date(refundedAt).getTime() <= REFUND_DISPUTE_DAYS * 86_400_000;
  const disputable = ['shipped', 'delivery_failed', 'delivered', 'return_requested', 'returned'].includes(s.status);
  // الأحدث أولاً من الخادم: رفضٌ يبقى ظاهراً حتى يُطلب إرجاع بعده
  const lastReturn = s.returns[0];

  /** تاريخ بلوغ كل مرحلة من سجلّ الحالات — المرحلة الأولى تاريخ الطلب نفسه */
  const reachedAt = (key: string, i: number): string | null =>
    i === 0 ? s.placedAt : (s.history.find((h) => h.toStatus === key)?.createdAt ?? null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () =>
    run(async () => {
      const sure = await ask({
        title: `تلغي ما طلبته من ${s.vendor.nameAr}؟`,
        body: 'يُردّ مبلغه كاملاً إلى وسيلة دفعك، وباقي الطلب يكمل كما هو.',
        confirmLabel: 'ألغِ هذا المتجر',
        danger: true,
      });
      if (!sure) return;
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
      onChange(
        null,
        // نزاع الاسترداد يُفتح مصعَّداً: لا بائع يردّ ولا تصعيد ينتظر
        refundDisputable
          ? 'فُتح النزاع ووصل الإدارة مباشرة — تتابع استردادك وتردّ عليك هنا.'
          : 'فُتح النزاع. يردّ البائع هنا، ويمكنك تصعيده للإدارة.',
      );
    });

  // الرأي اختياري: النجوم وحدها تكفي (26 أكتوبر 2026)
  const review = (orderItemId: string, rating: number, body: string) =>
    run(async () => {
      await api(`/me/reviews`, { method: 'POST', body: { orderItemId, rating, ...(body.trim() ? { body: body.trim() } : {}) } });
      setDraft(null);
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
            {s.refunds.length
              ? ` · ${
                  s.refunds.every((r) => r.status === 'succeeded')
                    ? 'رُدّ المبلغ'
                    : s.refunds.some((r) => r.status === 'awaiting_transfer')
                      ? 'نحوّل لك المبلغ'
                      : 'الردّ قيد التنفيذ'
                }`
              : ''}
          </Alert>
        ) : (
          <ol className="sp-track" aria-label="مسار الطلب">
            {TRACK.map((t, i) => {
              // آخر المسار إن بُلغ فقد تمّ — «تم التسليم» بساعة الانتظار يُقرأ «لم يُسلَّم بعد»
              const last = i === TRACK.length - 1;
              const state = i < step || (last && i === step) ? 'done' : i === step ? 'current' : 'todo';
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
              {trackingLabel(s.shipment.carrierCode)} <span className="sp-ship__no num">{s.shipment.trackingNumber}</span>
              <span className="sp-ship__carrier">{carrierName(s.shipment.carrierCode)}</span>
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
            // المسترَدّ نوعان: قطع عادت بإرجاع، وقطع أُلغيت (رفض المتجر أو إلغاء) — «أُرجع» للأولى وحدها
            const returned = Math.min(i.refundedQty, returnedQtyOf(s, i.id));
            const refundNote = [returned ? `أُرجع ${returned}` : '', i.refundedQty > returned ? `أُلغي ${i.refundedQty - returned}` : '']
              .filter(Boolean)
              .join(' · ');
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
                  {i.variantLabelSnapshot || refundNote ? (
                    <span className="sp-items__sub">
                      {i.variantLabelSnapshot}
                      {i.variantLabelSnapshot && refundNote ? ' · ' : ''}
                      {refundNote}
                    </span>
                  ) : null}
                </span>
                <span className="sp-items__qty num">× {i.qty}</span>
                {/*
                 * بعملة الدفع وقبل الضريبة، كما في «قيمة المنتجات» — فأسطر الطلب تجمع الملخّص.
                 * كان بعملة المتجر شاملاً الضريبة (23.00 ر.س) والملخّص بالدينار بلاها، فلا يُقارَنان.
                 */}
                <span className="sp-items__total">
                  <span className="money num">{money(i.chargeSubtotalMinorUnits, currency)}</span>
                  {s.currency !== currency ? (
                    <span className="sp-items__store">
                      <span className="num">{money(i.lineSubtotalMinorUnits, s.currency)}</span> بعملة المتجر
                    </span>
                  ) : null}
                </span>

                {s.reviewable && !i.review && i.refundedQty < i.qty ? (
                  <>
                    {/* النجمة تختار ولا تنشر: يكتب رأيه إن شاء ثم «انشر التقييم» */}
                    <span className="sp-rate" role="group" aria-label="قيّم المنتج">
                      <span className="sp-rate__label" aria-hidden>
                        قيّم المنتج
                      </span>
                      {[1, 2, 3, 4, 5].map((n) => {
                        const on = draft?.itemId === i.id && n <= draft.rating;
                        return (
                          <button
                            key={n}
                            type="button"
                            className={`sp-rate__star${on ? ' sp-rate__star--on' : ''}`}
                            disabled={busy}
                            aria-pressed={draft?.itemId === i.id && draft.rating === n}
                            onClick={() => setDraft({ itemId: i.id, rating: n, body: draft?.itemId === i.id ? draft.body : '' })}
                            aria-label={`${n} من 5`}
                          >
                            <Icon name={on ? 'star-fill' : 'star'} size={18} />
                          </button>
                        );
                      })}
                    </span>
                    {draft?.itemId === i.id ? (
                      <div className="sp-rate__form">
                        <TextArea
                          label="رأيك"
                          optional
                          rows={2}
                          maxLength={2000}
                          placeholder="مثلاً: القماش ناعم والمقاس مظبوط"
                          value={draft.body}
                          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        />
                        <div className="sp-panel__actions">
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={busy}
                            onClick={() => void review(i.id, draft.rating, draft.body)}
                          >
                            انشر التقييم
                          </button>
                          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setDraft(null)}>
                            تراجع
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
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
        {/* رفض البائع آخر إرجاع: الرفض وسببه هنا — كانت الشارة ترجع «تم التسليم» بلا تفسير (BUY-047) */}
        {lastReturn?.status === 'rejected' ? (
          <Alert tone="warning" title={`رفض المتجر طلب الإرجاع${lastReturn.resolvedAt ? ` · ${when(lastReturn.resolvedAt)}` : ''}`}>
            {lastReturn.resolutionNote ? `السبب: «${lastReturn.resolutionNote}». ` : ''}
            إن لم توافق على الرفض، افتح «لديّ مشكلة».
          </Alert>
        ) : null}
      </div>

      <div className="sp-store__foot">
        <p className="sp-kv">
          <span>حصّة هذا المتجر من دفعتك</span>
          <span className="sp-kv__v money num">{money(s.chargeTotalMinorUnits, currency)}</span>
        </p>
        {s.currency !== currency ? (
          <p className="sp-transfer__hint">
            المبالغ بعملة دفعتك بسعر الصرف لحظة الطلب، وسعر المتجر بعملته تحت قطعته؛ الضريبة والشحن في ملخّص الدفع.
          </p>
        ) : null}

        {s.refunds.length ? (
          <ul className="sp-refunds">
            {s.refunds.map((r) => (
              <li key={r.id}>
                استرداد <span className="money num">{money(r.amountMinorUnits, currency)}</span> ({r.reason}) ·{' '}
                {refundState(r)}
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
          ) : disputable || refundDisputable ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => (setMode('dispute'), setReason(refundDisputable ? 'refund_missing' : 'not_received'))}>
              <Icon name="alert" size={14} />
              لديّ مشكلة
            </button>
          ) : null}
          {/* رسالة إلى المتجر عن شحنته من هذا الطلب — تُكمل المحادثة نفسها إن وُجدت */}
          <AskShop
            context={{ orderNumber: s.number }}
            shopName={s.vendor.nameAr}
            subjectName={s.vendor.nameAr}
            subjectSub={`طلب ${s.number}`}
            triggerLabel="راسل المتجر"
            triggerClassName="btn btn--ghost btn--sm"
            title="راسل المتجر"
            fieldLabel="رسالتك"
            iconSize={14}
            placeholder="اكتب رسالتك للمتجر عن هذا الطلب…"
          />
        </div>

        {mode === 'return' ? (
          <div className="sp-panel">
            <p className="sp-panel__title">طلب إرجاع</p>
            <p className="sp-note sp-note--xs">
              <Icon name="info" size={14} />
              {/* الشحن لا يُردّ في أي إرجاع، كاملاً كان أو جزئياً — «الجزئي» كان يوحي بردّه في الكامل (BUY-040) */}
              اختر القطع وكمياتها. يُردّ ثمنها فور استلام البائع لها — الشحن لا يُردّ لأن الشحنة وصلتك.
            </p>
            <div className="sp-panel__lines">
              {/* بعد إرجاع جزئي يبقى الطلب «تم التسليم»: ما رُدّ كله لا يُعرض بقائمة «0» وحدها */}
              {s.items.filter((i) => i.refundedQty < i.qty).map((i) => (
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
            <p className="sp-panel__title">{refundDisputable ? 'لم يصلك المبلغ المسترَد؟' : `افتح نزاعاً مع ${s.vendor.nameAr}`}</p>
            {refundDisputable ? (
              <p className="sp-note sp-note--xs">
                <Icon name="info" size={14} />
                يصل الإدارة مباشرة: هي التي ترى ردّ المبلغ عند جهة الدفع وتتابعه معك.
              </p>
            ) : null}
            <ReasonSelect options={refundDisputable ? REFUND_DISPUTE_REASONS : DISPUTE_REASONS} value={reason} onChange={setReason} />
            <TextArea
              label={refundDisputable ? 'اشرح للإدارة: متى رُدّ المبلغ، وأين تنتظره' : 'اشرح المشكلة للبائع'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
            />
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

/**
 * حال الردّ كما يقرؤه المشتري. «رُدّ» بعد أن يخرج المال وحده: من البوابة، أو بتحويل
 * سجّلت الإدارة مرجعه — وذلك المرجع يُعرض ليتتبّع ماله في بنكه.
 */
function refundState(r: { status: string; transferReference?: string | null }) {
  if (r.status === 'succeeded') {
    return r.transferReference ? (
      <>
        حوّلناه لك — مرجع التحويل{' '}
        <bdi className="num" dir="ltr">
          {r.transferReference}
        </bdi>
      </>
    ) : (
      'رُدّ إلى وسيلة دفعك'
    );
  }
  if (r.status === 'awaiting_transfer') return 'نحوّله لحسابك — نبلغك بمرجع التحويل حين يخرج';
  return 'قيد التنفيذ';
}

/** القطع التي عادت من هذا السطر بإرجاع لم يُرفض — ما زاد عليها من المسترَدّ أُلغي ولم يُرجَع */
function returnedQtyOf(s: Store, orderItemId: string): number {
  return s.returns
    .filter((r) => r.status !== 'rejected')
    .flatMap((r) => r.itemsJson)
    .filter((l) => l.orderItemId === orderItemId)
    .reduce((n, l) => n + l.qty, 0);
}

/** مجموع الاستردادات على الطلب كله بعملة الدفع: ما رُدّ فعلاً، وما زال في الطريق */
function refundTotals(stores: Store[]): { done: bigint; pending: bigint } {
  let done = 0n;
  let pending = 0n;
  for (const r of stores.flatMap((s) => s.refunds)) {
    if (r.status === 'succeeded') done += BigInt(r.amountMinorUnits);
    else if (r.status !== 'failed') pending += BigInt(r.amountMinorUnits);
  }
  return { done, pending };
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
