'use client';

import { useRef, useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Rule {
  id: string;
  scope: 'global' | 'vendor';
  vendorId: string | null;
  rateBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  vendor: { nameAr: string } | null;
}

interface VendorItem {
  id: string;
  nameAr: string;
}

/**
 * AD-10 — العمولة: نسبة على كل منتج يُباع بغضّ النظر عن فئته أو سعره، عامة لكل
 * المنصّة أو خاصة بمتجر (قرار صاحب المشروع 14 أكتوبر 2026 — ألغى مستوى الفئة).
 * القاعدة لا تُحذف: الجديدة تُنهي السابقة بتاريخ، وكل طلب سابق على لقطته.
 */
export default function AdminCommissionsPage() {
  const { data, error, forbidden, reload } = useAdminData<Rule[]>('/admin/finance/commissions');
  const { data: vendors } = useAdminData<{ items: VendorItem[] }>('/admin/vendors?status=approved&limit=100');
  const act = useAction();
  const ask = useConfirm();
  const [scope, setScope] = useState<'global' | 'vendor'>('global');
  const [target, setTarget] = useState('');
  const [rate, setRate] = useState('');
  const formRef = useRef<HTMLElement | null>(null);
  const rateRef = useRef<HTMLInputElement | null>(null);

  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const global = data.find((r) => r.scope === 'global') ?? null;
  const custom = data.filter((r) => r.scope === 'vendor');

  // «غيّر» و«نسبة لمتجر» تملأ النموذج وتنقل التركيز إليه
  const startRule = (s: Rule['scope'], vendorId = '') => {
    setScope(s);
    setTarget(vendorId);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    rateRef.current?.focus({ preventScroll: true });
  };

  const save = () =>
    act.run(async () => {
      const bps = Math.round(Number(rate) * 100);
      await api('/admin/finance/commissions', {
        method: 'POST',
        body: { scope, rateBps: bps, ...(scope === 'vendor' ? { vendorId: target } : {}) },
      });
      setRate('');
      reload();
    }, 'سُجّلت النسبة الجديدة وأُنهيت السابقة. الطلبات السابقة لم تتغيّر.');

  const endCustom = async (r: Rule) => {
    if (!r.vendorId) return;
    const back = global ? `، ويعود المتجر إلى النسبة العامة ${pct(global.rateBps)}` : '';
    const sure = await ask({
      title: `تلغي نسبة «${r.vendor?.nameAr ?? 'المتجر'}» الخاصة؟`,
      body: `من الآن${back}. الطلبات السابقة لا تتأثر.`,
      confirmLabel: 'ألغِ النسبة الخاصة',
      danger: true,
    });
    if (!sure) return;
    void act.run(async () => {
      await api(`/admin/finance/commissions/vendor/${r.vendorId}`, { method: 'DELETE' });
      reload();
    }, 'أُلغيت النسبة الخاصة — المتجر على النسبة العامة من الآن.');
  };

  const validRate = rate !== '' && Number(rate) >= 0 && Number(rate) <= 50;

  return (
    <div className="ac2-page">
      <AdminHeader title="العمولة" hint="نسبة على كل منتج يُباع بغضّ النظر عن فئته أو سعره: نسبة المتجر إن خُصّصت، وإلا النسبة العامة." />
      <div className="alert alert--warning ac2-callout">
        <Icon name="alert" size={16} />
        <span>تغيير النسبة لا يؤثّر على أي طلب سابق — كل طلب يحمل نسبته الملقوطة لحظة الشراء. القواعد لا تُحذف: تُنهى صلاحيتها بتاريخ حين تحلّ محلّها قاعدة جديدة.</span>
      </div>
      <Feedback error={act.error} notice={act.notice} />

      <section className="card card--flush" aria-label="النسبة العامة">
        <header className="card__head">
          <h2 className="ac2-title">النسبة العامة</h2>
          <span className="ac2-hint">على كل متجر لم تُخصَّص له نسبة</span>
          <span className="ac2-end">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => startRule('global')}>
              غيّر النسبة العامة
            </button>
          </span>
        </header>
        {global ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">النطاق</th>
                  <th scope="col">النسبة</th>
                  <th scope="col">السريان</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>كل المنصّة</strong>
                  </td>
                  <td className="num ac2-rate" data-label="النسبة">
                    {pct(global.rateBps)}
                  </td>
                  <td className="ac2-muted-cell" data-label="السريان">
                    {when(global.effectiveFrom)} — {global.effectiveTo ? when(global.effectiveTo) : 'مفتوحة'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ac2-section-empty">لا نسبة عامة بعد — حدّدها من النموذج أدناه.</p>
        )}
      </section>

      <section className="card card--flush" aria-label="نسب خاصة بمتاجر">
        <header className="card__head">
          <h2 className="ac2-title">نسب خاصة بمتاجر</h2>
          <span className="ac2-hint">تتجاوز النسبة العامة للمتجر وحده</span>
          <span className="ac2-end">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => startRule('vendor')}>
              <Icon name="plus" size={14} />
              نسبة لمتجر
            </button>
          </span>
        </header>
        {custom.length === 0 ? (
          <p className="ac2-section-empty">كل المتاجر على النسبة العامة.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">المتجر</th>
                  <th scope="col">النسبة</th>
                  <th scope="col">السريان</th>
                  <th scope="col" className="end">
                    <span className="visually-hidden">إجراءات</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {custom.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.vendor?.nameAr ?? '—'}</strong>
                    </td>
                    <td className="num ac2-rate" data-label="النسبة">
                      {pct(r.rateBps)}
                    </td>
                    <td className="ac2-muted-cell" data-label="السريان">
                      {when(r.effectiveFrom)} — {r.effectiveTo ? when(r.effectiveTo) : 'مفتوحة'}
                    </td>
                    <td className="end" data-label="">
                      <span className="ac2-inline">
                        <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => startRule('vendor', r.vendorId ?? '')}>
                          غيّر
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" disabled={act.busy} onClick={() => void endCustom(r)}>
                          أعده إلى العامة
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section ref={formRef} className="card" aria-label="نسبة جديدة">
        <h2 className="ac2-title">نسبة جديدة</h2>
        <p className="ac2-hint">تسري من لحظة الاعتماد وتُنهي القاعدة السارية في نطاقها.</p>
        <div className="ac2-form">
          <label className="field">
            <span className="field__label">النطاق</span>
            <select className="field__control" value={scope} onChange={(e) => (setScope(e.target.value as typeof scope), setTarget(''))}>
              <option value="global">عامة — كل المنصّة</option>
              <option value="vendor">خاصة بمتجر</option>
            </select>
          </label>
          {scope === 'vendor' ? (
            <label className="field">
              <span className="field__label">المتجر</span>
              <select className="field__control" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">اختر</option>
                {(vendors?.items ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nameAr}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span className="field__label">النسبة %</span>
            <input ref={rateRef} className="field__control num" inputMode="decimal" dir="ltr" placeholder="3" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <div className="ac2-form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={act.busy || !validRate || (scope === 'vendor' && !target)}
              onClick={async () => {
                const sure = await ask({
                  title: `تعتمد ${rate}% ${scope === 'global' ? 'نسبةً عامة' : 'لهذا المتجر'} من الآن؟`,
                  body: 'تنتهي النسبة السابقة، والطلبات السابقة لا تتأثر.',
                  confirmLabel: 'اعتمد النسبة',
                });
                if (sure) void save();
              }}
            >
              اعتماد من الآن
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
