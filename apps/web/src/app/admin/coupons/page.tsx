'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { ClearableInput, EmptyState } from '@/components/ui';
import { DateField } from '@/components/date-field';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData } from '@/lib/admin';
import { localized } from '@/lib/i18n';
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
const TYPES_EN: typeof TYPES = { percent: 'Percentage', fixed: 'Fixed amount', free_shipping: 'Free shipping' };
const toMinor = (v: string, c: string) => (v ? String(Math.round(Number(v) * 10 ** minorUnitDigits(c))) : null);

const EMPTY = { code: '', type: 'percent' as Coupon['type'], percent: '10', amount: '', maxDiscount: '', minOrder: '', currency: 'SAR', limitTotal: '', limitPerUser: '1', startsAt: '', endsAt: '' };

type State = 'active' | 'ending' | 'expired' | 'off';
const STATE: Record<State, { label: string; en: string; tone: string }> = {
  active: { label: 'فعّال', en: 'Active', tone: 'badge--success' },
  ending: { label: 'قارب النفاد', en: 'Running out', tone: 'badge--warning' },
  expired: { label: 'منتهٍ', en: 'Expired', tone: 'badge--pending' },
  off: { label: 'موقوف', en: 'Paused', tone: 'badge--pending' },
};

/** الحالة كما يراها المدير: الموقوف يدوياً، ثم المنتهي بتاريخه أو باستعماله، ثم ما قارب النفاد */
const stateOf = (c: Coupon, now: number): State => {
  if (!c.isActive) return 'off';
  if ((c.endsAt && new Date(c.endsAt).getTime() < now) || (c.usageLimitTotal !== null && c.usedCount >= c.usageLimitTotal)) return 'expired';
  if (c.usageLimitTotal && c.usedCount / c.usageLimitTotal > 0.9) return 'ending';
  return 'active';
};

const FILTERS: { key: 'all' | State; label: string; en: string }[] = [
  { key: 'all', label: 'الكل', en: 'All' },
  { key: 'active', label: 'فعّال', en: 'Active' },
  { key: 'ending', label: 'قارب النفاد', en: 'Running out' },
  { key: 'expired', label: 'منتهٍ', en: 'Expired' },
  { key: 'off', label: 'موقوف', en: 'Paused' },
];

/**
 * AD-16 — كوبونات المنصة. تموّلها المنصة دائماً (Q-06) — تحميل خصم على متجر
 * يحتاج موافقته فلا يُنشأ من هنا. المستعمل لا يُحذف: يُوقف.
 */
