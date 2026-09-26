'use client';

import { useRef, useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Rule {
  id: string;
  scope: 'global' | 'category' | 'vendor';
  rateBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  category: { nameAr: string } | null;
  vendor: { nameAr: string } | null;
}

interface Tree {
  id: string;
  nameAr: string;
  depth: number;
  children?: Tree[];
}

interface VendorItem {
  id: string;
  nameAr: string;
}

const flatten = (nodes: Tree[]): Tree[] => nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);

/** الأقسام بترتيب أولويتها — كما تُطبَّق عند الشراء */
const SECTIONS: { scope: Rule['scope']; priority: number; title: string; hint: string }[] = [
  { scope: 'vendor', priority: 1, title: 'قواعد المتاجر', hint: 'الأعلى أولوية — تتجاوز قواعد التصنيف والقاعدة العامة' },
  { scope: 'category', priority: 2, title: 'قواعد التصنيفات', hint: 'تُطبَّق حين لا توجد قاعدة للمتجر' },
  { scope: 'global', priority: 3, title: 'القاعدة العامة', hint: 'تُطبَّق حين لا توجد قاعدة متجر أو تصنيف' },
];

/**
 * AD-10 — العمولات بأولويتها المرئية: البائع ← الفئة ← العام. القاعدة لا
 * تُحذف: الجديدة تُنهي السابقة بتاريخ، وكل طلب سابق على لقطته.
 */
export default function AdminCommissionsPage() {
  const { data, error, forbidden, reload } = useAdminData<Rule[]>('/admin/finance/commissions');
  const { data: tree } = useAdminData<Tree[]>('/categories');
  const { data: vendors } = useAdminData<{ items: VendorItem[] }>('/admin/vendors?status=approved&limit=100');
  const act = useAction();
  const [scope, setScope] = useState<'global' | 'category' | 'vendor'>('category');
  const [target, setTarget] = useState('');
  const [rate, setRate] = useState('');
  const formRef = useRef<HTMLElement | null>(null);
  const rateRef = useRef<HTMLInputElement | null>(null);

  if (!data) return <Loading error={error} forbidden={forbidden} />;

  // «أضف قاعدة» في رأس القسم يملأ النطاق وينقل التركيز إلى النموذج
  const startRule = (s: Rule['scope']) => {
    setScope(s);
    setTarget('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    rateRef.current?.focus({ preventScroll: true });
  };

  const save = () =>
    act.run(async () => {
      const bps = Math.round(Number(rate) * 100);
      await api('/admin/finance/commissions', {
        method: 'POST',
        body: { scope, rateBps: bps, ...(scope === 'category' ? { categoryId: target } : {}), ...(scope === 'vendor' ? { vendorId: target } : {}) },
      });
      setRate('');
      reload();
    }, 'سُجّلت النسبة الجديدة وأُنهيت السابقة. الطلبات السابقة لم تتغيّر.');

  return (
    <div className="ac2-page">
      <AdminHeader title="قواعد العمولة" hint="الأولوية: قاعدة المتجر، ثم أقرب تصنيف، ثم القاعدة العامة." />
      <div className="alert alert--warning ac2-callout">
        <Icon name="alert" size={16} />
        <span>تغيير النسبة لا يؤثّر على أي طلب سابق — كل طلب يحمل نسبته الملقوطة لحظة الشراء. القواعد لا تُحذف: تُنهى صلاحيتها بتاريخ حين تحلّ محلّها قاعدة جديدة.</span>
      </div>
      <Feedback error={act.error} notice={act.notice} />

      {SECTIONS.map((s) => {
        const rows = data.filter((r) => r.scope === s.scope);
        return (
          <section key={s.scope} className="card card--flush" aria-label={s.title}>
            <header className="card__head">
              <span className="ac2-priority" aria-hidden>
                {s.priority}
              </span>
              <h2 className="ac2-title">{s.title}</h2>
              <span className="ac2-hint">{s.hint}</span>
              <span className="ac2-end">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => startRule(s.scope)}>
                  <Icon name="plus" size={14} />
                  أضف قاعدة
                </button>
              </span>
            </header>
            {rows.length === 0 ? (
              <p className="ac2-section-empty">لا قواعد في هذا المستوى.</p>
            ) : (
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
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.vendor?.nameAr ?? r.category?.nameAr ?? 'كل المنصّة'}</strong>
                        </td>
                        <td className="num ac2-rate" data-label="النسبة">
                          {pct(r.rateBps)}
                        </td>
                        <td className="ac2-muted-cell" data-label="السريان">
                          {when(r.effectiveFrom)} — {r.effectiveTo ? when(r.effectiveTo) : 'مفتوحة'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <section ref={formRef} className="card" aria-label="نسبة جديدة">
        <h2 className="ac2-title">نسبة جديدة</h2>
        <p className="ac2-hint">تسري من لحظة الاعتماد وتُنهي القاعدة السارية في نطاقها.</p>
        <div className="ac2-form">
          <label className="field">
            <span className="field__label">النطاق</span>
            <select className="field__control" value={scope} onChange={(e) => (setScope(e.target.value as typeof scope), setTarget(''))}>
              <option value="category">تصنيف</option>
              <option value="vendor">متجر</option>
              <option value="global">عامة</option>
            </select>
          </label>
          {scope === 'category' ? (
            <label className="field">
              <span className="field__label">التصنيف</span>
              <select className="field__control" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">اختر</option>
                {flatten(tree ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {'— '.repeat(c.depth)}
                    {c.nameAr}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
            <input ref={rateRef} className="field__control num" inputMode="decimal" dir="ltr" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <div className="ac2-form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={act.busy || !(Number(rate) >= 0 && Number(rate) <= 50 && rate !== '') || (scope !== 'global' && !target)}
              onClick={() => {
                if (window.confirm(`اعتماد ${rate}% من الآن؟ الطلبات السابقة لا تتأثر.`)) void save();
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
