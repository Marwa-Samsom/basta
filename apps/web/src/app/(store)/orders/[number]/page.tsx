'use client';

import Link from 'next/link';
import { use, useEffect, useState, useSyncExternalStore } from 'react';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { plainAmount, TransferInstructions, type TransferInstructionsView } from '@/components/transfer-instructions';
import { Alert, Spinner } from '@/components/ui';
import { api, session } from '@/lib/api';
import { orderKeyHeaders } from '@/lib/order-key';

interface OrderResult {
  orderNumber: string;
  outcome: 'paid' | 'failed' | 'requires_action' | 'awaiting_transfer' | 'pending';
  total: { minorUnits: string; currency: string };
  subOrderCount: number;
  failure?: { code: string; message: string };
  transfer?: TransferInstructionsView;
}

/** طلب تحويل أُغلق قبل أن يُدفع — لا «جرّب بطاقة أخرى» لمن لم يستعمل بطاقة */
const TRANSFER_FAILURES: Record<string, { title: string; text: string }> = {
  transfer_expired: {
    title: 'أُلغي الطلب — لم يصل التحويل',
    text: 'لم يصلنا تحويلك خلال المهلة، فأُلغي الطلب وعادت القطع للمتاجر. إن كنت حوّلت فعلاً فراسلنا بمرجع التحويل لنردّه لك، أو اطلب من جديد.',
  },
  canceled_by_customer: {
    title: 'ألغيت الطلب',
    text: 'ألغيت الطلب قبل التحويل، فلم نأخذ شيئاً وعادت القطع للمتاجر.',
  },
};

const format = (minor: string, currency: string): string => {
  const digits = ['JOD', 'KWD', 'BHD', 'OMR'].includes(currency) ? 3 : 2;
  return new Intl.NumberFormat('ar-JO-u-nu-latn', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(minor) / 10 ** digits);
};

/** تمييز العدد بالعربية يتغيّر بالعدد نفسه: «2 متاجر» خطأ، والصواب «متجرين» */
function stores(n: number): string {
  if (n === 1) return 'البائع';
  if (n === 2) return 'متجرين';
  if (n <= 10) return `${n} متاجر`;
  return `${n} متجراً`;
}

/** أسباب الرفض الشائعة — نصائح عامة للمشتري لا بيانات من البوابة */
const FAIL_TIPS = [
  'رصيد غير كافٍ أو حدّ شرائي يومي على البطاقة.',
  'البطاقة غير مُفعّلة للشراء عبر الإنترنت — فعّلها من تطبيق بنكك.',
  'بيانات البطاقة غير مطابقة: تحقّق من الرقم وتاريخ الانتهاء وCVV.',
];

/**
 * ST-17 نجح الطلب، و ST-16 فشل الدفع، والحالة الثالثة التي لا تُخفى: «نتحقّق».
 *
 * «معلّق» يُسأل عنه كل بضع ثوانٍ، وكل سؤال يطلق المصالحة في الخادم — فالمشتري
 * الذي انقطع اتصاله يرى النتيجة الحقيقية ولا يضغط «ادفع» ثانيةً.
 */
