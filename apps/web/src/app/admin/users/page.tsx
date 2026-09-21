'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { useMe } from '@/components/admin-context';
import { Card, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminData } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Admin {
  id: string;
  email: string | null;
  fullName: string | null;
  status: string;
  twoFactor: boolean;
  lastLoginAt: string | null;
  permissions: string[];
}

interface Perm {
  code: string;
  labelAr: string;
  hint: string;
}

/**
 * AD-23 — مستخدمو الإدارة. الإدارة تُمنح لحساب قائم (ينشئه صاحبه بنفسه فلا
 * تمرّ كلمة مرور بيد أحد)، والتحقق الثنائي يُفرض عند أول دخول. تغيير
 * الصلاحيات يُنهي جلسات صاحبها ليدخل بها الجديدة.
 */
export default function AdminUsersPage() {
  const me = useMe();
  const { data, error, forbidden, reload } = useAdminData<Admin[]>('/admin/users');
  const { data: perms } = useAdminData<Perm[]>('/admin/permissions');
  const act = useAction();
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<Record<string, string[]>>({});
  if (!data || !perms) return <Loading error={error} forbidden={forbidden} />;

  const checkboxes = (value: string[], onChange: (v: string[]) => void) => (
    <div className="stack stack--tight">
      {perms.map((p) => (
        <label key={p.code} className="row small" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={value.includes(p.code)} onChange={(e) => onChange(e.target.checked ? [...value, p.code] : value.filter((x) => x !== p.code))} />
          <span>
            <strong>{p.labelAr}</strong> <span className="muted">— {p.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="stack stack--loose">
      <AdminHeader title="مستخدمو الإدارة" />
      <Feedback error={act.error} notice={act.notice} />

      <Card title="منح الإدارة" hint="ينشئ الشخص حسابه من صفحة التسجيل أولاً، ثم تمنحه هنا. التحقق الثنائي إلزامي عند أول دخول.">
        <div className="stack">
          <TextInput label="بريد الحساب" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {checkboxes(picked, setPicked)}
          <button
            type="button"
            className="btn btn--primary"
            disabled={act.busy || !email.includes('@') || picked.length === 0}
            onClick={() =>
              void act.run(async () => {
                await api('/admin/users/grant', { method: 'POST', body: { email, permissions: picked } });
                setEmail('');
                setPicked([]);
                reload();
              }, 'مُنحت الإدارة.')
            }
          >
            منح
          </button>
        </div>
      </Card>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>المدير</th>
              <th>التحقق الثنائي</th>
              <th>الصلاحيات</th>
              <th>آخر دخول</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.fullName}
                  <div className="small muted" dir="ltr">
                    {u.email}
                  </div>
                </td>
                <td>{u.twoFactor ? <span className="badge badge--approved">مفعّل</span> : <span className="badge badge--warning">عند أول دخول</span>}</td>
                <td className="wrap small">
                  {editing[u.id] ? (
                    <div className="stack">
                      {checkboxes(editing[u.id]!, (v) => setEditing({ ...editing, [u.id]: v }))}
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={act.busy}
                        onClick={() =>
                          void act.run(async () => {
                            await api(`/admin/users/${u.id}/permissions`, { method: 'PUT', body: { permissions: editing[u.id] } });
                            setEditing(({ [u.id]: _, ...rest }) => rest);
                            reload();
                          }, 'حُدّثت الصلاحيات وأُنهيت جلساته.')
                        }
                      >
                        حفظ
                      </button>
                    </div>
                  ) : (
                    u.permissions.map((p) => perms.find((x) => x.code === p)?.labelAr ?? p).join('، ') || '—'
                  )}
                </td>
                <td className="small">{when(u.lastLoginAt)}</td>
                <td>
                  <div className="row">
                    {!editing[u.id] ? (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing({ ...editing, [u.id]: u.permissions })}>
                        تعديل
                      </button>
                    ) : null}
                    {u.id !== me.userId ? (
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={act.busy}
                        onClick={() => {
                          if (!window.confirm(`سحب الإدارة من ${u.email}؟`)) return;
                          void act.run(async () => {
                            await api(`/admin/users/${u.id}/revoke`, { method: 'POST' });
                            reload();
                          }, 'سُحبت الإدارة.');
                        }}
                      >
                        سحب الإدارة
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
