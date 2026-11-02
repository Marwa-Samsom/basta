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
import { useLocale, useT } from '@/components/locale';

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
  { key: 'all', label: 'الكل', en: 'All', test: () => true },
  { key: 'tfa_off', label: 'بلا تحقّق بخطوتين', en: 'Without two-step verification', test: (u: Admin) => !u.twoFactor },
];

/** أسماء الصلاحيات وشروحها بالإنجليزية — الخادم يرسلها بالعربية وحدها، فتُقرأ بالرمز */
const PERM_EN: Record<string, { label: string; hint: string }> = {
  'vendors.review': { label: 'Seller review', hint: 'Approve, reject, and suspend shops, and read their documents' },
  'catalog.manage': { label: 'Catalog', hint: 'The attribute library and its values, and monitoring published products and taking down violators' },
  'orders.manage': { label: 'Orders', hint: 'Search orders and step in on stalled returns' },
  'orders.cancel': { label: 'Cancel orders', hint: 'Cancel an order before it ships and refund the buyer' },
  'disputes.resolve': { label: 'Resolve disputes', hint: 'Final decision on an escalated dispute' },
  'payouts.approve': { label: 'Payouts and transfers', hint: "Seller payouts, confirming buyers' transfers arrived, and recording refunds to them — moves money" },
  'commissions.edit': { label: 'Commissions', hint: 'Change rates — they apply to new orders only' },
  'coupons.manage': { label: 'Coupons', hint: 'Create and stop coupons' },
  'content.manage': { label: 'Content and notifications', hint: 'Pages, banners, featured products, notification templates, and product reviews' },
  'customers.manage': { label: 'Customers', hint: 'View and suspend buyer accounts' },
  'settings.edit': { label: 'Settings', hint: 'Platform settings, taxes, and exchange rates — financial impact' },
  'reports.view': { label: 'Reports', hint: 'The dashboard and financial reports, and exporting them' },
  'audit.view': { label: 'Audit log', hint: 'Read the log of who did what and when' },
  'users.manage': { label: 'Admin users', hint: 'Grant and revoke admin permissions' },
};

/**
 * AD-23 — مستخدمو الإدارة. الإدارة تُمنح لحساب قائم (ينشئه صاحبه بنفسه فلا
 * تمرّ كلمة مرور بيد أحد)، والتحقق الثنائي يُفرض عند أول دخول. تغيير
 * الصلاحيات يُنهي جلسات صاحبها ليدخل بها الجديدة.
 */
