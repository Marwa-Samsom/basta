'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, MoreButton, SearchBox, SortButton } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { TONE, useAction, useAdminList } from '@/lib/admin';
import { labelOf, money, REFUND_STATUS, REFUND_STATUS_EN, RETURN_REASONS, RETURN_REASONS_EN, when } from '@/lib/orders';
import { useLocale, useT } from '@/components/locale';
import { localized } from '@/lib/i18n';

interface ReturnRow {
  id: string;
  reasonCode: string;
  description: string | null;
  status: string;
  requestedAt: string;
  itemsJson: { orderItemId: string; qty: number }[];
  subOrder: { id: string; subOrderNumber: string; status: string; vendor: { nameAr: string } };
}

interface RefundRow {
  id: string;
  amountMinorUnits: string;
  vendorAmountMinorUnits: string | null;
  /** ما تحمّله البائع فعلاً بعملته — بعد ما ردّته المنصة من عمولتها وضريبتها */
  vendorChargeMinorUnits: string | null;
  currency: string;
  reason: string;
  status: string;
  providerRefundId: string | null;
  createdAt: string;
  vendorNegative: string | null;
  subOrder: { subOrderNumber: string; settlementCurrency: string; vendor: { nameAr: string } };
}

const RETURN_STATUS: Record<string, string> = { requested: 'بانتظار البائع', received: 'استُلم', rejected: 'رُفض' };
const RETURN_STATUS_EN: Record<string, string> = { requested: 'Awaiting seller', received: 'Received', rejected: 'Rejected' };

/** ثلاثة أيام بلا ردّ من المتجر — يظهر العمر بالأحمر ويصير التدخّل الإجراء الأوّل */
// العتبة نفسها التي ينبّه بها الخادم المديرين (RETURN_STALL_DAYS في admin-alerts.scheduler)
const STALL_MS = 3 * 24 * 3_600_000;

/**
 * AD-15 — المرتجعات والاستردادات. الإدارة تتدخّل حين يتعثّر متجر: تستلم
 * المرتجع بدلاً منه (الانتقال نفسه بفاعل admin)، والاسترداد يظهر بمرجع
 * البوابة، والرصيد السالب للبائع إن نتج بجانبه.
 *
 * بحث واحد للقائمتين (رقم الطلب أو المتجر أو المشتري)، ولكلٍّ «المزيد» — كانتا تقفان عند
 * أحدث مئة بلا بحث.
 */
