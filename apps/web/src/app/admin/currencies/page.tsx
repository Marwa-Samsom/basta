'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading, MoreButton } from '@/components/admin';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData, useAdminList } from '@/lib/admin';
import { counted, type Counted } from '@/lib/arabic-count';
import { money, when } from '@/lib/orders';
import { CURRENCIES } from '@/lib/vendor';
import { ClearableInput } from '@/components/ui';

interface Data {
  spreadBps: number;
  currencies: { code: string; nameAr: string; symbol: string; minorUnitDigits: number; minPayoutMinorUnits: string; isActive: boolean; isBase: boolean; currentRate: string | null }[];
}

/** سطر في سجلّ الأسعار — «الساري» يعلّمه الخادم: الأحدث قبل اللحظة لكل عملة، كما يسعّر الدفع */
interface RateRow {
  id: string;
  quoteCode: string;
  rate: string;
  source: string;
  effectiveAt: string;
  current: boolean;
}

const ROWS: Counted = { one: 'سطر واحد', two: 'سطران', plural: '# أسطر', accusative: '# سطراً', genitive: '# سطر' };

/**
 * AD-11 — العملات وأسعار الصرف. السعر يُضاف ولا يُعدَّل ولا يُحذف: الجدول
 * للإضافة فقط، وكل طلب سابق على لقطته.
 */
