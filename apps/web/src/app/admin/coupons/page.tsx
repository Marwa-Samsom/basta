'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading } from '@/components/admin';
import { Card } from '@/components/ui';
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

/**
 * AD-16 — كوبونات المنصة. تموّلها المنصة دائماً (Q-06) — تحميل خصم على متجر
 * يحتاج موافقته فلا يُنشأ من هنا. المستعمل لا يُحذف: يُوقف.
 */
export default function AdminCouponsPage() {
  const { data, error, forbidden, reload } = useAdminData<Coupon[]>('/admin/coupons');
  const act = useAction();
  const [f, setF] = useState(EMPTY);
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

  return (
    <div className="stack stack--loose">
      <AdminHeader title="الكوبونات" hint="كوبونات المنصة تموّلها المنصة — لا تُنقص صافي أي بائع." />
      <Feedback error={act.error} notice={act.notice} />

      <Card title="كوبون جديد">
        <div className="stack">
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field">
              <span className="field__label">الرمز</span>
              <input className="field__control" dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
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
                <input className="field__control" dir="ltr" inputMode="decimal" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} />
              </label>
            ) : null}
            {f.type === 'fixed' ? (
              <label className="field">
                <span className="field__label">المبلغ</span>
                <input className="field__control" dir="ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
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
              <input className="field__control" dir="ltr" inputMode="decimal" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">حدّ أدنى للطلب</span>
              <input className="field__control" dir="ltr" inputMode="decimal" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">استعمالات كلية</span>
              <input className="field__control" dir="ltr" inputMode="numeric" value={f.limitTotal} onChange={(e) => setF({ ...f, limitTotal: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">لكل مستخدم</span>
              <input className="field__control" dir="ltr" inputMode="numeric" value={f.limitPerUser} onChange={(e) => setF({ ...f, limitPerUser: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">يبدأ</span>
              <input type="datetime-local" className="field__control" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">ينتهي</span>
              <input type="datetime-local" className="field__control" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
            </label>
          </div>
          {example ? <p className="small muted">مثال: {example}</p> : null}
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
            إنشاء
          </button>
        </div>
      </Card>

      {data.length === 0 ? (
        <Card>
          <Empty>لا كوبونات.</Empty>
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الرمز</th>
                <th>النطاق</th>
                <th>القيمة</th>
                <th>الاستعمال</th>
                <th>الصلاحية</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="num">{c.code}</td>
                  <td className="small">{c.scope === 'platform' ? 'المنصة' : (c.vendor?.nameAr ?? 'متجر')}</td>
                  <td className="small">
                    {TYPES[c.type]} · {c.type === 'percent' ? pct(c.valueBps) : c.type === 'fixed' && c.valueMinorUnits && c.currency ? money(c.valueMinorUnits, c.currency) : ''}
                  </td>
                  <td className="num">
                    {c.usedCount} / {c.usageLimitTotal ?? '∞'}
                  </td>
                  <td className="small">
                    {c.startsAt ? when(c.startsAt) : 'الآن'} ← {c.endsAt ? when(c.endsAt) : 'مفتوح'}
                  </td>
                  <td>
                    <button type="button" className="btn btn--ghost btn--sm" disabled={act.busy} onClick={() => void toggle(c)}>
                      {c.isActive ? 'فعّال — إيقاف' : 'موقوف — تفعيل'}
                    </button>
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
