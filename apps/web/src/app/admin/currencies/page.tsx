'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Alert, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData } from '@/lib/admin';
import { money, when } from '@/lib/orders';

interface Data {
  spreadBps: number;
  currencies: { code: string; nameAr: string; symbol: string; minorUnitDigits: number; minPayoutMinorUnits: string; isActive: boolean; isBase: boolean; currentRate: string | null }[];
  history: { id: string; quoteCode: string; rate: string; source: string; effectiveAt: string }[];
}

/**
 * AD-11 — العملات وأسعار الصرف. السعر يُضاف ولا يُعدَّل ولا يُحذف: الجدول
 * للإضافة فقط، وكل طلب سابق على لقطته.
 */
export default function AdminCurrenciesPage() {
  const { data, error, forbidden, reload } = useAdminData<Data>('/admin/currencies');
  const act = useAction();
  const [quote, setQuote] = useState('');
  const [rate, setRate] = useState('');
  const [source, setSource] = useState('');
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  return (
    <div className="stack stack--loose">
      <AdminHeader title="العملات وأسعار الصرف" hint={`هامش الصرف الحالي ${pct(data.spreadBps)} — يُحرَّر من الإعدادات.`} />
      <Alert tone="info">تحديث السعر لا يغيّر مستحقات أي طلب سابق — الطلب يحمل سعره الملقوط لحظة الشراء.</Alert>
      <Feedback error={act.error} notice={act.notice} />

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>العملة</th>
              <th>الخانات</th>
              <th>حدّ السحب الأدنى</th>
              <th>السعر مقابل الدولار</th>
            </tr>
          </thead>
          <tbody>
            {data.currencies.map((c) => (
              <tr key={c.code}>
                <td>
                  <span className="num">{c.code}</span> · {c.nameAr} {c.isBase ? <span className="badge badge--review">المحاسبة</span> : null}
                </td>
                <td className="num">{c.minorUnitDigits}</td>
                <td className="money">{money(c.minPayoutMinorUnits, c.code)}</td>
                <td className="num">{c.currentRate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card title="إضافة سعر">
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field">
            <span className="field__label">العملة</span>
            <select className="field__control" value={quote} onChange={(e) => setQuote(e.target.value)}>
              <option value="">اختر</option>
              {data.currencies.filter((c) => c.code !== 'USD').map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">وحدات لكل دولار</span>
            <input className="field__control" dir="ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">المصدر</span>
            <input className="field__control" value={source} onChange={(e) => setSource(e.target.value)} placeholder="البنك المركزي" />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            disabled={act.busy || !quote || !/^\d+(\.\d{1,10})?$/.test(rate) || source.trim().length < 2}
            onClick={() =>
              void act.run(async () => {
                await api('/admin/fx-rates', { method: 'POST', body: { quote, rate, source } });
                setRate('');
                reload();
              }, 'أُضيف السعر. يسري على الطلبات من الآن.')
            }
          >
            إضافة
          </button>
        </div>
      </Card>

      <Card title="السجل — للإضافة فقط">
        <table className="table">
          <tbody>
            {data.history.slice(0, 50).map((h) => (
              <tr key={h.id}>
                <td className="num">USD → {h.quoteCode}</td>
                <td className="num">{h.rate}</td>
                <td className="small">{h.source}</td>
                <td className="small">{when(h.effectiveAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
