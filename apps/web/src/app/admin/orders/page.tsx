'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, MoreButton, ReasonButton, SearchBox, SortButton, Tabs } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui';
import { useLocale, useT } from '@/components/locale';
import { api } from '@/lib/api';
import { localized } from '@/lib/i18n';
import { PARENT_STATUS, PARENT_STATUS_EN, useAction, useAdminData, useAdminList } from '@/lib/admin';
import {
  historyReason,
  labelOf,
  money,
  PAYMENT_STATUS,
  PAYMENT_STATUS_EN,
  REFUND_STATUS,
  REFUND_STATUS_EN,
  toneOf,
  when,
  type SubOrderView,
} from '@/lib/orders';

interface Row {
  orderNumber: string;
  status: string;
  currency: string;
  grandTotalMinorUnits: string;
  placedAt: string;
  guestEmail: string | null;
  customer: { fullName: string | null; email: string | null } | null;
  payment: { status: string } | null;
  subOrders: {
    id: string;
    subOrderNumber: string;
    status: string;
    vendor: { nameAr: string };
    /** موعد انقضاء مهلة القبول — للفرعي الذي ينتظر البائع وحده */
    acceptBy: string | null;
    /** أقل من 12 ساعة على الانقضاء — ما تعدّه بطاقة اللوحة */
    acceptanceDue: boolean;
  }[];
}

interface Detail {
  number: string;
  status: string;
  currency: string;
  grandTotalMinorUnits: string;
  paymentStatus: string | null;
  stores: SubOrderView[];
}

/** لون حالة الطلب الأب — الفرعيات لها ألوانها في `toneOf` */
const PARENT_TONE: Record<string, string> = {
  pending_payment: 'badge--pending',
  payment_failed: 'badge--danger',
  processing: 'badge--info',
  partially_completed: 'badge--warning',
  completed: 'badge--success',
  canceled: 'badge--pending',
  refunded: 'badge--pending',
};

/**
 * AD-12 — الطلبات: بحث برقم الطلب أو العميل أو المتجر، وتفاصيل كل متجر بمساره، وإلغاء الإدارة قبل الشحن.
 * `?due=acceptance` من بطاقة اللوحة: ما قاربت مهلة قبوله وحده، بالقاعدة نفسها التي تعدّه بها.
 */
