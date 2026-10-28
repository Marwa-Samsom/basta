'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData } from '@/lib/admin';
import { money, when } from '@/lib/orders';
import { ClearableInput } from '@/components/ui';

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

  const base = data.currencies.find((c) => c.isBase)?.code ?? 'USD';
  const rateOk = /^\d+(\.\d{1,10})?$/.test(rate);
  // السجلّ مرتّب من الأحدث: أول سطر لكل عملة هو السعر الساري
  const seen = new Set<string>();
  const history = data.history.slice(0, 50).map((h) => {
    const current = !seen.has(h.quoteCode);
    seen.add(h.quoteCode);
    return { ...h, current };
  });

  return (
    <div className="ac2-page">
      <AdminHeader title="العملات وأسعار الصرف" hint={`هامش فرق الصرف ${pct(data.spreadBps)} — يُحرَّر من الإعدادات.`} />
      <div className="alert alert--warning ac2-callout">
        <Icon name="alert" size={16} />
        <span>تحديث سعر الصرف لا يغيّر أرباح أي طلب سابق — الطلب يحمل سعره الملقوط لحظة الشراء. الأسعار تُضاف ولا تُعدَّل ولا تُحذف.</span>
      </div>
      <Feedback error={act.error} notice={act.notice} />

      <section className="card card--flush" aria-label="العملات">
        <header className="card__head">
          <h2 className="ac2-title">العملات</h2>
          <span className="ac2-end ac2-hint">
            عملة المحاسبة: <span className="num ac2-code">{base}</span>
          </span>
        </header>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">الرمز</th>
                <th scope="col">الاسم</th>
                <th scope="col">العلامة</th>
                <th scope="col">الخانات</th>
                <th scope="col">حدّ السحب الأدنى</th>
                <th scope="col">الحالة</th>
                <th scope="col" className="end">
                  السعر مقابل الدولار
                </th>
              </tr>
            </thead>
            <tbody>
              {data.currencies.map((c) => (
                <tr key={c.code}>
                  <td>
                    <span className="num ac2-code">{c.code}</span>
                  </td>
                  <td data-label="الاسم">
                    {c.nameAr} {c.isBase ? <span className="badge badge--info">المحاسبة</span> : null}
                  </td>
                  <td className="ac2-symbol" data-label="العلامة">
                    {c.symbol}
                  </td>
                  <td className="num ac2-dec" data-three={c.minorUnitDigits === 3} data-label="الخانات">
                    {c.minorUnitDigits}
                  </td>
                  <td className="money num" data-label="حدّ السحب الأدنى">
                    {money(c.minPayoutMinorUnits, c.code)}
                  </td>
                  <td data-label="الحالة">{c.isActive ? <span className="badge badge--success">مفعّلة</span> : <span className="badge badge--pending">موقوفة</span>}</td>
                  <td className="num end" data-label="السعر مقابل الدولار">
                    {c.currentRate ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ac2-split ac2-split--narrow">
        <section className="card card--flush" aria-label="سجلّ أسعار الصرف">
          <header className="card__head">
            <h2 className="ac2-title">سجلّ أسعار الصرف</h2>
            <span className="badge badge--info">إضافة فقط</span>
            <span className="ac2-end ac2-hint">
              هامش فرق الصرف <span className="num ac2-code">{pct(data.spreadBps)}</span>
            </span>
          </header>
          {history.length === 0 ? (
            <p className="ac2-section-empty">لم يُسجَّل أي سعر بعد.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">الزوج</th>
                    <th scope="col">السعر</th>
                    <th scope="col">المصدر</th>
                    <th scope="col" className="end">
                      السريان
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} data-tone={h.current ? 'success' : undefined}>
                      <td className="num">USD → {h.quoteCode}</td>
                      <td className="num ac2-rate" data-label="السعر">
                        {h.rate}
                      </td>
                      <td className="ac2-muted-cell" data-label="المصدر">
                        {h.source}
                      </td>
                      <td className="end" data-label="السريان">
                        <span className="ac2-muted-cell">{when(h.effectiveAt)}</span> {h.current ? <span className="badge badge--success">الساري</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card ac2-sticky" aria-label="أضف سعراً">
          <h2 className="ac2-title">أضف سعراً</h2>
          <label className="field">
            <span className="field__label">الزوج</span>
            <select className="field__control num" value={quote} onChange={(e) => setQuote(e.target.value)}>
              <option value="">اختر العملة</option>
              {data.currencies.filter((c) => c.code !== 'USD').map((c) => (
                <option key={c.code} value={c.code}>
                  USD → {c.code}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">السعر — وحدات لكل دولار</span>
            <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" placeholder="3.7503" aria-invalid={rate !== '' && !rateOk} value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">المصدر</span>
            <ClearableInput className="field__control" value={source} onChange={(e) => setSource(e.target.value)} placeholder="البنك المركزي" />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            disabled={act.busy || !quote || !rateOk || source.trim().length < 2}
            onClick={() =>
              void act.run(async () => {
                await api('/admin/fx-rates', { method: 'POST', body: { quote, rate, source } });
                setRate('');
                reload();
              }, 'أُضيف السعر. يسري على الطلبات من الآن.')
            }
          >
            أضف السعر
          </button>
          <p className="ac2-fine">يُضاف السعر بتاريخ اليوم ويصبح الساري. الأسعار السابقة تبقى في السجلّ.</p>
        </section>
      </div>
    </div>
  );
}