export default function AdminCurrenciesPage() {
  const t = useT();
  const locale = useLocale();
  const { data, error, forbidden, reload } = useAdminData<Data>('/admin/currencies');
  // السجلّ بصفحات من الخادم — كانت الصفحة تقصّه على أحدث 50 بلا «المزيد» ولا عدّ (ACFG-016، 2 نوفمبر 2026)
  const history = useAdminList<RateRow>('/admin/fx-rates', (h) => h.id);
  const act = useAction();
  const [quote, setQuote] = useState('');
  const [rate, setRate] = useState('');
  const [source, setSource] = useState('');
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const base = data.currencies.find((c) => c.isBase)?.code ?? 'USD';
  const rateOk = /^\d+(\.\d{1,10})?$/.test(rate);
  const nameOf = (c: Data['currencies'][number]) => (locale === 'en' ? (CURRENCIES.find((x) => x.code === c.code)?.nameEn ?? c.nameAr) : c.nameAr);

  return (
    <div className="ac2-page">
      <AdminHeader
        title={t('العملات وأسعار الصرف', 'Currencies and exchange rates')}
        hint={t(`هامش فرق الصرف ${pct(data.spreadBps)} — يُحرَّر من الإعدادات.`, `Exchange spread ${pct(data.spreadBps, locale)} — edited in Settings.`)}
      />
      <div className="alert alert--warning ac2-callout">
        <Icon name="alert" size={16} />
        <span>
          {t(
            'تحديث سعر الصرف لا يغيّر أرباح أي طلب سابق — الطلب يحمل سعره الملقوط لحظة الشراء. الأسعار تُضاف ولا تُعدَّل ولا تُحذف.',
            'Updating an exchange rate does not change the earnings of any past order — each order keeps the rate captured at the moment of purchase. Rates are only added, never edited or deleted.',
          )}
        </span>
      </div>
      <Feedback error={act.error} notice={act.notice} />

      <section className="card card--flush" aria-label={t('العملات', 'Currencies')}>
        <header className="card__head">
          <h2 className="ac2-title">{t('العملات', 'Currencies')}</h2>
          <span className="ac2-end ac2-hint">
            {t('عملة المحاسبة:', 'Accounting currency:')} <span className="num ac2-code">{base}</span>
          </span>
        </header>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('الرمز', 'Code')}</th>
                <th scope="col">{t('الاسم', 'Name')}</th>
                <th scope="col">{t('العلامة', 'Symbol')}</th>
                <th scope="col">{t('الخانات', 'Decimals')}</th>
                <th scope="col">{t('حدّ السحب الأدنى', 'Minimum payout')}</th>
                <th scope="col">{t('الحالة', 'Status')}</th>
                <th scope="col" className="end">
                  {t('السعر مقابل الدولار', 'Rate against USD')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.currencies.map((c) => (
                <tr key={c.code}>
                  <td>
                    <span className="num ac2-code">{c.code}</span>
                  </td>
                  <td data-label={t('الاسم', 'Name')}>
                    {nameOf(c)} {c.isBase ? <span className="badge badge--info">{t('المحاسبة', 'Accounting')}</span> : null}
                  </td>
                  <td className="ac2-symbol" data-label={t('العلامة', 'Symbol')}>
                    {c.symbol}
                  </td>
                  <td className="num ac2-dec" data-three={c.minorUnitDigits === 3} data-label={t('الخانات', 'Decimals')}>
                    {c.minorUnitDigits}
                  </td>
                  <td className="money num" data-label={t('حدّ السحب الأدنى', 'Minimum payout')}>
                    {money(c.minPayoutMinorUnits, c.code, locale)}
                  </td>
                  <td data-label={t('الحالة', 'Status')}>
                    {c.isActive ? <span className="badge badge--success">{t('مفعّلة', 'Active')}</span> : <span className="badge badge--pending">{t('موقوفة', 'Inactive')}</span>}
                  </td>
                  <td className="num end" data-label={t('السعر مقابل الدولار', 'Rate against USD')}>
                    {c.currentRate ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ac2-split ac2-split--narrow">
        <section className="card card--flush" aria-label={t('سجلّ أسعار الصرف', 'Exchange rate history')}>
          <header className="card__head">
            <h2 className="ac2-title">{t('سجلّ أسعار الصرف', 'Exchange rate history')}</h2>
            <span className="badge badge--info">{t('إضافة فقط', 'Add-only')}</span>
            {history.data ? (
              <span className="ac2-hint">{t(counted(history.total, ROWS), `${history.total} ${history.total === 1 ? 'row' : 'rows'}`)}</span>
            ) : null}
            <span className="ac2-end ac2-hint">
              {t('هامش فرق الصرف', 'Exchange spread')} <span className="num ac2-code">{pct(data.spreadBps, locale)}</span>
            </span>
          </header>
          {!history.data ? (
            <Loading error={history.error} forbidden={history.forbidden} />
          ) : history.items.length === 0 ? (
            <p className="ac2-section-empty">{t('لم يُسجَّل أي سعر بعد.', 'No rate has been recorded yet.')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('الزوج', 'Pair')}</th>
                    <th scope="col">{t('السعر', 'Rate')}</th>
                    <th scope="col">{t('المصدر', 'Source')}</th>
                    <th scope="col" className="end">
                      {t('السريان', 'Effective')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.items.map((h) => (
                    <tr key={h.id} data-tone={h.current ? 'success' : undefined}>
                      <td className="num">USD → {h.quoteCode}</td>
                      <td className="num ac2-rate" data-label={t('السعر', 'Rate')}>
                        {h.rate}
                      </td>
                      <td className="ac2-muted-cell" data-label={t('المصدر', 'Source')}>
                        {h.source}
                      </td>
                      <td className="end" data-label={t('السريان', 'Effective')}>
                        <span className="ac2-muted-cell">{when(h.effectiveAt, locale)}</span> {h.current ? <span className="badge badge--success">{t('الساري', 'Current')}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <MoreButton list={history} />
            </div>
          )}
        </section>

        <section className="card ac2-sticky" aria-label={t('أضف سعراً', 'Add a rate')}>
          <h2 className="ac2-title">{t('أضف سعراً', 'Add a rate')}</h2>
          <label className="field">
            <span className="field__label">{t('الزوج', 'Pair')}</span>
            <select className="field__control num" value={quote} onChange={(e) => setQuote(e.target.value)}>
              <option value="">{t('اختر العملة', 'Choose currency')}</option>
              {data.currencies.filter((c) => c.code !== 'USD').map((c) => (
                <option key={c.code} value={c.code}>
                  USD → {c.code}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{t('السعر — وحدات لكل دولار', 'Rate — units per US dollar')}</span>
            <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" placeholder="3.7503" aria-invalid={rate !== '' && !rateOk} value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">{t('المصدر', 'Source')}</span>
            <ClearableInput className="field__control" value={source} onChange={(e) => setSource(e.target.value)} placeholder={t('البنك المركزي', 'Central bank')} />
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
                history.reload();
              }, t('أُضيف السعر. يسري على الطلبات من الآن.', 'Rate added. It applies to orders from now on.'))
            }
          >
            {t('أضف السعر', 'Add rate')}
          </button>
          <p className="ac2-fine">{t('يُضاف السعر بتاريخ اليوم ويصبح الساري. الأسعار السابقة تبقى في السجلّ.', 'The rate is added with today’s date and becomes current. Earlier rates stay in the history.')}</p>
        </section>
      </div>
    </div>
  );
}