function OrdersInner() {
  const t = useT();
  const locale = useLocale();
  const parentStatus = localized(locale, PARENT_STATUS, PARENT_STATUS_EN);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  /**
   * الحالة و«قاربت المهلة» من العنوان نفسه، والتغيير يُكتب فيه: كانا حالةً تُقرأ منه مرة، فـ«اعرض كل الطلبات»
   * تزيل التصفية من الشاشة وحدها ويعيدها التحديث والرابط المنسوخ (ADM-024، 29 أكتوبر 2026)
   */
  const status = params.get('status') ?? '';
  const due = params.get('due') === 'acceptance';
  const setFilter = (next: { status?: string; due?: boolean }): void => {
    const query = new URLSearchParams(params.toString());
    const nextStatus = next.status ?? status;
    if (nextStatus) query.set('status', nextStatus);
    else query.delete('status');
    if (next.due ?? due) query.set('due', 'acceptance');
    else query.delete('due');
    const q = query.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const [openNumber, setOpenNumber] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>('newest');
  const q = new URLSearchParams({
    sort,
    ...(search.trim() ? { q: search.trim() } : {}),
    ...(status ? { status } : {}),
    ...(due ? { due: 'acceptance' } : {}),
  });
  const list = useAdminList<Row>(`/admin/orders?${q}`, (o) => o.orderNumber);
  const { data, error, forbidden, reload } = list;

  return (
    <div className="ao-page">
      <AdminHeader
        title={t('الطلبات', 'Orders')}
        count={data ? t(`${data.total} طلب`, `${data.total} ${data.total === 1 ? 'order' : 'orders'}`) : undefined}
      />
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={(v) => setFilter({ status: v, due: false })}
          label={t('حالة الطلب', 'Order status')}
          options={[
            { key: '', label: t('الكل', 'All') },
            ...['processing', 'partially_completed', 'completed', 'canceled', 'refunded', 'payment_failed'].map((k) => ({ key: k, label: parentStatus[k]! })),
          ]}
        />
        <div className="toolbar__end">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={t('رقم الطلب، بريد العميل، أو المتجر', 'Order number, customer email, or shop')}
            label={t('بحث في الطلبات', 'Search orders')}
          />
          <SortButton value={sort} onChange={setSort} />
        </div>
      </div>
      {due ? (
        <Alert tone="warning" title={t('طلبات قاربت مهلة القبول', 'Orders near their acceptance deadline')}>
          <p>
            {t(
              'متاجر لم تقبل طلبها وبقي على انقضاء مهلتها أقل من 12 ساعة — بعدها يُلغى آلياً ويُردّ المبلغ. ذكّر المتجر أو ألغِ بنفسك.',
              'Shops that have not accepted their order with less than 12 hours left — after that it is canceled automatically and the amount refunded. Remind the shop or cancel it yourself.',
            )}
          </p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setFilter({ due: false })}>
            {t('اعرض كل الطلبات', 'Show all orders')}
          </button>
        </Alert>
      ) : null}
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <Empty
          icon="truck"
          title={due ? t('لا طلب قاربت مهلة قبوله', 'No order is near its acceptance deadline') : t('لا طلبات بهذه التصفية', 'No orders match this filter')}
          actions={
            search.trim() || status || due ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setSearch('');
                  setFilter({ status: '', due: false });
                }}
              >
                {t('أزل التصفية', 'Clear filters')}
              </button>
            ) : undefined
          }
        >
          {t('وسّع التصفية أو ابحث برقم آخر.', 'Widen the filter or search for another number.')}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>{t('الطلب', 'Order')}</th>
                <th>{t('العميل', 'Customer')}</th>
                <th>{t('المتاجر', 'Shops')}</th>
                <th>{t('الحالة', 'Status')}</th>
                <th className="end">{t('الإجمالي', 'Total')}</th>
                <th>{t('التاريخ', 'Date')}</th>
                <th className="end">
                  <span className="visually-hidden">{t('الإجراء', 'Action')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((o) => {
                const open = openNumber === o.orderNumber;
                return (
                  <Fragment key={o.orderNumber}>
                    <tr data-open={open}>
                      <td className="num ao-strong">{o.orderNumber}</td>
                      <td data-label={t('العميل', 'Customer')}>
                        <span className="ao-stack">
                          <span className="ao-strong">{o.customer?.fullName ?? o.guestEmail ?? t('ضيف', 'Guest')}</span>
                          <span className="ao-stack__sub">{o.subOrders.map((s) => s.vendor.nameAr).join(t('، ', ', '))}</span>
                          {o.subOrders
                            .filter((s) => s.acceptanceDue && s.acceptBy)
                            .map((s) => (
                              <span key={s.id} className="ao-stack__sub ao-due">
                                <Icon name="clock" size={12} />
                                {s.vendor.nameAr}: {t('يُلغى آلياً', 'auto-cancels')} <span className="num">{when(s.acceptBy!, locale)}</span>
                              </span>
                            ))}
                        </span>
                      </td>
                      <td data-label={t('المتاجر', 'Shops')} className="num">
                        {o.subOrders.length}
                      </td>
                      <td data-label={t('الحالة', 'Status')}>
                        <span className={`badge ${PARENT_TONE[o.status] ?? 'badge--pending'}`}>{parentStatus[o.status] ?? o.status}</span>
                      </td>
                      <td data-label={t('الإجمالي', 'Total')} className="end">
                        <span className="money num">{money(o.grandTotalMinorUnits, o.currency, locale)}</span>
                      </td>
                      <td data-label={t('التاريخ', 'Date')} className="ao-date">
                        {when(o.placedAt, locale)}
                      </td>
                      <td data-label="" className="end">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          aria-expanded={open}
                          aria-controls={`order-${o.orderNumber}`}
                          onClick={() => setOpenNumber(open ? null : o.orderNumber)}
                        >
                          {open ? t('أغلق', 'Close') : t('افتح', 'Open')}
                          <Icon name="chev-down" size={14} className={open ? 'ao-flip' : ''} />
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="ao-detail-row">
                        <td colSpan={7} id={`order-${o.orderNumber}`}>
                          <OrderDetail number={o.orderNumber} onChange={reload} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton list={list} />
    </div>
  );
}

function OrderDetail({ number, onChange }: { number: string; onChange: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { data, error, reload } = useAdminData<Detail>(`/admin/orders/${number}`);
  const act = useAction();
  if (!data) return <Loading error={error} inline />;
  const paymentStatus = localized(locale, PAYMENT_STATUS, PAYMENT_STATUS_EN);
  const refundStatus = localized(locale, REFUND_STATUS, REFUND_STATUS_EN);
  return (
    <div className="ao-order">
      <Feedback error={act.error} notice={act.notice} />
      <p className="ao-order__pay">
        <Icon name="card" size={14} />
        {t('الدفع:', 'Payment:')} {data.paymentStatus ? (paymentStatus[data.paymentStatus] ?? data.paymentStatus) : '—'}
      </p>
      <div className="ao-subs">
        {data.stores.map((s) => (
          <section key={s.id} className="ao-sub">
            <header className="ao-sub__head">
              <span className="ao-shop">
                <span className="ao-tile" aria-hidden>
                  <Icon name="store" size={15} />
                </span>
                <span className="ao-shop__text">
                  <span className="ao-shop__name">{s.vendor.nameAr}</span>
                  <span className="ao-shop__sub num">{s.number}</span>
                </span>
              </span>
              <span className={`badge ${toneOf(s.status)}`}>{labelOf(s.status, locale)}</span>
            </header>
            <ol className="ao-timeline">
              {s.history.map((h, i) => (
                <li key={i}>
                  <span className="ao-timeline__what">{locale === 'en' ? labelOf(h.toStatus, locale) : h.toLabel}</span>
                  <span className="ao-timeline__when">{when(h.createdAt, locale)}</span>
                  {h.reason ? <span className="ao-timeline__why">{t('«', '“')}{historyReason(h, locale)}{t('»', '”')}</span> : null}
                </li>
              ))}
            </ol>
            {s.shipment ? (
              <p className="ao-sub__line">
                <Icon name="truck" size={14} />
                {t('التتبّع:', 'Tracking:')} <span className="num">{s.shipment.trackingNumber}</span>
              </p>
            ) : null}
            {s.refunds.length ? (
              <p className="ao-sub__line">
                <Icon name="return" size={14} />
                <span>
                  {t('استردادات:', 'Refunds:')}{' '}
                  {s.refunds.map((r, i) => (
                    <Fragment key={i}>
                      {i ? t('، ', ', ') : ''}
                      <span className="money num">{money(r.amountMinorUnits, data.currency, locale)}</span> ({refundStatus[r.status] ?? r.status})
                    </Fragment>
                  ))}
                </span>
              </p>
            ) : null}
            {s.actions.includes('canceled_by_admin') ? (
              <div className="ao-sub__actions">
                <ReasonButton
                  label={t('إلغاء هذا المتجر ورد المبلغ', 'Cancel this shop and refund')}
                  presets={[
                    t('نفاد المخزون لدى البائع', 'Seller is out of stock'),
                    t('احتيال مشتبه في الطلب', 'Suspected fraud on the order'),
                    t('البائع لا يستجيب', 'Seller is not responding'),
                  ]}
                  disabled={act.busy}
                  onSubmit={(r) =>
                    act.run(async () => {
                      await api(`/admin/orders/stores/${s.id}/cancel`, { method: 'POST', body: { reason: r } });
                      reload();
                      onChange();
                    }, t('أُلغي ويُردّ المبلغ للمشتري.', 'Canceled; the amount is being refunded to the buyer.'))
                  }
                />
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense>
      <OrdersInner />
    </Suspense>
  );
}
