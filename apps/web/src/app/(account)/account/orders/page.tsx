'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { api, session } from '@/lib/api';
import { labelOf, money, toneOf, when } from '@/lib/orders';
import { imageUrl } from '@/lib/storefront';

interface Row {
  number: string;
  status: string;
  currency: string;
  grandTotalMinorUnits: string;
  placedAt: string;
  payment?: { status: string; failureCode: string | null; expiresAt: string | null } | null;
  stores: {
    vendor: string;
    status: string;
    items: { productNameSnapshotAr: string; imageKeySnapshot?: string | null; qty: number }[];
  }[];
}

const PARENT_LABEL: Record<string, string> = {
  processing: 'قيد التنفيذ',
  partially_completed: 'مكتمل جزئياً',
  completed: 'مكتمل',
  canceled: 'ملغى',
  refunded: 'مُسترَد',
};

const PARENT_TONE: Record<string, string> = {
  processing: 'badge--review',
  partially_completed: 'badge--warning',
  completed: 'badge--approved',
  canceled: 'badge--rejected',
  refunded: 'badge--pending',
};

const thumbOf = (key: string | null | undefined): string | null =>
  key ? imageUrl(`/uploads/${key}/thumb.webp`) : null;

/** طلب بتحويل لم يُقسَّم بعد: ينتظر تحويله، أو أُلغي قبله — حالته من الدفعة لا من المتاجر */
function transferState(o: Row): { label: string; tone: string; note: string } | null {
  if (o.status === 'pending_payment' && o.payment?.status === 'awaiting_transfer') {
    return {
      label: 'بانتظار تحويلك',
      tone: 'badge--warning',
      note: o.payment.expiresAt
        ? `حوّل المبلغ قبل ${when(o.payment.expiresAt)} ليصل طلبك إلى المتاجر.`
        : 'حوّل المبلغ ليصل طلبك إلى المتاجر.',
    };
  }
  if (o.status === 'payment_failed') {
    const code = o.payment?.failureCode;
    return {
      label: code === 'canceled_by_customer' ? 'ألغيته قبل التحويل' : 'أُلغي',
      tone: 'badge--rejected',
      note: code === 'transfer_expired' ? 'لم يصلنا التحويل خلال المهلة، فأُلغي وعادت القطع للمتاجر.' : 'لم يُدفع، ولم يصل إلى المتاجر.',
    };
  }
  return null;
}

/**
 * ST-18 — طلباتي.
 *
 * طلب واحد من عدّة متاجر يظهر طلباً واحداً — بحالة كل متجر تحته، لأن كل
 * متجر يشحن وحده ويصل وحده.
 */
export default function MyOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.read()) {
      router.replace('/login?next=/account/orders');
      return;
    }
    api<{ items: Row[] }>('/me/orders')
      .then((d) => setRows(d.items))
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <div className="sp-page">
      <PageHead
        title="طلباتي"
        {...(rows && rows.length > 0 ? { count: rows.length } : {})}
        actions={
          <Link href="/account/disputes" className="btn btn--secondary btn--sm">
            <Icon name="msg" size={15} />
            النزاعات
          </Link>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!rows && !error ? (
        <div className="sp-skel" role="status">
          <span className="visually-hidden">جارٍ جلب طلباتك…</span>
          <span className="skeleton sp-skel__row" aria-hidden />
          <span className="skeleton sp-skel__row" aria-hidden />
          <span className="skeleton sp-skel__row" aria-hidden />
        </div>
      ) : null}
      {rows && rows.length === 0 ? (
        <EmptyState
          icon="package"
          title="لا طلبات بعد"
          actions={
            <Link href="/" className="btn btn--primary">
              تسوّق الآن
            </Link>
          }
        >
          طلباتك تظهر هنا بعد أول عملية شراء.
        </EmptyState>
      ) : null}
      {rows && rows.length > 0 ? (
        <ul className="sp-orders">
          {rows.map((o) => {
            const transfer = transferState(o);
            return (
            <li key={o.number}>
              <Link href={`/account/orders/${o.number}`} className="sp-order">
                <span className="sp-order__head">
                  <span className="tile-icon sp-tile" aria-hidden>
                    <Icon name={transfer && o.status === 'pending_payment' ? 'clock' : 'package'} size={15} />
                  </span>
                  <span className="sp-order__no num">{o.number}</span>
                  <span className="sp-order__date">{when(o.placedAt)}</span>
                  <span className={`badge ${transfer?.tone ?? PARENT_TONE[o.status] ?? 'badge--pending'}`}>
                    {transfer?.label ?? PARENT_LABEL[o.status] ?? o.status}
                  </span>
                  <span className="sp-order__total money num">{money(o.grandTotalMinorUnits, o.currency)}</span>
                </span>
                {transfer ? <span className="sp-order__note">{transfer.note}</span> : null}
                <span className="sp-order__stores">
                  {o.stores.map((s, i) => (
                    <span key={i} className="sp-order__store">
                      <span className="tile-icon sp-tile--sm" aria-hidden>
                        <Icon name="store" size={14} />
                      </span>
                      <span className="sp-order__vendor">
                        <span className="sp-order__vendor-name">{s.vendor}</span>
                        <span className="sp-order__items">
                          {s.items.map((it) => it.productNameSnapshotAr).join('، ')}
                        </span>
                      </span>
                      <span className="sp-order__thumbs" aria-hidden>
                        {s.items.map((it, k) => {
                          const src = thumbOf(it.imageKeySnapshot);
                          return (
                            <span key={k} className="sp-thumb sp-thumb--sm">
                              {src ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={src} alt="" loading="lazy" width={34} height={34} />
                              ) : (
                                <Icon name="image" size={16} />
                              )}
                            </span>
                          );
                        })}
                      </span>
                      <span className={`badge ${toneOf(s.status)}`}>{labelOf(s.status)}</span>
                    </span>
                  ))}
                </span>
                <span className="sp-order__foot">
                  {transfer && o.status === 'pending_payment' ? 'كيف تحوّل' : 'التفاصيل والتتبّع'}
                  <Icon name="chev-end" size={14} mirror />
                </span>
              </Link>
            </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
