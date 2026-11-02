'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, MoreButton, ReasonButton, SearchBox, SortButton, Tabs } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui';
import { api } from '@/lib/api';
import { PARENT_STATUS, useAction, useAdminData, useAdminList } from '@/lib/admin';
import { ORDERS, counted } from '@/lib/arabic-count';
import { historyReason, labelOf, money, PAYMENT_STATUS, REFUND_STATUS, toneOf, when, type SubOrderView } from '@/lib/orders';

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
      <AdminHeader title="الطلبات" count={data ? counted(data.total, ORDERS) : undefined} />
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={(v) => setFilter({ status: v, due: false })}
          label="حالة الطلب"
          options={[{ key: '', label: 'الكل' }, ...['processing', 'partially_completed', 'completed', 'canceled', 'refunded', 'payment_failed'].map((k) => ({ key: k, label: PARENT_STATUS[k]! }))]}
        />
        <div className="toolbar__end">
          <SearchBox value={search} onChange={setSearch} placeholder="رقم الطلب، بريد العميل، أو المتجر" label="بحث في الطلبات" />
          <SortButton value={sort} onChange={setSort} />
        </div>
      </div>
      {due ? (
        <Alert tone="warning" title="طلبات قاربت مهلة القبول">
          <p>
            متاجر لم تقبل طلبها وبقي على انقضاء مهلتها أقل من 12 ساعة — بعدها يُلغى آلياً ويُردّ المبلغ. ذكّر المتجر أو
            ألغِ بنفسك.
          </p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setFilter({ due: false })}>
            اعرض كل الطلبات
          </button>
        </Alert>
      ) : null}
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <Empty
          icon="truck"
          title={due ? 'لا طلب قاربت مهلة قبوله' : 'لا طلبات بهذه التصفية'}
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
                أزل التصفية
              </button>
            ) : undefined
          }
        >
          وسّع التصفية أو ابحث برقم آخر.
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>الطلب</th>
                <th>العميل</th>
                <th>المتاجر</th>
                <th>الحالة</th>
                <th className="end">الإجمالي</th>
                <th>التاريخ</th>
                <th className="end">
                  <span className="visually-hidden">الإجراء</span>
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
                      <td data-label="العميل">
                        <span className="ao-stack">
                          <span className="ao-strong">{o.customer?.fullName ?? o.guestEmail ?? 'ضيف'}</span>
                          <span className="ao-stack__sub">{o.subOrders.map((s) => s.vendor.nameAr).join('، ')}</span>
                          {o.subOrders
                            .filter((s) => s.acceptanceDue && s.acceptBy)
                            .map((s) => (
                              <span key={s.id} className="ao-stack__sub ao-due">
                                <Icon name="clock" size={12} />
                                {s.vendor.nameAr}: يُلغى آلياً <span className="num">{when(s.acceptBy!)}</span>
                              </span>
                            ))}
                        </span>
                      </td>
                      <td data-label="المتاجر" className="num">
                        {o.subOrders.length}
                      </td>
                      <td data-label="الحالة">
                        <span className={`badge ${PARENT_TONE[o.status] ?? 'badge--pending'}`}>{PARENT_STATUS[o.status] ?? o.status}</span>
                      </td>
                      <td data-label="الإجمالي" className="end">
                        <span className="money num">{money(o.grandTotalMinorUnits, o.currency)}</span>
                      </td>
                      <td data-label="التاريخ" className="ao-date">
                        {when(o.placedAt)}
                      </td>
                      <td data-label="" className="end">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          aria-expanded={open}
                          aria-controls={`order-${o.orderNumber}`}
                          onClick={() => setOpenNumber(open ? null : o.orderNumber)}
                        >
                          {open ? 'أغلق' : 'افتح'}
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
  const { data, error, reload } = useAdminData<Detail>(`/admin/orders/${number}`);
  const act = useAction();
  if (!data) return <Loading error={error} inline />;
  return (
    <div className="ao-order">
      <Feedback error={act.error} notice={act.notice} />
      <p className="ao-order__pay">
        <Icon name="card" size={14} />
        الدفع: {data.paymentStatus ? (PAYMENT_STATUS[data.paymentStatus] ?? data.paymentStatus) : '—'}
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
              <span className={`badge ${toneOf(s.status)}`}>{labelOf(s.status)}</span>
            </header>
            <ol className="ao-timeline">
              {s.history.map((h, i) => (
                <li key={i}>
                  <span className="ao-timeline__what">{h.toLabel}</span>
                  <span className="ao-timeline__when">{when(h.createdAt)}</span>
                  {h.reason ? <span className="ao-timeline__why">«{historyReason(h)}»</span> : null}
                </li>
              ))}
            </ol>
            {s.shipment ? (
              <p className="ao-sub__line">
                <Icon name="truck" size={14} />
                التتبّع: <span className="num">{s.shipment.trackingNumber}</span>
              </p>
            ) : null}
            {s.refunds.length ? (
              <p className="ao-sub__line">
                <Icon name="return" size={14} />
                <span>
                  استردادات:{' '}
                  {s.refunds.map((r, i) => (
                    <Fragment key={i}>
                      {i ? '، ' : ''}
                      <span className="money num">{money(r.amountMinorUnits, data.currency)}</span> ({REFUND_STATUS[r.status] ?? r.status})
                    </Fragment>
                  ))}
                </span>
              </p>
            ) : null}
            {s.actions.includes('canceled_by_admin') ? (
              <div className="ao-sub__actions">
                <ReasonButton
                  label="إلغاء هذا المتجر ورد المبلغ"
                  presets={['نفاد المخزون لدى البائع', 'احتيال مشتبه في الطلب', 'البائع لا يستجيب']}
                  disabled={act.busy}
                  onSubmit={(r) =>
                    act.run(async () => {
                      await api(`/admin/orders/stores/${s.id}/cancel`, { method: 'POST', body: { reason: r } });
                      reload();
                      onChange();
                    }, 'أُلغي ويُردّ المبلغ للمشتري.')
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
