'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Icon } from '@/components/icons';
import { ClearableInput, EmptyState } from '@/components/ui';
import { DateField } from '@/components/date-field';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData } from '@/lib/admin';
import { minorUnitDigits } from '@/lib/money';
import { money, when } from '@/lib/orders';

interface Coupon {
  id: string;
  code: string;
  scope: 'platform' | 'vendor';
  vendorId: string | null;
  type: 'percent' | 'fixed' | 'free_shipping';
  valueBps: number | null;
  valueMinorUnits: string | null;
  maxDiscountMinorUnits: string | null;
  minOrderMinorUnits: string | null;
  currency: string | null;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  usedCount: number;
  fundedBy: 'platform' | 'vendor';
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  vendor: { nameAr: string } | null;
}

const TYPES = { percent: 'نسبة', fixed: 'مبلغ ثابت', free_shipping: 'شحن مجاني' };
const toMinor = (v: string, c: string) => (v ? String(Math.round(Number(v) * 10 ** minorUnitDigits(c))) : null);

const EMPTY = { code: '', type: 'percent' as Coupon['type'], percent: '10', amount: '', maxDiscount: '', minOrder: '', currency: 'SAR', limitTotal: '', limitPerUser: '1', startsAt: '', endsAt: '' };

type State = 'active' | 'ending' | 'expired' | 'off';
const STATE: Record<State, { label: string; tone: string }> = {
  active: { label: 'فعّال', tone: 'badge--success' },
  ending: { label: 'قارب النفاد', tone: 'badge--warning' },
  expired: { label: 'منتهٍ', tone: 'badge--pending' },
  off: { label: 'موقوف', tone: 'badge--pending' },
};

/** الحالة كما يراها المدير: الموقوف يدوياً، ثم المنتهي بتاريخه أو باستعماله، ثم ما قارب النفاد */
const stateOf = (c: Coupon, now: number): State => {
  if (!c.isActive) return 'off';
  if ((c.endsAt && new Date(c.endsAt).getTime() < now) || (c.usageLimitTotal !== null && c.usedCount >= c.usageLimitTotal)) return 'expired';
  if (c.usageLimitTotal && c.usedCount / c.usageLimitTotal > 0.9) return 'ending';
  return 'active';
};

const FILTERS: { key: 'all' | State; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'active', label: 'فعّال' },
  { key: 'ending', label: 'قارب النفاد' },
  { key: 'expired', label: 'منتهٍ' },
  { key: 'off', label: 'موقوف' },
];

/**
 * AD-16 — كوبونات المنصة. تموّلها المنصة دائماً (Q-06) — تحميل خصم على متجر
 * يحتاج موافقته فلا يُنشأ من هنا. المستعمل لا يُحذف: يُوقف.
 */
