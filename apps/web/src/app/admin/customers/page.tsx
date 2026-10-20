'use client';

import { Fragment, useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, MoreButton, ReasonButton, SearchBox } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { PARENT_STATUS, TONE, useAction, useAdminData, useAdminList } from '@/lib/admin';
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
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useAdminList<Row>(`/admin/customers${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`, (c) => c.id);
  const { data, error, forbidden, reload } = list;

  return (
    <div className="ao-page">
      <AdminHeader title="العملاء" count={data ? `${data.total} عميل` : undefined} />
      <div className="toolbar">
        <div className="toolbar__end">
          <SearchBox value={search} onChange={setSearch} placeholder="الاسم أو البريد أو الهاتف" label="بحث في العملاء" />
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <Empty
          icon="users"
          title={search.trim() ? 'لا عملاء بهذا البحث' : 'لا عملاء بعد'}
          actions={
            search.trim() ? (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>
                أزل التصفية
              </button>
            ) : undefined
          }
        >
          {search.trim() ? 'جرّب اسماً آخر أو ابحث بالبريد أو الجوال.' : 'يظهر العملاء هنا بمجرّد تسجيلهم.'}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>التواصل</th>
                <th className="end">الطلبات</th>
                <th>التسجيل</th>
                <th>الحالة</th>
                <th className="end">
                  <span className="visually-hidden">الإجراء</span>
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
                      <td data-label="التواصل">
                        <span className="ao-stack">
                          <span className="num">{c.email}</span>
                          <span className="ao-stack__sub num">{c.phone}</span>
                        </span>
                      </td>
                      <td data-label="الطلبات" className="end num">
                        {c.orders}
                      </td>
                      <td data-label="التسجيل" className="ao-date">
                        {when(c.createdAt)}
                      </td>
                      <td data-label="الحالة">
                        <span className={`badge ${TONE[c.status] ?? ''}`}>{c.status === 'active' ? 'نشط' : c.status === 'suspended' ? 'معلَّق' : c.status}</span>
                      </td>
                      <td data-label="" className="end">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          aria-expanded={open}
                          aria-controls={`customer-${c.id}`}
                          onClick={() => setOpenId(open ? null : c.id)}
                        >
                          الملف
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
          <span className="ao-fact__k">آخر دخول</span>
          <span className="ao-fact__v">{when(data.lastLoginAt)}</span>
        </span>
        <span className="ao-fact">
          <span className="ao-fact__k">نزاعات</span>
          <span className="ao-fact__v num">{data.disputes}</span>
        </span>
      </div>
      {data.orders.length ? (
        <ul className="ao-olist">
          {data.orders.map((o) => (
            <li key={o.orderNumber}>
              <span className="num ao-strong">{o.orderNumber}</span>
              <span className="muted">{PARENT_STATUS[o.status] ?? o.status}</span>
              <span className="money num">{money(o.grandTotalMinorUnits, o.currency)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ao-cprofile__actions">
        {data.status === 'active' ? (
          <ReasonButton
            label="تعليق الحساب"
            icon="lock"
            disabled={act.busy}
            hint="تُنهى جلساته فوراً ولا يستطيع الدخول. الطلبات القائمة تكمل."
            onSubmit={(r) =>
              act.run(async () => {
                await api(`/admin/customers/${id}/suspend`, { method: 'POST', body: { reason: r } });
                done();
              }, 'عُلِّق الحساب.')
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
              }, 'أُعيد الحساب.')
            }
          >
            <Icon name="refresh" size={14} />
            إعادة التفعيل
          </button>
        )}
        {/* الطريق الأخير لمن أضاع هاتفه ورموز استعادته — لا يظهر لحساب مدير (الخادم يرفضه أصلاً) */}
        {data.totpResettable ? (
          <ReasonButton
            label="أعد ضبط التحقق بخطوتين"
            icon="shield"
            min={10}
            disabled={act.busy}
            hint="يُمحى ربط تطبيق المصادقة ورموز الاستعادة، وتُنهى كل جلساته، ويصله بريد بذلك. اكتب كيف تحقّقت من هويته — يُحفظ في سجل التدقيق."
            onSubmit={(r) =>
              act.run(async () => {
                await api(`/admin/customers/${id}/reset-2fa`, { method: 'POST', body: { reason: r } });
                done();
              }, 'أُعيد ضبط التحقق بخطوتين.')
            }
          />
        ) : null}
      </div>
    </div>
  );
}
