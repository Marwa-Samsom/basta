'use client';

import { Fragment, useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { useMe } from '@/components/admin-context';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { EmptyState, TextInput } from '@/components/ui';
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
  /** مالك المنصة — لا يغيّره غيره */
  isOwner: boolean;
}

interface Perm {
  code: string;
  labelAr: string;
  hint: string;
}

const FILTERS = [
  { key: 'all', label: 'الكل', test: () => true },
  { key: 'tfa_off', label: 'بلا تحقّق بخطوتين', test: (u: Admin) => !u.twoFactor },
];

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
  const ask = useConfirm();
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<Record<string, string[]>>({});
  const [showGrant, setShowGrant] = useState(false);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  if (!data || !perms) return <Loading error={error} forbidden={forbidden} />;

  // لا يُمنح ولا يُسحب إلا ما يحمله المدير نفسه — والمالك وحده فوق ذلك (الخادم يفرضه)
  const iAmOwner = data.some((u) => u.id === me.userId && u.isOwner);
  const mine = (code: string) => iAmOwner || me.permissions.includes(code);
  const checkboxes = (value: string[], onChange: (v: string[]) => void) => (
    <div className="stack stack--tight">
      {perms.map((p) => (
        <label key={p.code} className="ac2-check">
          <input
            type="checkbox"
            checked={value.includes(p.code)}
            disabled={!mine(p.code)}
            title={mine(p.code) ? undefined : 'لا تحمل هذه الصلاحية — يمنحها مالك المنصة'}
            onChange={(e) => onChange(e.target.checked ? [...value, p.code] : value.filter((x) => x !== p.code))}
          />
          <span>
            <strong>{p.labelAr}</strong> <span className="muted">— {p.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );

  const test = FILTERS.find((x) => x.key === filter)?.test ?? (() => true);
  const term = q.trim().toLowerCase();
  const shown = data.filter(test).filter((u) => !term || (u.fullName ?? '').toLowerCase().includes(term) || (u.email ?? '').toLowerCase().includes(term));

  return (
    <div className="ac2-page">
      <AdminHeader title="مستخدمو الإدارة" hint="الصلاحيات لكل مدير على حدة، وتغييرها يُنهي جلساته ليدخل بها الجديدة." />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="تصفية المديرين">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}>
              {x.label}
              <span className="tabs__count">{data.filter(x.test).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input type="search" className="field__control" placeholder="ابحث بالاسم أو البريد" aria-label="ابحث بالاسم أو البريد" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" aria-expanded={showGrant} onClick={() => setShowGrant((v) => !v)}>
            <Icon name="plus" size={15} />
            منح الإدارة
          </button>
        </div>
      </div>

      <div className="alert alert--warning ac2-callout">
        <Icon name="lock" size={16} />
        <span>التحقّق بخطوتين إلزامي لكل حساب إدارة — الحساب بلا تفعيل يُحوَّل إلى شاشة التفعيل عند أول دخول ولا يستطيع فتح أي شاشة قبلها.</span>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      {showGrant ? (
        <section className="card" aria-label="منح الإدارة">
          <h2 className="ac2-title">منح الإدارة</h2>
          <p className="ac2-hint">ينشئ الشخص حسابه من صفحة التسجيل أولاً، ثم تمنحه هنا. التحقق الثنائي إلزامي عند أول دخول.</p>
          <TextInput label="بريد الحساب" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <fieldset className="ac2-divider">
            <legend className="field__label">الصلاحيات — كل صلاحية بشرحها</legend>
            {checkboxes(picked, setPicked)}
          </fieldset>
          <div className="ac2-form__actions">
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
              امنح الإدارة
            </button>
          </div>
        </section>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="users"
          title="لا مستخدمين بهذه التصفية"
          actions={
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
              أزل التصفية
            </button>
          }
        >
          جرّب تصفية أخرى.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table ac2-users">
            <thead>
              <tr>
                <th scope="col">المدير</th>
                <th scope="col">البريد</th>
                <th scope="col">التحقّق بخطوتين</th>
                <th scope="col">الصلاحيات</th>
                <th scope="col">آخر دخول</th>
                <th scope="col" className="end">
                  <span className="visually-hidden">إجراء</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <Fragment key={u.id}>
                  <tr data-tone={u.twoFactor ? undefined : 'warning'}>
                    <td>
                      <span className="ac2-cell">
                        <span className="ac2-cell__main">{u.fullName ?? '—'}</span>
                        {u.id === me.userId ? <span className="ac2-cell__sub">أنت</span> : null}
                        {u.isOwner ? <span className="badge badge--brand">مالك المنصة</span> : null}
                      </span>
                    </td>
                    <td className="num" data-label="البريد">
                      {u.email}
                    </td>
                    <td data-label="التحقّق بخطوتين">{u.twoFactor ? <span className="badge badge--success">مفعّل</span> : <span className="badge badge--danger">غير مفعّل</span>}</td>
                    <td className="wrap ac2-muted-cell" data-label="الصلاحيات">
                      {editing[u.id] ? (
                        <div className="stack">
                          {checkboxes(editing[u.id]!, (v) => setEditing({ ...editing, [u.id]: v }))}
                          <div className="ac2-form__actions">
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
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(({ [u.id]: _, ...rest }) => rest)}>
                              تراجع
                            </button>
                          </div>
                        </div>
                      ) : (
                        u.permissions.map((p) => perms.find((x) => x.code === p)?.labelAr ?? p).join(' · ') || '—'
                      )}
                    </td>
                    <td className="ac2-muted-cell" data-label="آخر دخول">
                      {u.lastLoginAt ? when(u.lastLoginAt) : 'لم يدخل بعد'}
                    </td>
                    <td className="end" data-label="">
                      <span className="ac2-actions">
                        {!editing[u.id] && (!u.isOwner || u.id === me.userId) ? (
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing({ ...editing, [u.id]: u.permissions })}>
                            الصلاحيات
                          </button>
                        ) : null}
                        {u.id !== me.userId && !u.isOwner ? (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={act.busy}
                            onClick={async () => {
                              const sure = await ask({
                                title: `تسحب الإدارة من ${u.email}؟`,
                                body: 'تسقط صلاحياته الإدارية كلها ويُسجَّل خروجه من كل أجهزته. حسابه نفسه يبقى.',
                                confirmLabel: 'اسحب الإدارة',
                                danger: true,
                              });
                              if (!sure) return;
                              void act.run(async () => {
                                await api(`/admin/users/${u.id}/revoke`, { method: 'POST' });
                                reload();
                              }, 'سُحبت الإدارة.');
                            }}
                          >
                            <Icon name="x" size={14} />
                            سحب الإدارة
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                  {!u.twoFactor ? (
                    <tr className="ac2-rownote" data-tone="warning">
                      <td colSpan={6} data-label="">
                        <span className="alert alert--warning ac2-callout ac2-callout--sm">
                          <Icon name="info" size={14} />
                          <span>لم يفعّل التحقّق بخطوتين — سيُحوَّل إلى شاشة التفعيل الإلزامي عند أول دخول ولا يمكنه تخطّيها.</span>
                        </span>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
