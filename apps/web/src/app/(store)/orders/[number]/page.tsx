'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Alert, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

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

  if (order.outcome === 'paid') {
    return (
      <div className="stack">
        <Alert tone="success" title="تمّ طلبك">
          رقم الطلب <span className="num">{order.orderNumber}</span> · الإجمالي{' '}
          <span className="money num">{total}</span>
        </Alert>
        <p>
          وصل طلبك إلى {stores(order.subOrderCount)}، وكل متجر يؤكّد ويشحن وحده. نبلغك عند كل خطوة.
        </p>
        <Link className="btn btn--primary" href="/">
          تابع التسوّق
        </Link>
      </div>
    );
  }

  if (order.outcome === 'failed') {
    return (
      <div className="stack">
        <Alert tone="danger" title="لم يكتمل الدفع">
          {order.failure?.message ?? 'رفضت البوابة الدفع.'} لم يُخصم شيء، ولم تُحجز القطع باسمك.
        </Alert>
        <p className="muted">سلّتك كما هي — جرّب بطاقة أخرى.</p>
        <Link className="btn btn--primary" href="/checkout">
          أعد المحاولة
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <Alert tone="info" title="نتحقّق من الدفع">
        انقطع الاتصال بالبوابة أثناء الدفع، فنسألها الآن عن النتيجة. <strong>لا تدفع ثانيةً</strong> — القطع محجوزة لك، والصفحة
        تتحدّث وحدها.
      </Alert>
      <p className="small muted">
        رقم الطلب <span className="num">{order.orderNumber}</span>
      </p>
      <Spinner label="بانتظار ردّ البوابة…" />
    </div>
  );
}
