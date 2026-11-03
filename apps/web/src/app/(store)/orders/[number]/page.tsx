'use client';

import Link from 'next/link';
import { use, useEffect, useState, useSyncExternalStore } from 'react';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { plainAmount, TransferInstructions, type TransferInstructionsView } from '@/components/transfer-instructions';
import { Alert, Spinner } from '@/components/ui';
import { api, session } from '@/lib/api';
import { pick, type Bilingual, type Locale } from '@/lib/i18n';
import { orderKeyHeaders } from '@/lib/order-key';
import { useReturnTick } from '@/lib/fresh';

interface OrderResult {
  orderNumber: string;
  outcome: 'paid' | 'failed' | 'requires_action' | 'awaiting_transfer' | 'pending';
  total: { minorUnits: string; currency: string };
  subOrderCount: number;
  failure?: { code: string; message: string };
  transfer?: TransferInstructionsView;
  coupon?: { code: string; discount: { minorUnits: string; currency: string } };
}

/** طلب تحويل أُغلق قبل أن يُدفع — لا «جرّب بطاقة أخرى» لمن لم يستعمل بطاقة */
const TRANSFER_FAILURES: Record<string, { title: Bilingual; text: Bilingual }> = {
  transfer_expired: {
    title: { ar: 'أُلغي الطلب — لم يصل التحويل', en: "Order canceled — the transfer didn't arrive" },
    text: {
      ar: 'لم يصلنا تحويلك خلال المهلة، فأُلغي الطلب وعادت القطع للمتاجر. إن كنت حوّلت فعلاً فراسلنا بمرجع التحويل لنردّه لك، أو اطلب من جديد.',
      en: "Your transfer didn't reach us within the time limit, so the order was canceled and the items went back to the shops. If you did transfer, message us with the transfer reference so we can return it to you, or order again.",
    },
  },
  canceled_by_customer: {
    title: { ar: 'ألغيت الطلب', en: 'You canceled the order' },
    text: {
      ar: 'ألغيت الطلب قبل التحويل، فلم نأخذ شيئاً وعادت القطع للمتاجر.',
      en: 'You canceled the order before transferring, so we took nothing and the items went back to the shops.',
    },
  },
};

const format = (minor: string, currency: string, locale: Locale): string => {
  const digits = ['JOD', 'KWD', 'BHD', 'OMR'].includes(currency) ? 3 : 2;
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'ar-JO-u-nu-latn', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(minor) / 10 ** digits);
};

/** تمييز العدد بالعربية يتغيّر بالعدد نفسه: «2 متاجر» خطأ، والصواب «متجرين» */
function stores(n: number, locale: Locale): string {
  if (locale === 'en') return n === 1 ? 'the seller' : `${n} shops`;
  if (n === 1) return 'البائع';
  if (n === 2) return 'متجرين';
  if (n <= 10) return `${n} متاجر`;
  return `${n} متجراً`;
}

/** أسباب الرفض الشائعة — نصائح عامة للمشتري لا بيانات من البوابة */
const FAIL_TIPS: Bilingual[] = [
  { ar: 'رصيد غير كافٍ أو حدّ شرائي يومي على البطاقة.', en: 'Insufficient balance or a daily spending limit on the card.' },
  {
    ar: 'البطاقة غير مُفعّلة للشراء عبر الإنترنت — فعّلها من تطبيق بنكك.',
    en: "The card isn't enabled for online purchases — enable it from your banking app.",
  },
  {
    ar: 'بيانات البطاقة غير مطابقة: تحقّق من الرقم وتاريخ الانتهاء وCVV.',
    en: "The card details don't match: check the number, expiry date and CVV.",
  },
];

/**
 * «معلّق» يُسأل عنه كل 3 ثوانٍ في الدقيقة الأولى، ثم كل 15 ثانية ما دامت الصفحة مفتوحة —
 * المصالحة الدورية قد تحسمه بعد دقائق. كانت تسكت بعد الدقيقة والمؤشّر يدور للأبد (CHK-072)
 */
const FAST_POLLS = 20;
const FAST_MS = 3_000;
const SLOW_MS = 15_000;

/**
 * ST-17 نجح الطلب، و ST-16 فشل الدفع، والحالة الثالثة التي لا تُخفى: «نتحقّق».
 *
 * «معلّق» يُسأل عنه كل بضع ثوانٍ، وكل سؤال يطلق المصالحة في الخادم — فالمشتري
 * الذي انقطع اتصاله يرى النتيجة الحقيقية ولا يضغط «ادفع» ثانيةً.
 */
