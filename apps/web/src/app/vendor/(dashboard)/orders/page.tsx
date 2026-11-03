'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, EmptyState, MoreButton, PageHead, SortButton, type SortOrder } from '@/components/ui';
import { AcceptCountdown } from '@/components/accept-countdown';
import { Icon } from '@/components/icons';
import { useAdminList } from '@/lib/admin';
import { counted, type Counted } from '@/lib/arabic-count';
import { hoursAr, labelOf, money, toneOf, when } from '@/lib/orders';
import { useLocale, useT } from '@/components/locale';

/** «طلب واحد ينتظر قبولك»، «طلبان ينتظران قبولك»، «4 طلبات تنتظر قبولك»، «11 طلباً ينتظر قبولك» */
const WAITING: Counted = {
  one: 'طلب واحد ينتظر قبولك',
  two: 'طلبان ينتظران قبولك',
  plural: '# طلبات تنتظر قبولك',
  accusative: '# طلباً ينتظر قبولك',
  genitive: '# طلب ينتظر قبولك',
};

interface Row {
  id: string;
  number: string;
  status: string;
  currency: string;
  totalMinorUnits: string;
  netMinorUnits: string;
  placedAt: string;
  itemCount: number;
  buyer: string | null;
}


/**
 * التبويبات بترتيب العمل اليومي: ما ينتظرك أولاً، ثم ما انتهى. كل حالة لها
 * تبويب — طلب في حالة بلا تبويب كان يُعدّ في «الكل» ولا يظهر في غيره. الحالات
 * الأربع التي يخرج بها الطلب ملغى أو مردود المال تجتمع في تبويب واحد.
 */
const TABS: { statuses: string[]; label: string; en: string }[] = [
  { statuses: [], label: 'الكل', en: 'All' },
  ...(['awaiting_vendor', 'accepted', 'preparing', 'ready_to_ship', 'shipped', 'delivery_failed', 'delivered', 'return_requested', 'returned', 'completed'] as const).map(
    (s) => ({ statuses: [s], label: labelOf(s), en: labelOf(s, 'en') }),
  ),
  { statuses: ['rejected_by_vendor', 'canceled_by_customer', 'canceled_by_admin', 'refunded'], label: 'ملغى أو مُسترَد', en: 'Canceled or refunded' },
];

/**
 * VD-12 — طلبات المتجر.
 *
 * البائع يرى فرعيّه وحده: رقمه وحالته وصافيه بعملته. «بانتظار القبول» أعلى
 * التبويبات بعدّاده لأن مهلة القبول 48 ساعة ثم يُلغى الطلب آلياً.
 *
 * عشرون في الصفحة و«المزيد» لما بعدها (20 أكتوبر 2026) — كانت القائمة أول عشرين بلا غيرها.
 * والبحث برقم الطلب أو اسم المستلم أو منتج فيه.
 */
