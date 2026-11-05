'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { AskShop } from '@/components/ask-shop';
import { useConfirm } from '@/components/confirm';
import { Icon, type IconName } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { plainAmount, TransferInstructions, type TransferInstructionsView } from '@/components/transfer-instructions';
import { Alert, PageHead, Spinner, TextArea } from '@/components/ui';
import { countryName } from '@/lib/addresses';
import { api, ApiError, session } from '@/lib/api';
import { localized, type Locale, type Translate } from '@/lib/i18n';
import {
  DISPUTE_REASONS,
  DISPUTE_REASONS_EN,
  REFUND_DISPUTE_DAYS,
  REFUND_DISPUTE_REASONS,
  REFUND_DISPUTE_REASONS_EN,
  RETURN_REASONS,
  RETURN_REASONS_EN,
  carrierName,
  labelOf,
  money,
  toneOf,
  SELF_DELIVERY,
  trackingLabel,
  when,
  type OrderItemView,
  type SubOrderView,
} from '@/lib/orders';
import { regionName } from '@/lib/places';
import { imageUrl } from '@/lib/storefront';
import { useReturnTick } from '@/lib/fresh';

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
const PAYMENT_METHODS: Record<string, { label: string; en: string; icon: IconName }> = {
  card: { label: 'بطاقة', en: 'Card', icon: 'card' },
  bank_transfer: { label: 'تحويل بنكي', en: 'Bank transfer', icon: 'cash' },
  wallet: { label: 'محفظة', en: 'Wallet', icon: 'wallet' },
  cod: { label: 'الدفع عند الاستلام', en: 'Cash on delivery', icon: 'cash' },
};