export default function AdminReturnsPage() {
  const t = useT();
  const locale = useLocale();
  const [search, setSearch] = useState('');
  // ترتيب واحد للقائمتين
  const [sort, setSort] = useState<SortOrder>('newest');
  const query = `?${new URLSearchParams({ sort, ...(search.trim() ? { search: search.trim() } : {}) })}`;
  const requests = useAdminList<ReturnRow>(`/admin/returns${query}`, (r) => r.id);
  const refunds = useAdminList<RefundRow>(`/admin/returns/refunds${query}`, (r) => r.id);
  const act = useAction();
  // لحظة فتح الصفحة — يُقاس بها عمر الطلب، ولا تتغيّر بين رسم ورسم
  const [now] = useState(() => Date.now());
  if (!requests.data || !refunds.data) {
    const failed = requests.error ? requests : refunds;
    return <Loading error={failed.error} forbidden={failed.forbidden} onRetry={failed.reload} />;
  }
  const searching = Boolean(search.trim());
  const clear = (
    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>
      {t('أزل التصفية', 'Clear filters')}
    </button>
  );

  const receive = (subOrderId: string, returnRequestId: string) =>
    act.run(async () => {
      await api(`/admin/orders/stores/${subOrderId}/transition`, { method: 'POST', body: { to: 'returned', returnRequestId } });
      requests.reload();
      refunds.reload();
    }, t('سُجّل الاستلام: عادت القطع للمخزون ويُردّ نصيبها للمشتري.', "Receipt recorded: the items are back in stock and their share is being refunded to the buyer."));

  return (
    <div className="ao-page">
      <AdminHeader title={t('المرتجعات والمبالغ المعادة', 'Returns and refunds')} />
      <Feedback error={act.error} notice={act.notice} />
      <div className="toolbar">
        <div className="toolbar__end">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={t('رقم الطلب أو المتجر أو المشتري', 'Order number, shop, or buyer')}
            label={t('بحث في المرتجعات والمبالغ المعادة', 'Search returns and refunds')}
          />
          <SortButton value={sort} onChange={setSort} />
        </div>
      </div>

      <section className="card card--flush">
        <header className="card__head">
          <h2>{t('طلبات الإرجاع', 'Return requests')}</h2>
          <span className="ao-card-count num">{requests.total}</span>
        </header>
        {requests.items.length === 0 ? (
          searching ? (
            <Empty icon="search" title={t('لا طلبات إرجاع بهذا البحث', 'No return requests match this search')} actions={clear} />
          ) : (
            <Empty icon="return" title={t('لا طلبات إرجاع', 'No return requests')}>
              {t('تظهر هنا طلبات الإرجاع حين يفتحها المشترون.', 'Return requests appear here when buyers open them.')}
            </Empty>
          )
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t('طلبات الإرجاع', 'Return requests')}>
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>{t('الطلب', 'Order')}</th>
                  <th>{t('المتجر', 'Shop')}</th>
                  <th>{t('السبب', 'Reason')}</th>
                  <th className="end">{t('القطع', 'Items')}</th>
                  <th>{t('منذ', 'Since')}</th>
                  <th>{t('الحالة', 'Status')}</th>
                  <th className="end">
                    <span className="visually-hidden">{t('الإجراء', 'Action')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.items.map((r) => {
                  const stalled = r.status === 'requested' && now - new Date(r.requestedAt).getTime() >= STALL_MS;
                  return (
                    <tr key={r.id}>
                      <td className="num ao-strong">{r.subOrder.subOrderNumber}</td>
                      <td data-label={t('المتجر', 'Shop')} className="ao-strong">
                        {r.subOrder.vendor.nameAr}
                      </td>
                      <td data-label={t('السبب', 'Reason')} className="wrap">
                        <span className="ao-stack">
                          <span>{localized(locale, RETURN_REASONS, RETURN_REASONS_EN)[r.reasonCode] ?? r.reasonCode}</span>
                          {r.description ? (
                            <span className="ao-stack__sub">
                              {t('«', '“')}
                              {r.description}
                              {t('»', '”')}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td data-label={t('القطع', 'Items')} className="end num">
                        {r.itemsJson.reduce((a, i) => a + i.qty, 0)}
                      </td>
                      <td data-label={t('منذ', 'Since')} className="ao-date" data-late={stalled}>
                        {when(r.requestedAt, locale)}
                      </td>
                      <td data-label={t('الحالة', 'Status')}>
                        <span className="ao-stack">
                          <span className={`badge ${TONE[r.status] ?? 'badge--warning'}`}>{localized(locale, RETURN_STATUS, RETURN_STATUS_EN)[r.status] ?? r.status}</span>
                          <span className="ao-stack__sub">{labelOf(r.subOrder.status, locale)}</span>
                        </span>
                      </td>
                      <td data-label="" className="end">
                        {r.status === 'requested' ? (
                          <button type="button" className={`btn btn--sm ${stalled ? 'btn--primary' : 'btn--secondary'}`} disabled={act.busy} onClick={() => void receive(r.subOrder.id, r.id)}>
                            {t('تسجيل الاستلام بدل المتجر', 'Record receipt for the shop')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <MoreButton list={requests} />
      </section>

      <section className="card card--flush">
        <header className="card__head">
          <h2>{t('المبالغ المعادة', 'Refunds')}</h2>
          <span className="ao-card-count num">{refunds.total}</span>
        </header>
        {refunds.items.length === 0 ? (
          searching ? (
            <Empty icon="search" title={t('لا استردادات بهذا البحث', 'No refunds match this search')} actions={clear} />
          ) : (
            <Empty icon="wallet" title={t('لا استردادات', 'No refunds')}>
              {t('تظهر هنا المبالغ المعادة للمشترين بمرجع البوابة أو التحويل.', 'Amounts refunded to buyers appear here with the gateway or transfer reference.')}
            </Empty>
          )
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t('الاستردادات', 'Refunds')}>
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>{t('الطلب', 'Order')}</th>
                  <th className="end">{t('للمشتري', 'To buyer')}</th>
                  <th className="end">{t('على البائع', 'Charged to seller')}</th>
                  <th>{t('السبب', 'Reason')}</th>
                  <th>{t('الحالة', 'Status')}</th>
                  <th>{t('المرجع', 'Reference')}</th>
                </tr>
              </thead>
              <tbody>
                {refunds.items.map((r) => (
                  <tr key={r.id} data-late={Boolean(r.vendorNegative)}>
                    <td>
                      <span className="ao-stack">
                        <span className="num ao-strong">{r.subOrder.subOrderNumber}</span>
                        <span className="ao-stack__sub">{when(r.createdAt, locale)}</span>
                      </span>
                    </td>
                    <td data-label={t('للمشتري', 'To buyer')} className="end">
                      <span className="money num">{money(r.amountMinorUnits, r.currency, locale)}</span>
                    </td>
                    <td data-label={t('على البائع', 'Charged to seller')} className="end">
                      <span className="ao-stack ao-stack--end">
                        {r.vendorChargeMinorUnits ? <span className="money num">{money(r.vendorChargeMinorUnits, r.subOrder.settlementCurrency, locale)}</span> : '—'}
                        {r.vendorNegative ? (
                          <span className="ao-rownote">
                            <Icon name="alert" size={13} />
                            <span>
                              {t('رصيد', 'Balance of')} {r.subOrder.vendor.nameAr} {t('سالب:', 'is negative:')}{' '}
                              <span className="num">{money(r.vendorNegative, r.subOrder.settlementCurrency, locale)}</span>
                            </span>
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td data-label={t('السبب', 'Reason')} className="wrap">
                      {r.reason}
                    </td>
                    <td data-label={t('الحالة', 'Status')}>
                      <span className={`badge ${r.status === 'succeeded' ? 'badge--approved' : 'badge--warning'}`}>{localized(locale, REFUND_STATUS, REFUND_STATUS_EN)[r.status] ?? r.status}</span>
                    </td>
                    <td data-label={t('المرجع', 'Reference')} className="num">
                      {r.providerRefundId?.replace(/^manual:/, '') ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <MoreButton list={refunds} />
      </section>
    </div>
  );
}