export default function AdminUsersPage() {
  const t = useT();
  const locale = useLocale();
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
  const permLabel = (p: Perm) => (locale === 'en' && PERM_EN[p.code] ? PERM_EN[p.code]!.label : p.labelAr);
  const permHint = (p: Perm) => (locale === 'en' && PERM_EN[p.code] ? PERM_EN[p.code]!.hint : p.hint);
  const checkboxes = (value: string[], onChange: (v: string[]) => void) => (
    <div className="stack stack--tight">
      {perms.map((p) => (
        <label key={p.code} className="ac2-check">
          <input
            type="checkbox"
            checked={value.includes(p.code)}
            disabled={!mine(p.code)}
            title={mine(p.code) ? undefined : t('لا تحمل هذه الصلاحية — يمنحها مالك المنصة', "You don't hold this permission — the platform owner grants it")}
            onChange={(e) => onChange(e.target.checked ? [...value, p.code] : value.filter((x) => x !== p.code))}
          />
          <span>
            <strong>{permLabel(p)}</strong> <span className="muted">— {permHint(p)}</span>
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
      <AdminHeader
        title={t('مستخدمو الإدارة', 'Admin users')}
        hint={t(
          'الصلاحيات لكل مدير على حدة، وتغييرها يُنهي جلساته ليدخل بها الجديدة.',
          'Permissions are set per admin, and changing them ends their sessions so they sign in with the new ones.',
        )}
      />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label={t('تصفية المديرين', 'Filter admins')}>
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}>
              {t(x.label, x.en)}
              <span className="tabs__count">{data.filter(x.test).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input type="search" className="field__control" placeholder={t('ابحث بالاسم أو البريد', 'Search by name or email')} aria-label={t('ابحث بالاسم أو البريد', 'Search by name or email')} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" aria-expanded={showGrant} onClick={() => setShowGrant((v) => !v)}>
            <Icon name="plus" size={15} />
            {t('منح الإدارة', 'Grant admin')}
          </button>
        </div>
      </div>

      <div className="alert alert--warning ac2-callout">
        <Icon name="lock" size={16} />
        <span>
          {t(
            'التحقّق بخطوتين إلزامي لكل حساب إدارة — الحساب بلا تفعيل يُحوَّل إلى شاشة التفعيل عند أول دخول ولا يستطيع فتح أي شاشة قبلها.',
            'Two-step verification is mandatory for every admin account — an account without it is sent to the setup screen on first sign-in and cannot open any screen before that.',
          )}
        </span>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      {showGrant ? (
        <section className="card" aria-label={t('منح الإدارة', 'Grant admin')}>
          <h2 className="ac2-title">{t('منح الإدارة', 'Grant admin')}</h2>
          <p className="ac2-hint">
            {t(
              'ينشئ الشخص حسابه من صفحة التسجيل أولاً، ثم تمنحه هنا. التحقق الثنائي إلزامي عند أول دخول.',
              'The person creates their account from the sign-up page first, then you grant it here. Two-step verification is mandatory on first sign-in.',
            )}
          </p>
          <TextInput label={t('بريد الحساب', 'Account email')} dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <fieldset className="ac2-divider">
            <legend className="field__label">{t('الصلاحيات — كل صلاحية بشرحها', 'Permissions — each with its explanation')}</legend>
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
                }, t('مُنحت الإدارة.', 'Admin access granted.'))
              }
            >
              {t('امنح الإدارة', 'Grant admin')}
            </button>
          </div>
        </section>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="users"
          title={t('لا مستخدمين بهذه التصفية', 'No users match this filter')}
          actions={
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
              {t('أزل التصفية', 'Clear filters')}
            </button>
          }
        >
          {t('جرّب تصفية أخرى.', 'Try another filter.')}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table ac2-users">
            <thead>
              <tr>
                <th scope="col">{t('المدير', 'Admin')}</th>
                <th scope="col">{t('البريد', 'Email')}</th>
                <th scope="col">{t('التحقّق بخطوتين', 'Two-step verification')}</th>
                <th scope="col">{t('الصلاحيات', 'Permissions')}</th>
                <th scope="col">{t('آخر دخول', 'Last sign-in')}</th>
                <th scope="col" className="end">
                  <span className="visually-hidden">{t('إجراء', 'Action')}</span>
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
                        {u.id === me.userId ? <span className="ac2-cell__sub">{t('أنت', 'You')}</span> : null}
                        {u.isOwner ? <span className="badge badge--brand">{t('مالك المنصة', 'Platform owner')}</span> : null}
                      </span>
                    </td>
                    <td className="num" data-label={t('البريد', 'Email')}>
                      {u.email}
                    </td>
                    <td data-label={t('التحقّق بخطوتين', 'Two-step verification')}>
                      {u.twoFactor ? <span className="badge badge--success">{t('مفعّل', 'On')}</span> : <span className="badge badge--danger">{t('غير مفعّل', 'Off')}</span>}
                    </td>
                    <td className="wrap ac2-muted-cell" data-label={t('الصلاحيات', 'Permissions')}>
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
                                }, t('حُدّثت الصلاحيات وأُنهيت جلساته.', 'Permissions updated and their sessions ended.'))
                              }
                            >
                              {t('حفظ', 'Save')}
                            </button>
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(({ [u.id]: _, ...rest }) => rest)}>
                              {t('تراجع', 'Cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        u.permissions
                          .map((p) => {
                            const perm = perms.find((x) => x.code === p);
                            return perm ? permLabel(perm) : p;
                          })
                          .join(' · ') || '—'
                      )}
                    </td>
                    <td className="ac2-muted-cell" data-label={t('آخر دخول', 'Last sign-in')}>
                      {u.lastLoginAt ? when(u.lastLoginAt, locale) : t('لم يدخل بعد', 'Never signed in')}
                    </td>
                    <td className="end" data-label="">
                      <span className="ac2-actions">
                        {!editing[u.id] && (!u.isOwner || u.id === me.userId) ? (
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing({ ...editing, [u.id]: u.permissions })}>
                            {t('الصلاحيات', 'Permissions')}
                          </button>
                        ) : null}
                        {u.id !== me.userId && !u.isOwner ? (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={act.busy}
                            onClick={async () => {
                              const sure = await ask({
                                title: t(`تسحب الإدارة من ${u.email}؟`, `Revoke admin from ${u.email}?`),
                                body: t(
                                  'تسقط صلاحياته الإدارية كلها ويُسجَّل خروجه من كل أجهزته. حسابه نفسه يبقى.',
                                  'All their admin permissions are dropped and they are signed out of all their devices. The account itself remains.',
                                ),
                                confirmLabel: t('اسحب الإدارة', 'Revoke admin'),
                                danger: true,
                              });
                              if (!sure) return;
                              void act.run(async () => {
                                await api(`/admin/users/${u.id}/revoke`, { method: 'POST' });
                                reload();
                              }, t('سُحبت الإدارة.', 'Admin access revoked.'));
                            }}
                          >
                            <Icon name="x" size={14} />
                            {t('سحب الإدارة', 'Revoke admin')}
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
                          <span>
                            {t(
                              'لم يفعّل التحقّق بخطوتين — سيُحوَّل إلى شاشة التفعيل الإلزامي عند أول دخول ولا يمكنه تخطّيها.',
                              'Two-step verification is not set up — they will be sent to the mandatory setup screen on first sign-in and cannot skip it.',
                            )}
                          </span>
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
