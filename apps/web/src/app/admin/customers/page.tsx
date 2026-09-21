'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, ReasonButton } from '@/components/admin';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { PARENT_STATUS, TONE, useAction, useAdminData } from '@/lib/admin';
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
  orders: { orderNumber: string; status: string; currency: string; grandTotalMinorUnits: string; placedAt: string }[];
}

/** AD-21 — العملاء: بحث، وملف بطلباته ونزاعاته، وتعليق بسبب يُنهي جلساته فوراً */
export default function AdminCustomersPage() {
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, forbidden, reload } = useAdminData<{ items: Row[]; total: number }>(`/admin/customers${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`);

  return (
    <div className="stack stack--loose">
      <AdminHeader title="العملاء" hint={data ? `${data.total} عميل` : undefined}>
        <input className="field__control" placeholder="الاسم أو البريد أو الهاتف" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="بحث" />
      </AdminHeader>
      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.items.length === 0 ? (
        <Card>
          <Empty>لا نتائج.</Empty>
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>التواصل</th>
                <th>الطلبات</th>
                <th>التسجيل</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                      {c.fullName ?? '—'}
                    </button>
                    {openId === c.id ? <CustomerProfile id={c.id} onChange={reload} /> : null}
                  </td>
                  <td className="small" dir="ltr">
                    {c.email}
                    <div>{c.phone}</div>
                  </td>
                  <td className="num">{c.orders}</td>
                  <td className="small">{when(c.createdAt)}</td>
                  <td>
                    <span className={`badge ${TONE[c.status] ?? ''}`}>{c.status === 'active' ? 'نشط' : c.status === 'suspended' ? 'معلَّق' : c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CustomerProfile({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, error, reload } = useAdminData<Profile>(`/admin/customers/${id}`);
  const act = useAction();
  if (!data) return <Loading error={error} />;
  const done = () => {
    reload();
    onChange();
  };
  return (
    <div className="card stack stack--tight small">
      <Feedback error={act.error} notice={act.notice} />
      <div>آخر دخول: {when(data.lastLoginAt)} · نزاعات: {data.disputes}</div>
      <ul className="stack stack--tight">
        {data.orders.map((o) => (
          <li key={o.orderNumber}>
            <span className="num">{o.orderNumber}</span> · {PARENT_STATUS[o.status] ?? o.status} · <span className="money">{money(o.grandTotalMinorUnits, o.currency)}</span>
          </li>
        ))}
      </ul>
      {data.status === 'active' ? (
        <ReasonButton
          label="تعليق الحساب"
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
          إعادة التفعيل
        </button>
      )}
    </div>
  );
}
