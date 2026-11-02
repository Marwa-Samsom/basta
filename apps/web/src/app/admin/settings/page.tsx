'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData } from '@/lib/admin';
import { toLatinDigits } from '@/lib/digits';
import { daysAr, when } from '@/lib/orders';
import { ClearableInput } from '@/components/ui';

interface Setting {
  key: string;
  labelAr: string;
  kind: 'int' | 'currency' | 'enum' | 'text';
  min?: number;
  max?: number;
  unit?: string;
  options?: string[];
  financial?: string;
  maxLength?: number;
  hint?: string;
  value: unknown;
  updatedAt: string | null;
}

interface Tax {
  id: string;
  country: string;
  rateBps: number;
  isPriceInclusive: boolean;
  effectiveFrom: string;
}

const COUNTRIES: Record<string, string> = { SA: 'السعودية', AE: 'الإمارات', JO: 'الأردن', EG: 'مصر', KW: 'الكويت' };

/**
 * قيمة الخانة الرقمية إن صلحت للحفظ، وإلا null. الخانة الفارغة لا تُحفظ صفراً:
 * Number('') = 0 كان يحفظ «تعليق رصيد البائع» 0 فتتحرّر أموال البائعين فور
 * التسليم، والصفر قيمة مشروعة يقبلها الخادم فلا يردّها (ACFG-024).
 */
function intValue(s: Setting, raw: string): number | null {
  const digits = toLatinDigits(raw).trim();
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return (s.min === undefined || n >= s.min) && (s.max === undefined || n <= s.max) ? n : null;
}

/**
 * التعليق أقصر من مهلة الإرجاع: مال البائع يتحرّر والمشتري ما زال يستطيع الإرجاع، والصفر
 * يحرّره عند التسليم. كانت النافذة تعرض الجملة العامة وحدها، فيُحفظ الصفر ولا شيء يقول
 * ما يعنيه (SYS-022، 2 نوفمبر 2026).
 */
function holdWarning(days: number, returnDays: number): string | null {
  if (days >= returnDays) return null;
  const returns = `مهلة الإرجاع (${daysAr(returnDays)})`;
  return days === 0
    ? `صفر: مال البائع يتحرّر عند تأكيد التسليم، بأول دورة تحرير، قبل أن تنتهي ${returns} — فقد يُطلب ردّ مالٍ صُرف.`
    : `أقصر من ${returns}: مال البائع يتحرّر والمشتري ما زال يستطيع الإرجاع — فقد يُطلب ردّ مالٍ صُرف.`;
}

/**
 * AD-26 — الإعدادات والضرائب. الإعداد المالي يعرض أثره قبل الحفظ، والحفظ
 * يعيد ذكره في التأكيد. كل تغيير في السجل بقيمته قبل وبعد.
 */