export default function VendorOrdersPage() {
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const q = new URLSearchParams({ sort });
  if (tab) q.set('status', tab);
  if (search.trim()) q.set('search', search.trim());
  const list = useAdminList<Row, { counts: Record<string, number>; acceptanceHours: number }>(`/vendor/orders?${q}`, (r) => r.id);
  const { data, error } = list;

  const waiting = data?.counts['awaiting_vendor'] ?? 0;
  const all = data ? Object.values(data.counts).reduce((a, n) => a + n, 0) : 0;
  const filtered = Boolean(tab || search.trim());

  return (
    <div className="vm-page">
      <PageHead
        title={t('الطلبات', 'Orders')}
        count={
          data
            ? t(
                `الطلبات الفرعية ${all} · بانتظار قبولك ${waiting}`,
                `${all} shop ${all === 1 ? 'order' : 'orders'} · ${waiting} awaiting your acceptance`,
              )
            : undefined
        }
        actions={
          <>
            <span className="input-icon vm-search">
              <Icon name="search" size={16} />
              <input
                className="field__control"
                type="search"
                placeholder={t('رقم الطلب أو المستلم أو المنتج', 'Order number, recipient or product')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t('ابحث في الطلبات', 'Search orders')}
              />
            </span>
            <SortButton value={sort} onChange={setSort} />
          </>
        }
      />

      {waiting > 0 ? (
        <Alert
          tone="warning"
          title={t(
            counted(waiting, WAITING),
            `${waiting} ${waiting === 1 ? 'order is' : 'orders are'} awaiting your acceptance`,
          )}
        >
          {/* المهلة كما تضبطها الإدارة لا «48» ثابتة (VOPS-019) */}
          {t(
            `الطلب الذي لا يُقبل خلال ${hoursAr(data?.acceptanceHours ?? 48)} يُلغى آلياً ويُردّ مال المشتري.`,
            `An order not accepted within ${hoursAr(data?.acceptanceHours ?? 48, locale)} is canceled automatically and the buyer is refunded.`,
          )}
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <section className="card card--flush">
        <div className="tabs vm-tabs" role="tablist" aria-label={t('حالة الطلب', 'Order status')}>
          {TABS.map((tb) => {
            const key = tb.statuses.join(',');
            const count = tb.statuses.length ? tb.statuses.reduce((n, s) => n + (data?.counts[s] ?? 0), 0) : all;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                className="tabs__tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {t(tb.label, tb.en)}
                {data ? <span className="tabs__count">{count}</span> : null}
              </button>
            );
          })}
        </div>

        {!data && !error ? (
          <div className="vm-loading" role="status">
            <span className="visually-hidden">{t('جارٍ جلب الطلبات…', 'Loading orders…')}</span>
            <span className="skeleton vm-loading__row" />
            <span className="skeleton vm-loading__row" />
            <span className="skeleton vm-loading__row" />
          </div>
        ) : null}

        {data ? (
          data.items.length === 0 ? (
            <EmptyState
              icon="truck"
              title={filtered ? t('لا طلبات في هذه المرحلة', 'No orders at this stage') : t('لا طلبات بعد', 'No orders yet')}
              actions={
                filtered ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      setTab('');
                      setSearch('');
                    }}
                  >
                    {t('أزل التصفية', 'Clear filters')}
                  </button>
                ) : undefined
              }
            >
              {filtered
                ? t('جرّب مرحلة أخرى من الأعلى، أو ابحث برقم أو اسم آخر.', 'Try another stage above, or search for a different number or name.')
                : t(
                    'تصلك الطلبات هنا فور شراء أحدهم من متجرك، والجديد منها أولاً مع مهلة القبول.',
                    'Orders arrive here as soon as someone buys from your shop, newest first, with their acceptance deadline.',
                  )}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table vm-table">
                <thead>
                  <tr>
                    <th>{t('الطلب الفرعي', 'Shop order')}</th>
                    <th>{t('التاريخ', 'Date')}</th>
                    <th>{t('المستلم', 'Recipient')}</th>
                    <th className="end">{t('القطع', 'Items')}</th>
                    <th className="end">{t('الإجمالي', 'Total')}</th>
                    <th className="end">{t('صافيك', 'Your net')}</th>
                    <th>{t('الحالة', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((r) => (
                    <tr key={r.id} data-status={r.status}>
                      <td data-label={t('الطلب الفرعي', 'Shop order')}>
                        <Link href={`/vendor/orders/${r.id}`} className="num vm-order-link">
                          {r.number}
                        </Link>
                      </td>
                      <td data-label={t('التاريخ', 'Date')} className="vm-muted">
                        {when(r.placedAt, locale)}
                      </td>
                      <td data-label={t('المستلم', 'Recipient')} className="vm-strong">
                        {r.buyer ?? '—'}
                      </td>
                      <td data-label={t('القطع', 'Items')} className="num end">
                        {r.itemCount}
                      </td>
                      <td data-label={t('الإجمالي', 'Total')} className="money num end">
                        {money(r.totalMinorUnits, r.currency, locale)}
                      </td>
                      <td data-label={t('صافيك', 'Your net')} className="money num end">
                        {money(r.netMinorUnits, r.currency, locale)}
                      </td>
                      <td data-label={t('الحالة', 'Status')}>
                        <span className={`badge ${toneOf(r.status)}`}>{labelOf(r.status, locale)}</span>
                        {/* ما بقي قبل الإلغاء الآلي: الوصول + المهلة كما تضبطها الإدارة (VOPS-003) */}
                        {r.status === 'awaiting_vendor' && data ? (
                          <AcceptCountdown by={new Date(new Date(r.placedAt).getTime() + data.acceptanceHours * 3_600_000)} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
        <MoreButton list={list} />
      </section>
    </div>
  );
}
