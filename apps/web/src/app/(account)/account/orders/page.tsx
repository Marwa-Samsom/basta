'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { Alert, EmptyState, MoreButton, PageHead } from '@/components/ui';
import { session } from '@/lib/api';
import { useAdminList } from '@/lib/admin';
import { localized, type Locale, type Translate } from '@/lib/i18n';
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

const PARENT_LABEL_EN: Record<string, string> = {
  processing: 'Processing',
  partially_completed: 'Partially completed',
  completed: 'Completed',
  canceled: 'Canceled',
  refunded: 'Refunded',
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
function transferState(o: Row, t: Translate, locale: Locale): { label: string; tone: string; note: string } | null {
  if (o.status === 'pending_payment' && o.payment?.status === 'awaiting_transfer') {
    return {
      label: t('بانتظار تحويلك', 'Awaiting your transfer'),
      tone: 'badge--warning',
      note: o.payment.expiresAt
        ? t(
            `حوّل المبلغ قبل ${when(o.payment.expiresAt)} ليصل طلبك إلى المتاجر.`,
            `Transfer the amount before ${when(o.payment.expiresAt, locale)} so your order reaches the shops.`,
          )
        : t('حوّل المبلغ ليصل طلبك إلى المتاجر.', 'Transfer the amount so your order reaches the shops.'),
    };
  }
  if (o.status === 'payment_failed') {
    const code = o.payment?.failureCode;
    return {
      label: code === 'canceled_by_customer' ? t('ألغيته قبل التحويل', 'You canceled it before transferring') : t('أُلغي', 'Canceled'),
      tone: 'badge--rejected',
      note:
        code === 'transfer_expired'
          ? t(
              'لم يصلنا التحويل خلال المهلة، فأُلغي وعادت القطع للمتاجر.',
              "Your transfer didn't reach us in time, so the order was canceled and the items went back to the shops.",
            )
          : t('لم يُدفع، ولم يصل إلى المتاجر.', "It wasn't paid and didn't reach the shops."),
    };
  }
  return null;
}

/**
 * ST-18 — طلباتي.
 *
 * طلب واحد من عدّة متاجر يظهر طلباً واحداً — بحالة كل متجر تحته، لأن كل
 * متجر يشحن وحده ويصل وحده.
 *
 * صفحات من الخادم بـ«المزيد» و«السابق» (3 نوفمبر 2026): كانت أول عشرين طلباً وحدها،
 * فما قبلها لا يُوصل إليه من «طلباتي».
 */
export default function MyOrdersPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  // بلا جلسة يُحوَّل إلى الدخول، ولا يُجلب شيء قبل أن تُعرف (كـ«نزاعاتي»)
  const signedIn = useSyncExternalStore(
    () => () => undefined,
    () => session.read() !== null,
    () => false,
  );
  useEffect(() => {
    if (!session.read()) router.replace('/login?next=/account/orders');
  }, [router]);
  const list = useAdminList<Row>(signedIn ? '/me/orders' : null, (o) => o.number);
  const rows = list.data ? list.items : null;
  const error = list.error;

  return (
    <div className="sp-page">
      <PageHead
        title={t('طلباتي', 'My orders')}
        {...(list.data && list.total > 0 ? { count: list.total } : {})}
        actions={
          <Link href="/account/disputes" className="btn btn--secondary btn--sm">
            <Icon name="msg" size={15} />
            {t('النزاعات', 'Disputes')}
          </Link>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!rows && !error ? (
        <div className="sp-skel" role="status">
          <span className="visually-hidden">{t('جارٍ جلب طلباتك…', 'Loading your orders…')}</span>
          <span className="skeleton sp-skel__row" aria-hidden />
          <span className="skeleton sp-skel__row" aria-hidden />
          <span className="skeleton sp-skel__row" aria-hidden />
        </div>
      ) : null}
      {rows && rows.length === 0 ? (
        <EmptyState
          icon="package"
          title={t('لا طلبات بعد', 'No orders yet')}
          actions={
            <Link href="/" className="btn btn--primary">
              {t('تسوّق الآن', 'Shop now')}
            </Link>
          }
        >
          {t('طلباتك تظهر هنا بعد أول عملية شراء.', 'Your orders will show up here after your first purchase.')}
        </EmptyState>
      ) : null}
      {rows && rows.length > 0 ? (
        <ul className="sp-orders">
          {rows.map((o) => {
            const transfer = transferState(o, t, locale);
            return (
            <li key={o.number}>
              <Link href={`/account/orders/${o.number}`} className="sp-order">
                <span className="sp-order__head">
                  <span className="tile-icon sp-tile" aria-hidden>
                    <Icon name={transfer && o.status === 'pending_payment' ? 'clock' : 'package'} size={15} />
                  </span>
                  <span className="sp-order__no num">{o.number}</span>
                  <span className="sp-order__date">{when(o.placedAt, locale)}</span>
                  <span className={`badge ${transfer?.tone ?? PARENT_TONE[o.status] ?? 'badge--pending'}`}>
                    {transfer?.label ?? localized(locale, PARENT_LABEL, PARENT_LABEL_EN)[o.status] ?? o.status}
                  </span>
                  <span className="sp-order__total money num">{money(o.grandTotalMinorUnits, o.currency, locale)}</span>
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
                          {s.items.map((it) => it.productNameSnapshotAr).join(t('، ', ', '))}
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
                      <span className={`badge ${toneOf(s.status)}`}>{labelOf(s.status, locale)}</span>
                    </span>
                  ))}
                </span>
                <span className="sp-order__foot">
                  {transfer && o.status === 'pending_payment' ? t('كيف تحوّل', 'How to transfer') : t('التفاصيل والتتبّع', 'Details and tracking')}
                  <Icon name="chev-end" size={14} mirror />
                </span>
              </Link>
            </li>
            );
          })}
        </ul>
      ) : null}
      <MoreButton list={list} />
    </div>
  );
}
