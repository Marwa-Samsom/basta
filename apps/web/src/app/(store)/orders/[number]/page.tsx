'use client';

import Link from 'next/link';
import { use, useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons';
import { Alert, Spinner } from '@/components/ui';
import { api, session } from '@/lib/api';

interface OrderResult {
  orderNumber: string;
  outcome: 'paid' | 'failed' | 'requires_action' | 'pending';
  total: { minorUnits: string; currency: string };
  subOrderCount: number;
  failure?: { code: string; message: string };
}

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
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
        const next = await api<OrderResult>(`/checkout/orders/${encodeURIComponent(decodeURIComponent(number))}`);
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