export default function OrderResultPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  const ask = useConfirm();
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const signedIn = useSyncExternalStore(
    () => () => undefined,
    () => session.read() !== null,
    () => false,
  );

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (attempt: number): Promise<void> => {
      try {
        const plain = decodeURIComponent(number);
        // طلب الضيف بمفتاحه المحفوظ هنا عند الدفع؛ صاحب الحساب بجلسته
        const next = await api<OrderResult>(`/checkout/orders/${encodeURIComponent(plain)}`, { headers: orderKeyHeaders(plain) });
        if (!alive) return;
        setOrder(next);
        if (next.outcome === 'pending' && attempt < 20) {
          timer = setTimeout(() => void poll(attempt + 1), 3000);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'تعذّر تحميل الطلب.');
      }
    };
    void poll(0);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [number]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!order) return <Spinner label="جارٍ تحميل طلبك…" />;

  const total = format(order.total.minorUnits, order.total.currency);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(order.orderNumber)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  const orderNo = (
    <p className="sp-orderno">
      <span>رقم الطلب</span>
      <span className="sp-orderno__no num">{order.orderNumber}</span>
      <button type="button" className="icon-btn" aria-label="انسخ رقم الطلب" onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={16} />
      </button>
      <span className="visually-hidden" role="status">
        {copied ? 'نُسخ رقم الطلب' : ''}
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
          <h1 className="sp-hero__title">تمّ طلبك</h1>
          <p className="sp-hero__text">
            وصل طلبك إلى {stores(order.subOrderCount)}، وكل متجر يؤكّد ويشحن وحده. نبلغك عند كل خطوة.
          </p>
          <p className="sp-orderno">
            <span>الإجمالي</span>
            <span className="sp-orderno__total money num">{total}</span>
          </p>
          {orderNo}
        </section>
        <div className="sp-links">
          {signedIn ? (
            <Link className="btn btn--secondary" href={`/account/orders/${encodeURIComponent(order.orderNumber)}`}>
              <Icon name="truck" size={16} />
              تابع الطلب
            </Link>
          ) : null}
          <Link className="btn btn--primary" href="/">
            تابع التسوّق
          </Link>
        </div>
      </div>
    );
  }

  if (order.outcome === 'awaiting_transfer' && order.transfer) {
    const cancel = async () => {
      const sure = await ask({
        title: 'تلغي الطلب؟',
        body: 'تعود القطع للمتاجر ولا يُؤخذ منك شيء.',
        confirmLabel: 'ألغِ الطلب',
        danger: true,
      });
      if (!sure) return;
      setCanceling(true);
      setActionError(null);
      try {
        setOrder(await api<OrderResult>(`/checkout/orders/${encodeURIComponent(order.orderNumber)}/cancel`, { method: 'POST' }));
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'تعذّر إلغاء الطلب.');
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
          <h1 className="sp-hero__title">حجزنا طلبك — بقي التحويل</h1>
          <p className="sp-hero__text">
            لم نأخذ منك شيئاً بعد. حوّل المبلغ كما هو أدناه، وحين يصلنا نؤكّده ونرسل طلبك إلى المتاجر.
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
              طلباتي
            </Link>
          ) : null}
          <button type="button" className="btn btn--ghost" disabled={canceling} onClick={() => void cancel()}>
            {canceling ? 'جارٍ الإلغاء…' : 'ألغِ الطلب'}
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
          <h1 className="sp-hero__title">{transferFailure.title}</h1>
          <p className="sp-hero__text" role="alert">
            {transferFailure.text}
          </p>
          {orderNo}
          <div className="sp-hero__actions">
            <Link className="btn btn--primary" href="/">
              تابع التسوّق
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
          <h1 className="sp-hero__title">لم يكتمل الدفع</h1>
          <p className="sp-hero__text" role="alert">
            {order.failure?.message ?? 'رفضت البوابة الدفع.'} لم يُخصم شيء، ولم تُحجز القطع باسمك. سلّتك كما هي — جرّب
            بطاقة أخرى.
          </p>
          <span className="sp-pill">
            <Icon name="check-circle" size={14} />
            لم نأخذ أي مبلغ
          </span>
          <div className="sp-hero__actions">
            <Link className="btn btn--primary" href="/checkout">
              <Icon name="return" size={16} />
              أعد المحاولة
            </Link>
            <Link className="btn btn--secondary" href="/cart">
              عُد إلى السلة
            </Link>
          </div>
        </section>
        <section className="card sp-reasons">
          <h2 className="sp-reasons__title">أسباب شائعة للرفض</h2>
          <ul>
            {FAIL_TIPS.map((t) => (
              <li key={t}>
                <Icon name="info" size={15} />
                {t}
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
        <h1 className="sp-hero__title">نتحقّق من الدفع</h1>
        <p className="sp-hero__text">
          انقطع الاتصال بالبوابة أثناء الدفع، فنسألها الآن عن النتيجة. <strong>لا تدفع ثانيةً</strong> — القطع محجوزة
          لك، والصفحة تتحدّث وحدها.
        </p>
        {orderNo}
        <Spinner label="بانتظار ردّ البوابة…" />
      </section>
    </div>
  );
}
