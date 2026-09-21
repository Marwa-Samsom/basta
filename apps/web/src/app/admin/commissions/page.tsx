'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Alert, Card } from '@/components/ui';
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

  if (!data) return <Loading error={error} forbidden={forbidden} />;
  const section = (s: Rule['scope'], title: string) => {
    const rows = data.filter((r) => r.scope === s);
    return (
      <Card title={title}>
        {rows.length === 0 ? (
          <p className="muted small">لا قواعد.</p>
        ) : (
          <table className="table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.vendor?.nameAr ?? r.category?.nameAr ?? 'كل المنصة'}</td>
                  <td className="num">{pct(r.rateBps)}</td>
                  <td className="small">من {when(r.effectiveFrom)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    );
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
    <div className="stack stack--loose">
      <AdminHeader title="قواعد العمولة" hint="الأولوية: قاعدة البائع، ثم أقرب فئة، ثم العامة." />
      <Alert tone="info">تغيير النسبة لا يمسّ أي طلب سابق — كل طلب يحمل نسبته الملقوطة لحظة الشراء.</Alert>
      <Feedback error={act.error} notice={act.notice} />
      {section('vendor', '١ · قواعد البائعين')}
      {section('category', '٢ · قواعد الفئات')}
      {section('global', '٣ · القاعدة العامة')}

      <Card title="نسبة جديدة">
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field">
            <span className="field__label">النطاق</span>
            <select className="field__control" value={scope} onChange={(e) => (setScope(e.target.value as typeof scope), setTarget(''))}>
              <option value="category">فئة</option>
              <option value="vendor">بائع</option>
              <option value="global">عامة</option>
            </select>
          </label>
          {scope === 'category' ? (
            <label className="field">
              <span className="field__label">الفئة</span>
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
              <span className="field__label">البائع</span>
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
            <input className="field__control" inputMode="decimal" dir="ltr" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
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
      </Card>
    </div>
  );
}