export default function AdminCouponsPage() {
  const { data, error, forbidden, reload } = useAdminData<Coupon[]>('/admin/coupons');
  const act = useAction();
  const [f, setF] = useState(EMPTY);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState<'all' | State>('all');
  const [q, setQ] = useState('');
  const [now] = useState(() => Date.now());
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const body = {
    code: f.code.toUpperCase(),
    scope: 'platform',
    type: f.type,
    fundedBy: 'platform',
    ...(f.type === 'percent' ? { valueBps: Math.round(Number(f.percent) * 100) } : {}),
    ...(f.type === 'fixed' ? { valueMinorUnits: toMinor(f.amount, f.currency), currency: f.currency } : {}),
    ...(f.maxDiscount ? { maxDiscountMinorUnits: toMinor(f.maxDiscount, f.currency), currency: f.currency } : {}),
    ...(f.minOrder ? { minOrderMinorUnits: toMinor(f.minOrder, f.currency), currency: f.currency } : {}),
    ...(f.limitTotal ? { usageLimitTotal: Number(f.limitTotal) } : {}),
    ...(f.limitPerUser ? { usageLimitPerUser: Number(f.limitPerUser) } : {}),
    ...(f.startsAt ? { startsAt: new Date(f.startsAt).toISOString() } : {}),
    ...(f.endsAt ? { endsAt: new Date(f.endsAt).toISOString() } : {}),
  };

  const example = f.type === 'percent' && Number(f.percent) > 0 ? `على طلب بـ 200.00 يوفّر المشتري ${(2 * Number(f.percent)).toFixed(2)}${f.maxDiscount ? ` (بحدّ أقصى ${f.maxDiscount})` : ''}.` : f.type === 'fixed' && f.amount ? `يوفّر المشتري ${f.amount} ${f.currency} على كل طلب مؤهّل.` : f.type === 'free_shipping' ? 'الشحن مجاني على الطلب المؤهّل.' : '';

  const toggle = (c: Coupon) =>
    act.run(async () => {
      await api(`/admin/coupons/${c.id}`, {
        method: 'PUT',
        body: {
          code: c.code, scope: c.scope, vendorId: c.vendorId, type: c.type, valueBps: c.valueBps, valueMinorUnits: c.valueMinorUnits,
          maxDiscountMinorUnits: c.maxDiscountMinorUnits, minOrderMinorUnits: c.minOrderMinorUnits, currency: c.currency,
          usageLimitTotal: c.usageLimitTotal, usageLimitPerUser: c.usageLimitPerUser, fundedBy: c.fundedBy,
          startsAt: c.startsAt, endsAt: c.endsAt, isActive: !c.isActive,
        },
      });
      reload();
    }, c.isActive ? 'أُوقف الكوبون.' : 'فُعِّل الكوبون.');

  const rows = data.map((c) => ({ c, state: stateOf(c, now) }));
  const term = q.trim().toUpperCase();
  const shown = rows.filter((r) => filter === 'all' || r.state === filter).filter((r) => !term || r.c.code.includes(term) || (r.c.vendor?.nameAr ?? '').includes(q.trim()));

  return (
    <div className="ac2-page">
      <AdminHeader title="الكوبونات" hint="كوبونات المنصة تموّلها المنصة — لا تُنقص صافي أي بائع." />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="تصفية الكوبونات">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}>
              {x.label}
              <span className="tabs__count">{x.key === 'all' ? rows.length : rows.filter((r) => r.state === x.key).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input type="search" className="field__control" placeholder="ابحث برمز الكوبون" aria-label="ابحث برمز الكوبون" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" aria-expanded={showNew} onClick={() => setShowNew((v) => !v)}>
            <Icon name="plus" size={15} />
            كوبون جديد
          </button>
        </div>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      {showNew ? (
        <section className="card" aria-label="كوبون جديد">
          <h2 className="ac2-title">كوبون جديد</h2>
          <p className="ac2-hint">النوع والقيمة والحد الأقصى للخصم وشروط التطبيق. تموّله المنصة.</p>
          <div className="ac2-form">
            <label className="field">
              <span className="field__label">الرمز</span>
              <ClearableInput className="field__control num" dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
            </label>
            <label className="field">
              <span className="field__label">النوع</span>
              <select className="field__control" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Coupon['type'] })}>
                {Object.entries(TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {f.type === 'percent' ? (
              <label className="field">
                <span className="field__label">النسبة %</span>
                <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} />
              </label>
            ) : null}
            {f.type === 'fixed' ? (
              <label className="field">
                <span className="field__label">المبلغ</span>
                <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              </label>
            ) : null}
            <label className="field">
              <span className="field__label">العملة (للمبالغ)</span>
              <select className="field__control" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {['SAR', 'AED', 'JOD', 'KWD', 'EGP', 'USD', 'EUR'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">أقصى خصم</span>
              <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">حدّ أدنى للطلب</span>
              <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">استعمالات كلية</span>
              <ClearableInput className="field__control num" dir="ltr" inputMode="numeric" value={f.limitTotal} onChange={(e) => setF({ ...f, limitTotal: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">لكل مستخدم</span>
              <ClearableInput className="field__control num" dir="ltr" inputMode="numeric" value={f.limitPerUser} onChange={(e) => setF({ ...f, limitPerUser: e.target.value })} />
            </label>
            <div className="field">
              <span className="field__label">يبدأ</span>
              <DateField withTime clearable label="يبدأ" value={f.startsAt} onChange={(v) => setF({ ...f, startsAt: v })} />
            </div>
            <div className="field">
              <span className="field__label">ينتهي</span>
              <DateField withTime clearable label="ينتهي" value={f.endsAt} onChange={(v) => setF({ ...f, endsAt: v })} />
            </div>
          </div>
          {example ? (
            <div className="alert alert--info ac2-callout ac2-callout--sm">
              <Icon name="info" size={14} />
              <span>مثال: {example}</span>
            </div>
          ) : null}
          <div className="ac2-form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={act.busy || f.code.length < 3}
              onClick={() =>
                void act.run(async () => {
                  await api('/admin/coupons', { method: 'POST', body });
                  setF(EMPTY);
                  reload();
                }, 'أُنشئ الكوبون.')
              }
            >
              أنشئ الكوبون
            </button>
          </div>
        </section>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="star"
          title={data.length === 0 ? 'لا كوبونات بعد' : 'لا كوبونات بهذه التصفية'}
          actions={
            data.length === 0 ? (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowNew(true)}>
                <Icon name="plus" size={14} />
                كوبون جديد
              </button>
            ) : (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
                أزل التصفية
              </button>
            )
          }
        >
          {data.length === 0 ? 'أنشئ أول كوبون للمنصة — يظهر هنا باستعماله وصلاحيته.' : 'جرّب تصفية أخرى أو أنشئ كوبوناً.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">الرمز</th>
                <th scope="col">النطاق</th>
                <th scope="col">النوع</th>
                <th scope="col">القيمة</th>
                <th scope="col">الاستعمال</th>
                <th scope="col">الصلاحية</th>
                <th scope="col">التمويل</th>
                <th scope="col">الحالة</th>
                <th scope="col" className="end">
                  <span className="visually-hidden">إجراء</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ c, state }) => {
                const ratio = c.usageLimitTotal ? Math.min(1, c.usedCount / c.usageLimitTotal) : null;
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="num ac2-code">{c.code}</span>
                    </td>
                    <td className="ac2-muted-cell" data-label="النطاق">
                      {c.scope === 'platform' ? 'المنصّة' : (c.vendor?.nameAr ?? 'متجر')}
                    </td>
                    <td className="ac2-muted-cell" data-label="النوع">
                      {TYPES[c.type]}
                    </td>
                    <td data-label="القيمة">
                      {c.type === 'percent' ? (
                        <span className="num ac2-code">{pct(c.valueBps)}</span>
                      ) : c.type === 'fixed' && c.valueMinorUnits && c.currency ? (
                        <span className="money num">{money(c.valueMinorUnits, c.currency)}</span>
                      ) : (
                        <span className="ac2-muted-cell">—</span>
                      )}
                    </td>
                    <td data-label="الاستعمال">
                      <span className="ac2-usage">
                        <span className="num">
                          {c.usedCount} / {c.usageLimitTotal ?? '∞'}
                        </span>
                        {ratio !== null ? (
                          <span className="ac2-bar" aria-hidden>
                            <span className="ac2-bar__fill" data-tone={ratio > 0.9 ? 'warning' : undefined} style={{ inlineSize: `${ratio * 100}%` }} />
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="ac2-muted-cell" data-label="الصلاحية">
                      {c.startsAt ? when(c.startsAt) : 'الآن'} — {c.endsAt ? when(c.endsAt) : 'مفتوح'}
                    </td>
                    <td data-label="التمويل">
                      <span className={`badge ${c.fundedBy === 'platform' ? 'badge--info' : 'badge--pending'}`}>{c.fundedBy === 'platform' ? 'المنصّة' : 'المتجر'}</span>
                    </td>
                    <td data-label="الحالة">
                      <span className={`badge ${STATE[state].tone}`}>{STATE[state].label}</span>
                    </td>
                    <td className="end" data-label="">
                      <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => void toggle(c)}>
                        {c.isActive ? 'إيقاف' : 'تفعيل'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
