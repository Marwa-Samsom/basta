'use client';

import { Fragment, useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, MoreButton, ReasonButton, SearchBox, SortButton } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { api } from '@/lib/api';
import { PARENT_STATUS, PARENT_STATUS_EN, TONE, useAction, useAdminData, useAdminList } from '@/lib/admin';
import { localized } from '@/lib/i18n';
import { money, when } from '@/lib/orders';

interface Row {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  orders: number;
}

interface Profile extends Omit<Row, 'orders'> {
  disputes: number;
  totpEnabled: boolean;
  /** مفعَّل وليس حساب مدير — الوحيد الذي يُعاد ضبطه من هنا */
  totpResettable: boolean;
  orders: { orderNumber: string; status: string; currency: string; grandTotalMinorUnits: string; placedAt: string }[];
}

/** AD-21 — العملاء: بحث، وملف بطلباته ونزاعاته، وتعليق بسبب يُنهي جلساته فوراً */
export default function AdminCustomersPage() {
  const t = useT();
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  // بتاريخ التسجيل
  const [sort, setSort] = useState<SortOrder>('newest');
  const query = new URLSearchParams({ sort, ...(search.trim() ? { q: search.trim() } : {}) });
  const list = useAdminList<Row>(`/admin/customers?${query}`, (c) => c.id);
  const { data, error, forbidden, reload } = list;

  return (
    <div className="ao-page">
      <AdminHeader title={t('العملاء', 'Customers')} count={data ? t(`${data.total} عميل`, `${data.total} ${data.total === 1 ? 'customer' : 'customers'}`) : undefined} />
      <div className="toolbar">
        <div className="toolbar__end">
          <SearchBox value={search} onChange={setSearch} placeholder={t('الاسم أو البريد أو الهاتف', 'Name, email or phone')} label={t('بحث في العملاء', 'Search customers')} />
          <SortButton value={sort} onChange={setSort} />
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <Empty
          icon="users"
          title={search.trim() ? t('لا عملاء بهذا البحث', 'No customers match this search') : t('لا عملاء بعد', 'No customers yet')}
          actions={
            search.trim() ? (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>
                {t('أزل التصفية', 'Clear filter')}
              </button>
            ) : undefined
          }
        >
          {search.trim() ? t('جرّب اسماً آخر أو ابحث بالبريد أو الجوال.', 'Try another name or search by email or mobile.') : t('يظهر العملاء هنا بمجرّد تسجيلهم.', 'Customers appear here as soon as they sign up.')}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>{t('العميل', 'Customer')}</th>
                <th>{t('التواصل', 'Contact')}</th>
                <th className="end">{t('الطلبات', 'Orders')}</th>
                <th>{t('التسجيل', 'Signed up')}</th>
                <th>{t('الحالة', 'Status')}</th>
                <th className="end">
                  <span className="visually-hidden">{t('الإجراء', 'Action')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((c) => {
                const open = openId === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr data-open={open}>
                      <td className="ao-strong">{c.fullName ?? '—'}</td>
                      <td data-label={t('التواصل', 'Contact')}>
                        <span className="ao-stack">
                          <span className="num">{c.email}</span>
                          <span className="ao-stack__sub num">{c.phone}</span>
                        </span>
                      </td>
                      <td data-label={t('الطلبات', 'Orders')} className="end num">
                        {c.orders}
                      </td>
                      <td data-label={t('التسجيل', 'Signed up')} className="ao-date">
                        {when(c.createdAt, locale)}
                      </td>
                      <td data-label={t('الحالة', 'Status')}>
                        <span className={`badge ${TONE[c.status] ?? ''}`}>{c.status === 'active' ? t('نشط', 'Active') : c.status === 'suspended' ? t('معلَّق', 'Suspended') : c.status}</span>
                      </td>
                      <td data-label="" className="end">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          aria-expanded={open}
                          aria-controls={`customer-${c.id}`}
                          onClick={() => setOpenId(open ? null : c.id)}
                        >
                          {t('الملف', 'Profile')}
                          <Icon name="chev-down" size={14} className={open ? 'ao-flip' : ''} />
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="ao-detail-row">
                        <td colSpan={6} id={`customer-${c.id}`}>
                          <CustomerProfile id={c.id} onChange={reload} />
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

function CustomerProfile({ id, onChange }: { id: string; onChange: () => void }) {
  const t = useT();
  const locale = useLocale();
  const parentStatus = localized(locale, PARENT_STATUS, PARENT_STATUS_EN);
  const { data, error, reload } = useAdminData<Profile>(`/admin/customers/${id}`);
  const act = useAction();
  if (!data) return <Loading error={error} inline />;
  const done = () => {
    reload();
    onChange();
  };
  return (
    <div className="ao-cprofile">
      <Feedback error={act.error} notice={act.notice} />
      <div className="ao-facts">
        <span className="ao-fact">
          <span className="ao-fact__k">{t('آخر دخول', 'Last sign-in')}</span>
          <span className="ao-fact__v">{when(data.lastLoginAt, locale)}</span>
        </span>
        <span className="ao-fact">
          <span className="ao-fact__k">{t('نزاعات', 'Disputes')}</span>
          <span className="ao-fact__v num">{data.disputes}</span>
        </span>
      </div>
      {data.orders.length ? (
        <ul className="ao-olist">
          {data.orders.map((o) => (
            <li key={o.orderNumber}>
              <span className="num ao-strong">{o.orderNumber}</span>
              <span className="muted">{parentStatus[o.status] ?? o.status}</span>
              <span className="money num">{money(o.grandTotalMinorUnits, o.currency, locale)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ao-cprofile__actions">
        {data.status === 'active' ? (
          <ReasonButton
            label={t('تعليق الحساب', 'Suspend account')}
            icon="lock"
            disabled={act.busy}
            hint={t('تُنهى جلساته فوراً ولا يستطيع الدخول. الطلبات القائمة تكمل.', 'Their sessions end immediately and they cannot sign in. Open orders continue.')}
            onSubmit={(r) =>
              act.run(async () => {
                await api(`/admin/customers/${id}/suspend`, { method: 'POST', body: { reason: r } });
                done();
              }, t('عُلِّق الحساب.', 'Account suspended.'))
            }
          />
        ) : (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={act.busy}
            onClick={() =>
              void act.run(async () => {
                await api(`/admin/customers/${id}/reinstate`, { method: 'POST' });
                done();
              }, t('أُعيد الحساب.', 'Account reinstated.'))
            }
          >
            <Icon name="refresh" size={14} />
            {t('إعادة التفعيل', 'Reinstate')}
          </button>
        )}
        {/* الطريق الأخير لمن أضاع هاتفه ورموز استعادته — لا يظهر لحساب مدير (الخادم يرفضه أصلاً) */}
        {data.totpResettable ? (
          <ReasonButton
            label={t('أعد ضبط التحقق بخطوتين', 'Reset two-step verification')}
            icon="shield"
            min={10}
            disabled={act.busy}
            hint={t(
              'يُمحى ربط تطبيق المصادقة ورموز الاستعادة، وتُنهى كل جلساته، ويصله بريد بذلك. اكتب كيف تحقّقت من هويته — يُحفظ في سجل التدقيق.',
              'The authenticator app link and recovery codes are erased, all their sessions end, and they get an email about it. Write how you verified their identity — it is kept in the audit log.',
            )}
            onSubmit={(r) =>
              act.run(async () => {
                await api(`/admin/customers/${id}/reset-2fa`, { method: 'POST', body: { reason: r } });
                done();
              }, t('أُعيد ضبط التحقق بخطوتين.', 'Two-step verification reset.'))
            }
          />
        ) : null}
      </div>
    </div>
  );
}