export default function AdminSettingsPage() {
  const { data, error, forbidden, reload } = useAdminData<{ settings: Setting[]; taxes: Tax[] }>('/admin/settings');
  const act = useAction();
  const ask = useConfirm();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tax, setTax] = useState({ country: 'SA', rate: '', inclusive: false });
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const save = async (s: Setting) => {
    const raw = draft[s.key] ?? '';
    const value = s.kind === 'int' ? intValue(s, raw) : raw;
    if (value === null) return;
    const returnDays = Number(data.settings.find((x) => x.key === 'return_window_days')?.value ?? 0);
    const warning = s.key === 'hold_period_days' && typeof value === 'number' ? holdWarning(value, returnDays) : null;
    const sure = await ask({
      title: `تغيّر «${s.labelAr}»؟`,
      body: (
        <>
          <p>
            <bdi className="num">{String(s.value ?? '—')}</bdi> ← <bdi className="num">{String(value) || '—'}</bdi>
          </p>
          {s.financial ? <p>{s.financial}</p> : null}
          {warning ? (
            <p>
              <strong>{warning}</strong>
            </p>
          ) : null}
        </>
      ),
      confirmLabel: 'احفظ الإعداد',
    });
    if (!sure) return;
    void act.run(async () => {
      await api(`/admin/settings/${s.key}`, { method: 'PUT', body: { value } });
      setDraft(({ [s.key]: _, ...rest }) => rest);
      reload();
    }, 'حُفظ الإعداد.');
  };

  // بيانات التحويل معاً: ما يراه المشتري بعد «أكّد الطلب» — المستفيد ووجهة واحدة على الأقل شرطٌ لقبول الطلبات
  const isTransfer = (s: Setting) => s.key.startsWith('transfer_');
  const groups = [
    { title: 'الدفع بالتحويل', rows: data.settings.filter(isTransfer) },
    { title: 'إعدادات مالية', rows: data.settings.filter((s) => s.financial && !isTransfer(s)) },
    { title: 'إعدادات التشغيل', rows: data.settings.filter((s) => !s.financial && !isTransfer(s)) },
  ].filter((g) => g.rows.length > 0);
  const dirty = Object.entries(draft).some(([k, v]) => String(data.settings.find((s) => s.key === k)?.value ?? '') !== v);

  const row = (s: Setting) => {
    const changed = draft[s.key] !== undefined && draft[s.key] !== String(s.value ?? '');
    const invalid = s.kind === 'int' && changed && intValue(s, draft[s.key] ?? '') === null;
    return (
      <div key={s.key} className="ac2-setting">
        <div className="ac2-setting__row">
          <span className="ac2-setting__label">
            <span className="ac2-setting__name">{s.labelAr}</span>
            <span className="ac2-setting__key">{s.key}</span>
          </span>
          {s.kind === 'int' ? (
            <span className="ac2-unit">
              <ClearableInput
                className="field__control num"
                dir="ltr"
                inputMode="numeric"
                placeholder={`${s.min}–${s.max}`}
                value={draft[s.key] ?? String(s.value ?? '')}
                onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
                aria-label={s.labelAr}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${s.key}-error` : undefined}
              />
              {s.unit ? <span className="ac2-unit__suffix">{s.unit}</span> : null}
            </span>
          ) : s.kind === 'text' ? (
            <ClearableInput
              className="field__control ac2-setting__text"
              dir={s.key === 'transfer_iban' || s.key === 'transfer_cliq_alias' ? 'ltr' : undefined}
              maxLength={s.maxLength}
              placeholder={s.hint ?? ''}
              value={draft[s.key] ?? String(s.value ?? '')}
              onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
              aria-label={s.labelAr}
            />
          ) : (
            <select className="field__control ac2-setting__select" value={draft[s.key] ?? String(s.value ?? '')} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} aria-label={s.labelAr}>
              {(s.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o === 'platform' ? 'المنصة' : o === 'vendor' ? 'البائع' : o}
                </option>
              ))}
            </select>
          )}
          <button type="button" className={`btn btn--sm ${changed && !invalid ? 'btn--primary' : 'btn--secondary'}`} disabled={act.busy || !changed || invalid} onClick={() => void save(s)}>
            حفظ
          </button>
        </div>
        {invalid ? (
          <span id={`${s.key}-error`} className="field__error" role="alert">
            اكتب رقماً صحيحاً من <bdi className="num">{s.min}</bdi> إلى <bdi className="num">{s.max}</bdi>.
          </span>
        ) : null}
        <span className="ac2-setting__now">
          الحالي: <span className="num">{s.key.endsWith('_bps') ? pct(Number(s.value)) : String(s.value ?? '—')}</span> {s.unit ?? ''}
          {s.updatedAt ? ` · عُدِّل ${when(s.updatedAt)}` : ''}
        </span>
        {s.financial ? (
          <span className="alert alert--warning ac2-callout ac2-callout--sm">
            <Icon name="alert" size={14} />
            <span>{s.financial}</span>
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="ac2-page">
      <AdminHeader title="إعدادات المنصّة والضرائب" hint="الإعداد المالي يذكر أثره قبل الحفظ، وكل تغيير يُسجَّل في سجلّ التدقيق بقيمته قبل وبعد." />
      <Feedback error={act.error} notice={act.notice} />

      <div className="ac2-split">
        <div className="ac2-col">
          {groups.map((g) => (
            <section key={g.title} className="card card--flush" aria-label={g.title}>
              <header className="card__head">
                <h2 className="ac2-title">{g.title}</h2>
              </header>
              {g.rows.map(row)}
            </section>
          ))}
          {dirty ? (
            <span className="ac2-switch-row ac2-note-warning">
              <span className="dot" aria-hidden />
              تغييرات غير محفوظة — كل إعداد يُحفظ بزرّه.
            </span>
          ) : null}
        </div>

        <section className="card card--flush ac2-sticky" aria-label="الضرائب لكل بلد">
          <header className="card__head">
            <h2 className="ac2-title">الضرائب لكل بلد</h2>
          </header>
          <p className="ac2-section-empty">النسبة الجديدة تُنهي السابقة بتاريخ ولا تحذفها — الطلبات السابقة على لقطتها.</p>
          {data.taxes.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">البلد</th>
                    <th scope="col">النسبة</th>
                    <th scope="col" className="end">
                      منذ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.taxes.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span className="ac2-cell">
                          <span className="ac2-cell__main">{COUNTRIES[t.country] ?? t.country}</span>
                          <span className="ac2-cell__sub">{t.isPriceInclusive ? 'شاملة في السعر' : 'مضافة إلى السعر'}</span>
                        </span>
                      </td>
                      <td className="num ac2-rate" data-label="النسبة">
                        {pct(t.rateBps)}
                      </td>
                      <td className="end ac2-muted-cell" data-label="منذ">
                        {when(t.effectiveFrom)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="card__body">
            <div className="ac2-form">
              <label className="field">
                <span className="field__label">البلد</span>
                <select className="field__control" value={tax.country} onChange={(e) => setTax({ ...tax, country: e.target.value })}>
                  {Object.entries(COUNTRIES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">النسبة %</span>
                <ClearableInput className="field__control num" dir="ltr" inputMode="decimal" value={tax.rate} onChange={(e) => setTax({ ...tax, rate: e.target.value })} />
              </label>
            </div>
            <label className="ac2-check">
              <input type="checkbox" checked={tax.inclusive} onChange={(e) => setTax({ ...tax, inclusive: e.target.checked })} /> شاملة في السعر
            </label>
            <button
              type="button"
              className="btn btn--primary"
              disabled={act.busy || tax.rate === '' || Number.isNaN(Number(tax.rate))}
              onClick={async () => {
                const sure = await ask({
                  title: `تعتمد ضريبة ${COUNTRIES[tax.country]} ${tax.rate}% ${tax.inclusive ? 'شاملة في السعر' : 'مضافة على السعر'}؟`,
                  body: 'تسري على الطلبات الجديدة فقط.',
                  confirmLabel: 'اعتمد الضريبة',
                });
                if (!sure) return;
                void act.run(async () => {
                  await api(`/admin/taxes/${tax.country}`, { method: 'PUT', body: { rateBps: Math.round(Number(tax.rate) * 100), isPriceInclusive: tax.inclusive } });
                  setTax({ ...tax, rate: '' });
                  reload();
                }, 'سُجّلت الضريبة الجديدة.');
              }}
            >
              اعتماد
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