export default function OrderResultPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  const ask = useConfirm();
  const t = useT();
  const locale = useLocale();
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** مضت الدقيقة الأولى ولم يُحسم الدفع — يُقال للمشتري ما يحدث */
  const [late, setLate] = useState(false);
  const signedIn = useSyncExternalStore(
    () => () => undefined,
    () => session.read() !== null,
    () => false,
  );

  const returned = useReturnTick();
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (attempt: number) => {
      const slow = attempt >= FAST_POLLS;
      if (slow) setLate(true);
      timer = setTimeout(() => void poll(attempt + 1), slow ? SLOW_MS : FAST_MS);
    };
    const poll = async (attempt: number): Promise<void> => {
      const plain = decodeURIComponent(number);
      let next: OrderResult;
      try {
        // طلب الضيف بمفتاحه المحفوظ هنا عند الدفع؛ صاحب الحساب بجلسته
        next = await api<OrderResult>(`/checkout/orders/${encodeURIComponent(plain)}`, { headers: orderKeyHeaders(plain) });
      } catch (err) {
        if (!alive) return;
        // التحميل الأول يعرض خطأه؛ أثناء «نتحقّق» لا يمحو انقطاعٌ عابر الصفحة، ويُعاد السؤال في موعده
        if (attempt === 0 && returned) return; // تحديث الرجوع: فشله لا يمحو الطلب المعروض
        if (attempt === 0) setError(err instanceof Error ? err.message : t('تعذّر تحميل الطلب.', "Couldn't load the order."));
        else schedule(attempt);
        return;
      }
      if (!alive) return;
      setOrder(next);
      if (next.outcome === 'pending') schedule(attempt);
    };
    void poll(0);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [number, t, returned]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!order) return <Spinner label={t('جارٍ تحميل طلبك…', 'Loading your order…')} />;

  const total = format(order.total.minorUnits, order.total.currency, locale);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(order.orderNumber)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  const orderNo = (
    <p className="sp-orderno">
      <span>{t('رقم الطلب', 'Order number')}</span>
      <span className="sp-orderno__no num">{order.orderNumber}</span>
      <button type="button" className="icon-btn" aria-label={t('انسخ رقم الطلب', 'Copy order number')} onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={16} />
      </button>
      <span className="visually-hidden" role="status">
        {copied ? t('نُسخ رقم الطلب', 'Order number copied') : ''}
      </span>
    </p>
  );

  if (order.outcome === 'paid') {
    return (
      <div className="sp-page sp-page--mid">
        <section className="sp-hero">
          <span className="sp-hero__icon" aria-hidden>
            <Icon name="check-circle" size={28} />
          </span>
          <h1 className="sp-hero__title">{t('تمّ طلبك', 'Your order is placed')}</h1>
          <p className="sp-hero__text">
            {t(
              `وصل طلبك إلى ${stores(order.subOrderCount, locale)}، وكل متجر يؤكّد ويشحن وحده. نبلغك عند كل خطوة.`,
              `Your order has reached ${stores(order.subOrderCount, locale)}, and each shop confirms and ships on its own. We'll let you know at every step.`,
            )}
          </p>
          <p className="sp-orderno">
            <span>{t('الإجمالي', 'Total')}</span>
            <span className="sp-orderno__total money num">{total}</span>
          </p>
          {order.coupon ? (
            <p className="sp-hero__text">
              {t('وفّرت', 'You saved')}{' '}
              <span className="money num">{format(order.coupon.discount.minorUnits, order.coupon.discount.currency, locale)}</span>{' '}
              {t('بكوبون', 'with coupon')}{' '}
              <bdi className="num">{order.coupon.code}</bdi>
            </p>
          ) : null}
          {orderNo}
        </section>
        <div className="sp-links">
          {signedIn ? (
            <Link className="btn btn--secondary" href={`/account/orders/${encodeURIComponent(order.orderNumber)}`}>
              <Icon name="truck" size={16} />
              {t('تابع الطلب', 'Track order')}
            </Link>
          ) : null}
          <Link className="btn btn--primary" href="/">
            {t('تابع التسوّق', 'Continue shopping')}
          </Link>
        </div>
      </div>
    );
  }

  if (order.outcome === 'awaiting_transfer' && order.transfer) {
    const cancel = async () => {
      const sure = await ask({
        title: t('تلغي الطلب؟', 'Cancel the order?'),
        body: t('تعود القطع للمتاجر ولا يُؤخذ منك شيء.', 'The items go back to the shops and nothing is taken from you.'),
        confirmLabel: t('ألغِ الطلب', 'Cancel order'),
        danger: true,
      });
      if (!sure) return;
      setCanceling(true);
      setActionError(null);
      try {
        setOrder(await api<OrderResult>(`/checkout/orders/${encodeURIComponent(order.orderNumber)}/cancel`, { method: 'POST' }));
      } catch (err) {
        setActionError(err instanceof Error ? err.message : t('تعذّر إلغاء الطلب.', "Couldn't cancel the order."));
      } finally {
        setCanceling(false);
      }
    };
    return (
      <div className="sp-page sp-page--mid">
        <section className="sp-hero sp-hero--warning">
          <span className="sp-hero__icon" aria-hidden>
            <Icon name="clock" size={28} />
          </span>
          <h1 className="sp-hero__title">{t('حجزنا طلبك — بقي التحويل', "We've reserved your order — the transfer is next")}</h1>
          <p className="sp-hero__text">
            {t(
              'لم نأخذ منك شيئاً بعد. حوّل المبلغ كما هو أدناه، وحين يصلنا نؤكّده ونرسل طلبك إلى المتاجر.',
              "We haven't taken anything from you yet. Transfer the exact amount below, and once it reaches us we'll confirm it and send your order to the shops.",
            )}
          </p>
          {orderNo}
        </section>
        {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
        <TransferInstructions
          transfer={order.transfer}
          amount={total}
          amountMinor={plainAmount(order.total.minorUnits, order.total.currency)}
        />
        <div className="sp-links">
          {signedIn ? (
            <Link className="btn btn--primary" href={`/account/orders/${encodeURIComponent(order.orderNumber)}`}>
              <Icon name="package" size={16} />
              {t('طلباتي', 'My orders')}
            </Link>
          ) : null}
          <button type="button" className="btn btn--ghost" disabled={canceling} onClick={() => void cancel()}>
            {canceling ? t('جارٍ الإلغاء…', 'Canceling…') : t('ألغِ الطلب', 'Cancel order')}
          </button>
        </div>
      </div>
    );
  }

  const transferFailure = order.outcome === 'failed' ? TRANSFER_FAILURES[order.failure?.code ?? ''] : undefined;
  if (transferFailure) {
    return (
      <div className="sp-page sp-page--narrow">
        <section className="sp-hero sp-hero--danger">
          <span className="sp-hero__icon" aria-hidden>
            <Icon name="alert" size={28} />
          </span>
          <h1 className="sp-hero__title">{pick(locale, transferFailure.title)}</h1>
          <p className="sp-hero__text" role="alert">
            {pick(locale, transferFailure.text)}
          </p>
          {orderNo}
          <div className="sp-hero__actions">
            <Link className="btn btn--primary" href="/">
              {t('تابع التسوّق', 'Continue shopping')}
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (order.outcome === 'failed') {
    return (
      <div className="sp-page sp-page--narrow">
        <section className="sp-hero sp-hero--danger">
          <span className="sp-hero__icon" aria-hidden>
            <Icon name="alert" size={28} />
          </span>
          <h1 className="sp-hero__title">{t('لم يكتمل الدفع', "Payment didn't go through")}</h1>
          <p className="sp-hero__text" role="alert">
            {order.failure?.message ?? t('رفضت البوابة الدفع.', 'The gateway declined the payment.')}{' '}
            {t(
              'لم يُخصم شيء، ولم تُحجز القطع باسمك. سلّتك كما هي — جرّب بطاقة أخرى.',
              'Nothing was charged, and no items were reserved in your name. Your cart is as it was — try another card.',
            )}
          </p>
          <span className="sp-pill">
            <Icon name="check-circle" size={14} />
            {t('لم نأخذ أي مبلغ', "We didn't take any money")}
          </span>
          <div className="sp-hero__actions">
            <Link className="btn btn--primary" href="/checkout">
              <Icon name="return" size={16} />
              {t('أعد المحاولة', 'Try again')}
            </Link>
            <Link className="btn btn--secondary" href="/cart">
              {t('عُد إلى السلة', 'Back to cart')}
            </Link>
          </div>
        </section>
        <section className="card sp-reasons">
          <h2 className="sp-reasons__title">{t('أسباب شائعة للرفض', 'Common reasons for a decline')}</h2>
          <ul>
            {FAIL_TIPS.map((tip) => (
              <li key={tip.ar}>
                <Icon name="info" size={15} />
                {pick(locale, tip)}
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <div className="sp-page sp-page--narrow">
      <section className="sp-hero sp-hero--info">
        <span className="sp-hero__icon" aria-hidden>
          <Icon name="clock" size={28} />
        </span>
        <h1 className="sp-hero__title">{t('نتحقّق من الدفع', "We're checking the payment")}</h1>
        <p className="sp-hero__text">
          {t(
            'انقطع الاتصال بالبوابة أثناء الدفع، فنسألها الآن عن النتيجة.',
            'The connection to the gateway dropped during payment, so we are asking it for the result now.',
          )}{' '}
          <strong>{t('لا تدفع ثانيةً', "Don't pay again")}</strong>{' '}
          {t('— القطع محجوزة لك، والصفحة تتحدّث وحدها.', '— the items are reserved for you, and the page updates by itself.')}
        </p>
        {orderNo}
        <Spinner label={t('بانتظار ردّ البوابة…', 'Waiting for the gateway…')} />
        {late ? (
          <>
            <p className="sp-hero__text" role="status">
              {t(
                'يطول التحقّق أكثر من المعتاد. ما زلنا نسأل البوابة وتتحدّث الصفحة حين تصل النتيجة، ولك أن تغلقها: إن تمّ الدفع يصلك تأكيد الطلب، وإن لم يتمّ فلا شيء عليك.',
                "Checking is taking longer than usual. We're still asking the gateway, and the page will update when the result arrives — you can also close it: if the payment went through you'll get the order confirmation, and if not, you owe nothing.",
              )}
            </p>
            <div className="sp-hero__actions">
              <Link className="btn btn--secondary" href="/">
                {t('تابع التسوّق', 'Continue shopping')}
              </Link>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
