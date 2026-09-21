'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { pct, useAction, useAdminData } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Setting {
  key: string;
  labelAr: string;
  kind: 'int' | 'currency' | 'enum';
  min?: number;
  max?: number;
  unit?: string;
  options?: string[];
  financial?: string;
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
 * AD-26 — الإعدادات والضرائب. الإعداد المالي يعرض أثره قبل الحفظ، والحفظ
 * يعيد ذكره في التأكيد. كل تغيير في السجل بقيمته قبل وبعد.
 */
export default function AdminSettingsPage() {
  const { data, error, forbidden, reload } = useAdminData<{ settings: Setting[]; taxes: Tax[] }>('/admin/settings');
  const act = useAction();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tax, setTax] = useState({ country: 'SA', rate: '', inclusive: false });
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const save = (s: Setting) => {
    const raw = draft[s.key] ?? '';
    const value = s.kind === 'int' ? Number(raw) : raw;
    const msg = `${s.labelAr}: ${String(s.value)} ← ${raw}${s.financial ? `\n\n${s.financial}` : ''}`;
    if (!window.confirm(msg)) return;
    void act.run(async () => {
      await api(`/admin/settings/${s.key}`, { method: 'PUT', body: { value } });
      setDraft(({ [s.key]: _, ...rest }) => rest);
      reload();
    }, 'حُفظ الإعداد.');
  };

  return (
    <div className="stack stack--loose">
      <AdminHeader title="الإعدادات والضرائب" />
      <Feedback error={act.error} notice={act.notice} />
      <Card title="إعدادات المنصة">
        <div className="stack">
          {data.settings.map((s) => (
            <div key={s.key} className="row row--between" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="stack stack--tight grow">
                <strong>{s.labelAr}</strong>
                <span className="small muted">
                  الحالي: <span className="num">{s.key.endsWith('_bps') ? pct(Number(s.value)) : String(s.value ?? '—')}</span> {s.unit ?? ''}
                  {s.updatedAt ? ` · عُدِّل ${when(s.updatedAt)}` : ''}
                </span>
                {s.financial ? <span className="small" style={{ color: 'var(--warning-text)' }}>{s.financial}</span> : null}
              </div>
              <div className="row">
                {s.kind === 'int' ? (
                  <input className="field__control" dir="ltr" inputMode="numeric" style={{ width: '8rem' }} placeholder={`${s.min}–${s.max}`} value={draft[s.key] ?? ''} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} aria-label={s.labelAr} />
                ) : (
                  <select className="field__control" value={draft[s.key] ?? String(s.value ?? '')} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} aria-label={s.labelAr}>
                    {(s.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o === 'platform' ? 'المنصة' : o === 'vendor' ? 'البائع' : o}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy || draft[s.key] === undefined || draft[s.key] === String(s.value)} onClick={() => save(s)}>
                  حفظ
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="الضرائب لكل بلد" hint="النسبة الجديدة تُنهي السابقة بتاريخ ولا تحذفها — الطلبات السابقة على لقطتها.">
        <table className="table">
          <tbody>
            {data.taxes.map((t) => (
              <tr key={t.id}>
                <td>{COUNTRIES[t.country] ?? t.country}</td>
                <td className="num">{pct(t.rateBps)}</td>
                <td className="small">{t.isPriceInclusive ? 'شاملة في السعر' : 'مضافة إلى السعر'}</td>
                <td className="small">منذ {when(t.effectiveFrom)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
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
            <input className="field__control" dir="ltr" inputMode="decimal" value={tax.rate} onChange={(e) => setTax({ ...tax, rate: e.target.value })} />
          </label>
          <label className="row small">
            <input type="checkbox" checked={tax.inclusive} onChange={(e) => setTax({ ...tax, inclusive: e.target.checked })} /> شاملة في السعر
          </label>
          <button
            type="button"
            className="btn btn--primary"
            disabled={act.busy || tax.rate === '' || Number.isNaN(Number(tax.rate))}
            onClick={() => {
              if (!window.confirm(`ضريبة ${COUNTRIES[tax.country]} ${tax.rate}% ${tax.inclusive ? 'شاملة' : 'مضافة'} — تسري على الطلبات الجديدة فقط.`)) return;
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
      </Card>
    </div>
  );
}