export default function AdminCouponsPage() {
  const t = useT();
  const locale = useLocale();
  const types = localized(locale, TYPES, TYPES_EN);
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

  const example =
    f.type === 'percent' && Number(f.percent) > 0
      ? t(
          `على طلب بـ 200.00 يوفّر المشتري ${(2 * Number(f.percent)).toFixed(2)}${f.maxDiscount ? ` (بحدّ أقصى ${f.maxDiscount})` : ''}.`,
          `On a 200.00 order the buyer saves ${(2 * Number(f.percent)).toFixed(2)}${f.maxDiscount ? ` (up to ${f.maxDiscount})` : ''}.`,
        )
      : f.type === 'fixed' && f.amount
        ? t(`يوفّر المشتري ${f.amount} ${f.currency} على كل طلب مؤهّل.`, `The buyer saves ${f.amount} ${f.currency} on every eligible order.`)
        : f.type === 'free_shipping'
          ? t('الشحن مجاني على الطلب المؤهّل.', 'Shipping is free on an eligible order.')
          : '';

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
    }, c.isActive ? t('أُوقف الكوبون.', 'Coupon paused.') : t('فُعِّل الكوبون.', 'Coupon activated.'));

  const rows = data.map((c) => ({ c, state: stateOf(c, now) }));
  const term = q.trim().toUpperCase();
  const shown = rows.filter((r) => filter === 'all' || r.state === filter).filter((r) => !term || r.c.code.includes(term) || (r.c.vendor?.nameAr ?? '').includes(q.trim()));

  return (
    <div className="ac2-page">
      <AdminHeader title={t('الكوبونات', 'Coupons')} hint={t('كوبونات المنصة تموّلها المنصة — لا تُنقص صافي أي بائع.', 'Platform coupons are funded by the platform — they never reduce any seller’s net.')} />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label={t('تصفية الكوبونات', 'Filter coupons')}>
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}>
              {t(x.label, x.en)}
              <span className="tabs__count">{x.key === 'all' ? rows.length : rows.filter((r) => r.state === x.key).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              className="field__control"
              placeholder={t('ابحث برمز الكوبون', 'Search by coupon code')}
              aria-label={t('ابحث برمز الكوبون', 'Search by coupon code')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn--primary" aria-expanded={showNew} onClick={() => setShowNew((v) => !v)}>
            <Icon name="plus" size={15} />
            {t('كوبون جديد', 'New coupon')}
          </button>
        </div>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      {showNew ? (
        <section className="card" aria-label={t('كوبون جديد', 'New coupon')}>
          <h2 className="ac2-title">{t('كوبون جديد', 'New coupon')}</h2>
          <p className="ac2-hint">{t('النوع والقيمة والحد الأقصى للخصم وشروط التطبيق. تموّله المنصة.', 'Type, value, maximum discount and conditions. Funded by the platform.')}</p>
          <div className="ac2-form">
            <label className="field">
              <span className="field__label">{t('الرمز', 'Code')}</span>
              <ClearableInput className="field__control num" dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
            </label>
            <label className="field">
              <span className="field__label">{t('النوع', 'Type')}</span>
              <select className="field__control" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Coupon['type'] })}>
                {Object.entries(types).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {f.type === 'percent' ? (
              <label className="field">
                <span className="field__label">{t('النسبة %', 'Percentage %')}</span>
                <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} />
              </label>
            ) : null}
            {f.type === 'fixed' ? (
              <label className="field">
                <span className="field__label">{t('المبلغ', 'Amount')}</span>
                <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              </label>
            ) : null}
            <label className="field">
              <span className="field__label">{t('العملة (للمبالغ)', 'Currency (for amounts)')}</span>
              <select className="field__control" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {['SAR', 'AED', 'JOD', 'KWD', 'EGP', 'USD', 'EUR'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{t('أقصى خصم', 'Maximum discount')}</span>
              <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">{t('حدّ أدنى للطلب', 'Minimum order')}</span>
              <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">{t('استعمالات كلية', 'Total uses')}</span>
              <ClearableInput className="field__control num" dir="ltr" inputMode="numeric" value={f.limitTotal} onChange={(e) => setF({ ...f, limitTotal: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">{t('لكل مستخدم', 'Per user')}</span>
              <ClearableInput className="field__control num" dir="ltr" inputMode="numeric" value={f.limitPerUser} onChange={(e) => setF({ ...f, limitPerUser: e.target.value })} />
            </label>
            <div className="field">
              <span className="field__label">{t('يبدأ', 'Starts')}</span>
              <DateField withTime clearable label={t('يبدأ', 'Starts')} value={f.startsAt} onChange={(v) => setF({ ...f, startsAt: v })} />
            </div>
            <div className="field">
              <span className="field__label">{t('ينتهي', 'Ends')}</span>
              <DateField withTime clearable label={t('ينتهي', 'Ends')} value={f.endsAt} onChange={(v) => setF({ ...f, endsAt: v })} />
            </div>
          </div>
          {example ? (
            <div className="alert alert--info ac2-callout ac2-callout--sm">
              <Icon name="info" size={14} />
              <span>
                {t('مثال:', 'Example:')} {example}
              </span>
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
                }, t('أُنشئ الكوبون.', 'Coupon created.'))
              }
            >
              {t('أنشئ الكوبون', 'Create coupon')}
            </button>
          </div>
        </section>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="star"
          title={data.length === 0 ? t('لا كوبونات بعد', 'No coupons yet') : t('لا كوبونات بهذه التصفية', 'No coupons match this filter')}
          actions={
            data.length === 0 ? (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowNew(true)}>
                <Icon name="plus" size={14} />
                {t('كوبون جديد', 'New coupon')}
              </button>
            ) : (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
                {t('أزل التصفية', 'Clear filter')}
              </button>
            )
          }
        >
          {data.length === 0
            ? t('أنشئ أول كوبون للمنصة — يظهر هنا باستعماله وصلاحيته.', 'Create the first platform coupon — it shows here with its usage and validity.')
            : t('جرّب تصفية أخرى أو أنشئ كوبوناً.', 'Try another filter or create a coupon.')}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('الرمز', 'Code')}</th>
                <th scope="col">{t('النطاق', 'Scope')}</th>
                <th scope="col">{t('النوع', 'Type')}</th>
                <th scope="col">{t('القيمة', 'Value')}</th>
                <th scope="col">{t('الاستعمال', 'Usage')}</th>
                <th scope="col">{t('الصلاحية', 'Validity')}</th>
                <th scope="col">{t('التمويل', 'Funded by')}</th>
                <th scope="col">{t('الحالة', 'Status')}</th>
                <th scope="col" className="end">
                  <span className="visually-hidden">{t('إجراء', 'Action')}</span>
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
                    <td className="ac2-muted-cell" data-label={t('النطاق', 'Scope')}>
                      {c.scope === 'platform' ? t('المنصّة', 'Platform') : (c.vendor?.nameAr ?? t('متجر', 'Shop'))}
                    </td>
                    <td className="ac2-muted-cell" data-label={t('النوع', 'Type')}>
                      {types[c.type]}
                    </td>
                    <td data-label={t('القيمة', 'Value')}>
                      {c.type === 'percent' ? (
                        <span className="num ac2-code">{pct(c.valueBps, locale)}</span>
                      ) : c.type === 'fixed' && c.valueMinorUnits && c.currency ? (
                        <span className="money num">{money(c.valueMinorUnits, c.currency, locale)}</span>
                      ) : (
                        <span className="ac2-muted-cell">—</span>
                      )}
                    </td>
                    <td data-label={t('الاستعمال', 'Usage')}>
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
                    <td className="ac2-muted-cell" data-label={t('الصلاحية', 'Validity')}>
                      {c.startsAt ? when(c.startsAt, locale) : t('الآن', 'Now')} — {c.endsAt ? when(c.endsAt, locale) : t('مفتوح', 'Open-ended')}
                    </td>
                    <td data-label={t('التمويل', 'Funded by')}>
                      <span className={`badge ${c.fundedBy === 'platform' ? 'badge--info' : 'badge--pending'}`}>{c.fundedBy === 'platform' ? t('المنصّة', 'Platform') : t('المتجر', 'Shop')}</span>
                    </td>
                    <td data-label={t('الحالة', 'Status')}>
                      <span className={`badge ${STATE[state].tone}`}>{t(STATE[state].label, STATE[state].en)}</span>
                    </td>
                    <td className="end" data-label="">
                      <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => void toggle(c)}>
                        {c.isActive ? t('إيقاف', 'Pause') : t('تفعيل', 'Activate')}
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