const deliveredTo = (a: DeliveryAddress, locale: Locale): string =>
  [countryName(a.country, locale), a.region ? regionName(a.country, a.region, locale) : null, a.city, a.area, a.street, a.building]
    .filter(Boolean)
    .join(' · ');

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
  { key: 'awaiting_vendor', label: 'استُلم الطلب', en: 'Order received' },
  { key: 'accepted', label: 'قبله البائع', en: 'Accepted by seller' },
  { key: 'preparing', label: 'قيد التجهيز', en: 'Preparing' },
  { key: 'shipped', label: 'تم الشحن', en: 'Shipped' },
  { key: 'delivered', label: 'تم التسليم', en: 'Delivered' },
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
  const t = useT();
  const locale = useLocale();
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

  const returned = useReturnTick();
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
  }, [number, router, returned]);

  const back = (
    <Link href="/account/orders" className="sp-back">
      <Icon name="back" size={16} mirror />
      {t('طلباتي', 'My orders')}
    </Link>
  );

  if (!order) {
    return (
      <div className="sp-page">
        {back}
        {error ? <Alert tone="danger">{error}</Alert> : <Spinner label={t('جارٍ فتح طلبك…', 'Opening your order…')} />}
      </div>
    );
  }

  const storeCount = t(
    order.stores.length === 1 ? 'متجر واحد' : order.stores.length === 2 ? 'متجران' : `${order.stores.length} متاجر`,
    order.stores.length === 1 ? '1 shop' : `${order.stores.length} shops`,
  );
  const unsplit = order.stores.length === 0;
  const method = order.paymentMethod ? PAYMENT_METHODS[order.paymentMethod] : undefined;
  const refunded = refundTotals(order.stores);

  const cancelTransfer = async () => {
    const sure = await ask({
      title: t('تلغي الطلب؟', 'Cancel the order?'),
      body: t('تعود القطع للمتاجر ولا يُؤخذ منك شيء.', "The items go back to the shops and you won't be charged."),
      confirmLabel: t('ألغِ الطلب', 'Cancel order'),
      danger: true,
    });
    if (!sure) return;
    setError(null);
    try {
      await api(`/checkout/orders/${encodeURIComponent(order.number)}/cancel`, { method: 'POST' });
      await load();
      setNotice(t('ألغيت الطلب، وعادت القطع للمتاجر.', 'You canceled the order, and the items went back to the shops.'));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="sp-page">
      {back}
      <PageHead
        title={<span className="num">{order.number}</span>}
        meta={unsplit ? when(order.placedAt, locale) : `${when(order.placedAt, locale)} · ${storeCount}`}
      />
      {/* إلى أين وبماذا دفع — ST-19، أُضيفا بطلب صاحبة المشروع في BUY-011 (27 أكتوبر 2026) */}
      {order.shippingAddress || method ? (
        <dl className="sp-orderinfo">
          {order.shippingAddress ? (
            <div>
              <dt>
                <Icon name="pin" size={15} />
                {t('التوصيل إلى', 'Deliver to')}
              </dt>
              <dd>
                {order.shippingAddress.recipientName ? `${order.shippingAddress.recipientName} — ` : ''}
                {deliveredTo(order.shippingAddress, locale)}
              </dd>
            </div>
          ) : null}
          {method ? (
            <div>
              <dt>
                <Icon name={method.icon} size={15} />
                {t('الدفع', 'Payment')}
              </dt>
              <dd>{t(method.label, method.en)}</dd>
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
              <Alert tone="warning" title={t('بانتظار تحويلك', 'Awaiting your transfer')}>
                {t(
                  'حجزنا القطع لك، ولم نأخذ شيئاً بعد. حين يصلنا التحويل نؤكّده ونرسل طلبك إلى المتاجر، ونبلغك حينها.',
                  "We've reserved the items for you and haven't charged anything yet. Once your transfer arrives, we'll confirm it, send your order to the shops, and let you know.",
                )}
              </Alert>
              <TransferInstructions
                transfer={order.transfer}
                amount={money(order.grandTotalMinorUnits, order.currency, locale)}
                amountMinor={plainAmount(order.grandTotalMinorUnits, order.currency)}
              />
              <div>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void cancelTransfer()}>
                  {t('ألغِ الطلب', 'Cancel order')}
                </button>
              </div>
            </>
          ) : null}
          {order.paymentFailure ? (
            <Alert
              tone="danger"
              title={
                order.paymentFailure.code === 'canceled_by_customer'
                  ? t('ألغيت الطلب', 'You canceled the order')
                  : t('أُلغي الطلب', 'Order canceled')
              }
            >
              {order.paymentFailure.code === 'transfer_expired'
                ? t(
                    'لم يصلنا تحويلك خلال المهلة، فأُلغي الطلب وعادت القطع للمتاجر. إن كنت حوّلت فعلاً فراسلنا بمرجع التحويل لنردّه لك.',
                    "Your transfer didn't reach us in time, so the order was canceled and the items went back to the shops. If you did transfer, message us with the transfer reference and we'll return it to you.",
                  )
                : order.paymentFailure.message || t('لم يُدفع الطلب، ولم يصل إلى المتاجر.', "The order wasn't paid and didn't reach the shops.")}
            </Alert>
          ) : null}
          {unsplit && order.lines?.length ? (
            <section className="card sp-reasons" aria-label={t('ما طلبته', 'What you ordered')}>
              <h2 className="sp-reasons__title">{t('ما طلبته', 'What you ordered')}</h2>
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

        <aside className="sp-detail__aside" aria-label={t('ملخّص الدفع', 'Payment summary')}>
          <div className="sp-sum">
            <h2 className="sp-sum__title">{t('ملخّص الدفع', 'Payment summary')}</h2>
            <dl className="sp-sum__rows">
              <div>
                <dt>{t('قيمة المنتجات', 'Items subtotal')}</dt>
                <dd className="num">{money(order.itemsSubtotalMinorUnits, order.currency, locale)}</dd>
              </div>
              <div>
                <dt>{t('الشحن', 'Shipping')}</dt>
                <dd className="num">{money(order.shippingTotalMinorUnits, order.currency, locale)}</dd>
              </div>
              {order.discountTotalMinorUnits !== '0' ? (
                <div>
                  <dt>
                    {t('الخصم', 'Discount')}
                    {order.couponCode ? <> (<bdi>{order.couponCode}</bdi>)</> : null}
                  </dt>
                  <dd className="num sp-sum__saving">− {money(order.discountTotalMinorUnits, order.currency, locale)}</dd>
                </div>
              ) : null}
              {order.taxTotalMinorUnits && order.taxTotalMinorUnits !== '0' ? (
                <div>
                  <dt>{order.taxInclusive ? t('الضريبة (مشمولة)', 'Tax (included)') : t('الضريبة', 'Tax')}</dt>
                  <dd className="num">{money(order.taxTotalMinorUnits, order.currency, locale)}</dd>
                </div>
              ) : null}
              <div className="sp-sum__total">
                <dt>{t('الإجمالي', 'Total')}</dt>
                <dd className="money num">{money(order.grandTotalMinorUnits, order.currency, locale)}</dd>
              </div>
              {refunded.done > 0n || refunded.pending > 0n ? (
                <>
                  {refunded.done > 0n ? (
                    <div>
                      <dt>{t('المُسترَد', 'Refunded')}</dt>
                      <dd className="num sp-sum__saving">− {money(refunded.done, order.currency, locale)}</dd>
                    </div>
                  ) : null}
                  {refunded.pending > 0n ? (
                    <div>
                      <dt>{t('استرداد قيد التنفيذ', 'Refund in progress')}</dt>
                      <dd className="num">{money(refunded.pending, order.currency, locale)}</dd>
                    </div>
                  ) : null}
                  <div className="sp-sum__total">
                    <dt>{t('صافي ما دفعته', 'Net amount paid')}</dt>
                    <dd className="money num">{money(BigInt(order.grandTotalMinorUnits) - refunded.done, order.currency, locale)}</dd>
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
  const t = useT();
  const locale = useLocale();
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

  /**
   * تاريخ بلوغ كل مرحلة من سجلّ الحالات — المرحلة الأولى تاريخ الطلب نفسه. آخر مرة بلغها لا أولها: طلبٌ
   * تعذّر توصيله ثم أُعيد شحنه اليوم كان «تم الشحن» عنده بتاريخ الشحن الأول (BUY-013، 4 نوفمبر 2026)
   */
  const reachedAt = (key: string, i: number): string | null =>
    i === 0 ? s.placedAt : ([...s.history].reverse().find((h) => h.toStatus === key)?.createdAt ?? null);

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
        title: t(`تلغي ما طلبته من ${s.vendor.nameAr}؟`, `Cancel what you ordered from ${s.vendor.nameAr}?`),
        body: t(
          'يُردّ مبلغه كاملاً إلى وسيلة دفعك، وباقي الطلب يكمل كما هو.',
          'Its full amount is refunded to your payment method, and the rest of the order continues as is.',
        ),
        confirmLabel: t('ألغِ هذا المتجر', 'Cancel this shop'),
        danger: true,
      });
      if (!sure) return;
      const o = await api<OrderView>(`/me/orders/${orderNumber}/stores/${s.id}/cancel`, { method: 'POST', body: {} });
      onChange(
        o,
        t(
          `أُلغي طلبك من ${s.vendor.nameAr} ويُردّ مبلغه إلى وسيلة دفعك.`,
          `Your order from ${s.vendor.nameAr} was canceled, and its amount will be refunded to your payment method.`,
        ),
      );
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
      onChange(
        res.order,
        t(
          'أُرسل طلب الإرجاع للبائع. يُردّ المبلغ فور استلامه القطع.',
          'Your return request was sent to the seller. The amount is refunded as soon as they receive the items.',
        ),
      );
    });

  const submitDispute = () =>
    run(async () => {
      await api(`/me/disputes`, { method: 'POST', body: { subOrderId: s.id, reasonCode: reason, message: text } });
      setMode(null);
      onChange(
        null,
        // نزاع الاسترداد يُفتح مصعَّداً: لا بائع يردّ ولا تصعيد ينتظر
        refundDisputable
          ? t(
              'فُتح النزاع ووصل الإدارة مباشرة — تتابع استردادك وتردّ عليك هنا.',
              "The dispute is open and went straight to admin — they'll follow up on your refund and reply to you here.",
            )
          : t('فُتح النزاع. يردّ البائع هنا، ويمكنك تصعيده للإدارة.', 'The dispute is open. The seller replies here, and you can escalate it to admin.'),
      );
    });

  // الرأي اختياري: النجوم وحدها تكفي (26 أكتوبر 2026)
  const review = (orderItemId: string, rating: number, body: string) =>
    run(async () => {
      await api(`/me/reviews`, { method: 'POST', body: { orderItemId, rating, ...(body.trim() ? { body: body.trim() } : {}) } });
      setDraft(null);
      onChange(null, t('شكراً — نُشرت مراجعتك بشارة «شراء موثّق».', 'Thanks — your review was published with a “Verified purchase” badge.'));
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
        <span className={`badge ${toneOf(s.status)}`}>{labelOf(s.status, locale)}</span>
      </header>

      <div className="sp-store__body">
        {canceled ? (
          <Alert tone="info">
            {labelOf(s.status, locale)}
            {s.cancelReason ? t(` — «${s.cancelReason}»`, ` — “${s.cancelReason}”`) : ''}
            {s.refunds.length
              ? ` · ${
                  s.refunds.every((r) => r.status === 'succeeded')
                    ? t('رُدّ المبلغ', 'Amount refunded')
                    : s.refunds.some((r) => r.status === 'awaiting_transfer')
                      ? t('نحوّل لك المبلغ', "We're transferring the amount to you")
                      : t('الردّ قيد التنفيذ', 'Refund in progress')
                }`
              : ''}
          </Alert>
        ) : (
          <ol className="sp-track" aria-label={t('مسار الطلب', 'Order progress')}>
            {TRACK.map((stage, i) => {
              // آخر المسار إن بُلغ فقد تمّ — «تم التسليم» بساعة الانتظار يُقرأ «لم يُسلَّم بعد»
              const last = i === TRACK.length - 1;
              const state = i < step || (last && i === step) ? 'done' : i === step ? 'current' : 'todo';
              const at = i <= step ? reachedAt(stage.key, i) : null;
              return (
                <li
                  key={stage.key}
                  className="sp-track__step"
                  data-state={state}
                  {...(i === step ? { 'aria-current': 'step' as const } : {})}
                >
                  <span className="sp-track__dot" aria-hidden>
                    <Icon name={state === 'done' ? 'check' : state === 'current' ? 'clock' : 'minus'} size={15} />
                  </span>
                  <span className="sp-track__label">{t(stage.label, stage.en)}</span>
                  <span className="sp-track__date">{at ? when(at, locale) : '—'}</span>
                </li>
              );
            })}
          </ol>
        )}

        {s.shipment ? (
          <div className="sp-ship">
            <p className="sp-ship__head">
              <Icon name="truck" size={17} />
              {trackingLabel(s.shipment.carrierCode, locale)} <span className="sp-ship__no num">{s.shipment.trackingNumber}</span>
              <span className="sp-ship__carrier">{carrierName(s.shipment.carrierCode, locale)}</span>
              {/* صفحة التتبّع العامة بالرقم جاهزاً — يُنسخ رابطها ويُرسل (BUY-092) */}
              {s.shipment.carrierCode !== SELF_DELIVERY ? (
                <Link className="sp-ship__track" href={`/track?number=${encodeURIComponent(s.shipment.trackingNumber)}`}>
                  {t('تتبّع الشحنة', 'Track shipment')}
                </Link>
              ) : null}
            </p>
            {s.shipment.events.length ? (
              <ul className="sp-events">
                {s.shipment.events.map((e, i) => (
                  <li key={i}>
                    <span>
                      {e.descriptionAr}
                      {e.location ? ` · ${e.location}` : ''}
                    </span>
                    <span className="sp-events__when">{when(e.occurredAt, locale)}</span>
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
            const refundNote = [
              returned ? t(`أُرجع ${returned}`, `${returned} returned`) : '',
              i.refundedQty > returned ? t(`أُلغي ${i.refundedQty - returned}`, `${i.refundedQty - returned} canceled`) : '',
            ]
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
                  <span className="money num">{money(i.chargeSubtotalMinorUnits, currency, locale)}</span>
                  {s.currency !== currency ? (
                    <span className="sp-items__store">
                      <span className="num">{money(i.lineSubtotalMinorUnits, s.currency, locale)}</span>{' '}
                      {t('بعملة المتجر', 'in shop currency')}
                    </span>
                  ) : null}
                </span>

                {s.reviewable && !i.review && i.refundedQty < i.qty ? (
                  <>
                    {/* النجمة تختار ولا تنشر: يكتب رأيه إن شاء ثم «انشر التقييم» */}
                    <span className="sp-rate" role="group" aria-label={t('قيّم المنتج', 'Rate the product')}>
                      <span className="sp-rate__label" aria-hidden>
                        {t('قيّم المنتج', 'Rate the product')}
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
                            aria-label={t(`${n} من 5`, `${n} of 5`)}
                          >
                            <Icon name={on ? 'star-fill' : 'star'} size={18} />
                          </button>
                        );
                      })}
                    </span>
                    {draft?.itemId === i.id ? (
                      <div className="sp-rate__form">
                        <TextArea
                          label={t('رأيك', 'Your review')}
                          optional
                          rows={2}
                          maxLength={2000}
                          placeholder={t('مثلاً: القماش ناعم والمقاس مظبوط', 'For example: the fabric is soft and the size is right')}
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
                            {t('انشر التقييم', 'Publish review')}
                          </button>
                          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setDraft(null)}>
                            {t('تراجع', 'Cancel')}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : rating !== null ? (
                  <span className="sp-rated" role="img" aria-label={t(`قيّمته ${rating}/5`, `You rated it ${rating}/5`)}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Icon key={n} name={n <= rating ? 'star-fill' : 'star'} size={14} />
                    ))}
                    <span className="sp-rated__text" aria-hidden>
                      {t(`قيّمته ${rating}/5`, `You rated it ${rating}/5`)}
                    </span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {/* رفض البائع آخر إرجاع: الرفض وسببه هنا — كانت الشارة ترجع «تم التسليم» بلا تفسير (BUY-047) */}
        {lastReturn?.status === 'rejected' ? (
          <Alert
            tone="warning"
            title={t(
              `رفض المتجر طلب الإرجاع${lastReturn.resolvedAt ? ` · ${when(lastReturn.resolvedAt)}` : ''}`,
              `The shop rejected the return request${lastReturn.resolvedAt ? ` · ${when(lastReturn.resolvedAt, locale)}` : ''}`,
            )}
          >
            {lastReturn.resolutionNote ? t(`السبب: «${lastReturn.resolutionNote}». `, `Reason: “${lastReturn.resolutionNote}”. `) : ''}
            {t('إن لم توافق على الرفض، افتح «لديّ مشكلة».', "If you don't agree with the rejection, open “I have a problem”.")}
          </Alert>
        ) : null}
      </div>

      <div className="sp-store__foot">
        <p className="sp-kv">
          <span>{t('حصّة هذا المتجر من دفعتك', "This shop's share of your payment")}</span>
          <span className="sp-kv__v money num">{money(s.chargeTotalMinorUnits, currency, locale)}</span>
        </p>
        {s.currency !== currency ? (
          <p className="sp-transfer__hint">
            {t(
              'المبالغ بعملة دفعتك بسعر الصرف لحظة الطلب، وسعر المتجر بعملته تحت قطعته؛ الضريبة والشحن في ملخّص الدفع.',
              "Amounts are in your payment currency at the exchange rate when you ordered, with the shop's own-currency price under each item; tax and shipping are in the payment summary.",
            )}
          </p>
        ) : null}

        {s.refunds.length ? (
          <ul className="sp-refunds">
            {s.refunds.map((r) => (
              <li key={r.id}>
                {t('استرداد', 'Refund')} <span className="money num">{money(r.amountMinorUnits, currency, locale)}</span> ({r.reason}) ·{' '}
                {refundState(r, t)}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="sp-store__actions">
          {s.actions.includes('canceled_by_customer') ? (
            <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void cancel()}>
              <Icon name="x" size={14} />
              {t('إلغاء هذا المتجر', 'Cancel this shop')}
            </button>
          ) : null}
          {s.returnable ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setMode('return'), setReason('damaged'))}>
              <Icon name="return" size={14} />
              {t('طلب إرجاع', 'Request a return')}
            </button>
          ) : null}
          {openDispute ? (
            <Link href={`/account/disputes/${openDispute.id}`} className="btn btn--ghost btn--sm">
              <Icon name="msg" size={14} />
              {t('متابعة النزاع', 'View dispute')}
            </Link>
          ) : disputable || refundDisputable ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => (setMode('dispute'), setReason(refundDisputable ? 'refund_missing' : 'not_received'))}>
              <Icon name="alert" size={14} />
              {t('لديّ مشكلة', 'I have a problem')}
            </button>
          ) : null}
          {/* رسالة إلى المتجر عن شحنته من هذا الطلب — تُكمل المحادثة نفسها إن وُجدت */}
          <AskShop
            context={{ orderNumber: s.number }}
            shopName={s.vendor.nameAr}
            subjectName={s.vendor.nameAr}
            subjectSub={t(`طلب ${s.number}`, `Order ${s.number}`)}
            triggerLabel={t('راسل المتجر', 'Message the shop')}
            triggerClassName="btn btn--ghost btn--sm"
            title={t('راسل المتجر', 'Message the shop')}
            fieldLabel={t('رسالتك', 'Your message')}
            iconSize={14}
            placeholder={t('اكتب رسالتك للمتجر عن هذا الطلب…', 'Write your message to the shop about this order…')}
          />
        </div>

        {mode === 'return' ? (
          <div className="sp-panel">
            <p className="sp-panel__title">{t('طلب إرجاع', 'Request a return')}</p>
            <p className="sp-note sp-note--xs">
              <Icon name="info" size={14} />
              {/* الشحن لا يُردّ في أي إرجاع، كاملاً كان أو جزئياً — «الجزئي» كان يوحي بردّه في الكامل (BUY-040) */}
              {t(
                'اختر القطع وكمياتها. يُردّ ثمنها فور استلام البائع لها — الشحن لا يُردّ لأن الشحنة وصلتك.',
                "Choose the items and quantities. Their price is refunded as soon as the seller receives them — shipping isn't refunded because the shipment reached you.",
              )}
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
            <ReasonSelect options={localized(locale, RETURN_REASONS, RETURN_REASONS_EN)} value={reason} onChange={setReason} />
            <TextArea label={t('تفاصيل', 'Details')} optional value={text} onChange={(e) => setText(e.target.value)} rows={2} />
            <div className="sp-panel__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || !Object.values(qty).some((n) => n > 0)}
                onClick={() => void submitReturn()}
              >
                {t('أرسل طلب الإرجاع', 'Send return request')}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setMode(null)}>
                {t('تراجع', 'Cancel')}
              </button>
            </div>
          </div>
        ) : null}

        {mode === 'dispute' ? (
          <div className="sp-panel">
            <p className="sp-panel__title">
              {refundDisputable
                ? t('لم يصلك المبلغ المسترَد؟', "Didn't receive your refund?")
                : t(`افتح نزاعاً مع ${s.vendor.nameAr}`, `Open a dispute with ${s.vendor.nameAr}`)}
            </p>
            {refundDisputable ? (
              <p className="sp-note sp-note--xs">
                <Icon name="info" size={14} />
                {t(
                  'يصل الإدارة مباشرة: هي التي ترى ردّ المبلغ عند جهة الدفع وتتابعه معك.',
                  'This goes straight to admin: they can see the refund at the payment provider and follow it up with you.',
                )}
              </p>
            ) : null}
            <ReasonSelect
              options={
                refundDisputable
                  ? localized(locale, REFUND_DISPUTE_REASONS, REFUND_DISPUTE_REASONS_EN)
                  : localized(locale, DISPUTE_REASONS, DISPUTE_REASONS_EN)
              }
              value={reason}
              onChange={setReason}
            />
            <TextArea
              label={
                refundDisputable
                  ? t('اشرح للإدارة: متى رُدّ المبلغ، وأين تنتظره', 'Explain to admin: when the amount was refunded, and where you expect it')
                  : t('اشرح المشكلة للبائع', 'Explain the problem to the seller')
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
            />
            <div className="sp-panel__actions">
              <button type="button" className="btn btn--primary" disabled={busy || text.trim().length < 10} onClick={() => void submitDispute()}>
                {t('افتح النزاع', 'Open dispute')}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setMode(null)}>
                {t('تراجع', 'Cancel')}
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
function refundState(r: { status: string; transferReference?: string | null }, t: Translate) {
  if (r.status === 'succeeded') {
    return r.transferReference ? (
      <>
        {t('حوّلناه لك — مرجع التحويل', 'We transferred it to you — transfer reference')}{' '}
        <bdi className="num" dir="ltr">
          {r.transferReference}
        </bdi>
      </>
    ) : (
      t('رُدّ إلى وسيلة دفعك', 'Refunded to your payment method')
    );
  }
  if (r.status === 'awaiting_transfer')
    return t(
      'نحوّله لحسابك — نبلغك بمرجع التحويل حين يخرج',
      "We're transferring it to your account — we'll send you the transfer reference when it goes out",
    );
  return t('قيد التنفيذ', 'In progress');
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
  const t = useT();
  return (
    <label className="field">
      <span className="field__label">{t('السبب', 'Reason')}</span>
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
