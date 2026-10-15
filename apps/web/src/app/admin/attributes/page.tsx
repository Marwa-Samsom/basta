'use client';

import { Fragment, useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Icon } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminData } from '@/lib/admin';

interface Attr {
  id: string;
  code: string;
  nameAr: string;
  inputType: string;
  unit: string | null;
  isFilterable: boolean;
  isVariantAxis: boolean;
  values: { id: string; valueAr: string; hexColor: string | null }[];
}

const TYPES: Record<string, string> = { select: 'قائمة', multiselect: 'قائمة متعددة', number: 'رقم', text: 'نص', boolean: 'نعم/لا' };

/**
 * AD-09 الخصائص — مكتبة عامة (اللون، المقاس، الضمان…) يستعملها أي منتج. كانت تُربط
 * بشجرة تصنيفات عامة فيرثها فرعها؛ سقطت الشجرة حين صارت الفئات لكل متجر يديرها
 * البائع بلا إدارة (قرار صاحب المشروع 14 أكتوبر 2026). البائع يختار من هنا محاور
 * متغيّراته ومواصفات منتجه.
 */
export default function AdminAttributesPage() {
  return (
    <div className="ac2-page">
      <AdminHeader
        title="الخصائص"
        hint="مكتبة عامة يختار منها كل بائع محاور متغيّراته (مقاس، لون) ومواصفات منتجه. فئات المتاجر يديرها البائعون أنفسهم."
      />
      <Attributes />
    </div>
  );
}

const ATTR_FILTERS = [
  { key: 'all', label: 'الكل', test: () => true },
  { key: 'axis', label: 'محاور المتغيّرات', test: (a: Attr) => a.isVariantAxis },
  { key: 'filter', label: 'قابلة للتصفية', test: (a: Attr) => a.isFilterable },
];

function Attributes() {
  const { data, error, forbidden, reload } = useAdminData<Attr[]>('/admin/attributes');
  const act = useAction();
  const [draft, setDraft] = useState({ code: '', nameAr: '', inputType: 'select', unit: '', values: '', isFilterable: true, isVariantAxis: false });
  const [newValue, setNewValue] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const test = ATTR_FILTERS.find((f) => f.key === filter)?.test ?? (() => true);
  const term = q.trim();
  const shown = data.filter(test).filter((a) => !term || a.nameAr.includes(term) || a.code.includes(term.toLowerCase()));

  return (
    <div className="ac2-page">
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="تصفية الخصائص">
          {ATTR_FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
              <span className="tabs__count">{data.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input type="search" className="field__control" placeholder="ابحث باسم الخصيصة أو رمزها" aria-label="ابحث في الخصائص" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" aria-expanded={showNew} onClick={() => setShowNew((v) => !v)}>
            <Icon name="plus" size={15} />
            خصيصة جديدة
          </button>
        </div>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      {showNew ? (
        <section className="card" aria-label="خصيصة جديدة">
          <h2 className="ac2-title">خصيصة جديدة</h2>
          <div className="ac2-form">
            <label className="field">
              <span className="field__label">الرمز (لاتيني)</span>
              <input className="field__control num" dir="ltr" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase() })} />
            </label>
            <label className="field">
              <span className="field__label">الاسم</span>
              <input className="field__control" value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">النوع</span>
              <select className="field__control" value={draft.inputType} onChange={(e) => setDraft({ ...draft, inputType: e.target.value })}>
                {Object.entries(TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {draft.inputType === 'number' ? (
              <label className="field">
                <span className="field__label">الوحدة</span>
                <input className="field__control" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
              </label>
            ) : null}
            {draft.inputType === 'select' || draft.inputType === 'multiselect' ? (
              <label className="field ac2-form__wide">
                <span className="field__label">القيم (مفصولة بفاصلة)</span>
                <input className="field__control" value={draft.values} onChange={(e) => setDraft({ ...draft, values: e.target.value })} />
              </label>
            ) : null}
            <div className="ac2-form__actions ac2-form__wide">
              <label className="ac2-check">
                <input type="checkbox" checked={draft.isFilterable} onChange={(e) => setDraft({ ...draft, isFilterable: e.target.checked })} /> تُفلتر بها النتائج
              </label>
              <label className="ac2-check">
                <input type="checkbox" checked={draft.isVariantAxis} onChange={(e) => setDraft({ ...draft, isVariantAxis: e.target.checked })} /> محور متغيّرات (مقاس، لون)
              </label>
              <span className="ac2-end">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={act.busy || !draft.code || !draft.nameAr}
                  onClick={() =>
                    void act.run(async () => {
                      const values = draft.values.split(/[,،]/).map((v) => v.trim()).filter(Boolean).map((valueAr) => ({ valueAr }));
                      await api('/admin/attributes', {
                        method: 'POST',
                        body: {
                          code: draft.code,
                          nameAr: draft.nameAr,
                          inputType: draft.inputType,
                          isFilterable: draft.isFilterable,
                          isVariantAxis: draft.isVariantAxis,
                          ...(draft.unit ? { unit: draft.unit } : {}),
                          ...(values.length ? { values } : {}),
                        },
                      });
                      setDraft({ code: '', nameAr: '', inputType: 'select', unit: '', values: '', isFilterable: true, isVariantAxis: false });
                      reload();
                    }, 'أُضيفت الخصيصة.')
                  }
                >
                  أضف الخصيصة
                </button>
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="file"
          title={data.length === 0 ? 'لا خصائص بعد' : 'لا خصائص بهذه التصفية'}
          actions={
            data.length === 0 ? null : (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
                أزل التصفية
              </button>
            )
          }
        >
          {data.length === 0 ? 'أضف أول خصيصة من «خصيصة جديدة» — يراها كل بائع في محرّر منتجه.' : 'جرّب تصفية أخرى.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">الاسم</th>
                <th scope="col">الرمز</th>
                <th scope="col">النوع</th>
                <th scope="col">الوحدة</th>
                <th scope="col">للتصفية</th>
                <th scope="col">محور</th>
                <th scope="col" className="end">
                  <span className="visually-hidden">إجراء</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const isOpen = open === a.id;
                return (
                  <Fragment key={a.id}>
                  <tr>
                    <td>
                      <strong>{a.nameAr}</strong>
                    </td>
                    <td className="num" data-label="الرمز">
                      {a.code}
                    </td>
                    <td className="small" data-label="النوع">
                      {TYPES[a.inputType] ?? a.inputType}
                    </td>
                    <td className="num ac2-muted-cell" data-label="الوحدة">
                      {a.unit ?? '—'}
                    </td>
                    <td data-label="للتصفية">{a.isFilterable ? <span className="badge badge--success">نعم</span> : <span className="badge badge--pending">لا</span>}</td>
                    <td data-label="محور">{a.isVariantAxis ? <span className="badge badge--brand">محور</span> : <span className="badge badge--pending">—</span>}</td>
                    <td className="end" data-label="">
                      <button type="button" className="btn btn--secondary btn--sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.id)}>
                        {isOpen ? 'أغلق' : 'حرّر'}
                      </button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="ac2-expand">
                      <td colSpan={7} data-label="">
                        <div className="ac2-expand__grid">
                          <div className="stack stack--tight">
                            <span className="field__label">القيم</span>
                            {a.values.length ? (
                              <div className="ac2-values">
                                {a.values.map((v) => (
                                  <span key={v.id} className="badge">
                                    {v.hexColor ? <span className="ac2-swatch" style={{ background: v.hexColor }} aria-hidden /> : null}
                                    {v.valueAr}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="ac2-fine">لا قيم.</span>
                            )}
                            {a.inputType === 'select' || a.inputType === 'multiselect' ? (
                              <div className="ac2-inline">
                                <input className="field__control" placeholder="قيمة جديدة" aria-label={`قيمة جديدة لـ ${a.nameAr}`} value={newValue[a.id] ?? ''} onChange={(e) => setNewValue({ ...newValue, [a.id]: e.target.value })} />
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  disabled={!newValue[a.id]?.trim()}
                                  onClick={() =>
                                    void act.run(async () => {
                                      await api(`/admin/attributes/${a.id}/values`, { method: 'POST', body: { valueAr: newValue[a.id]!.trim() } });
                                      setNewValue({ ...newValue, [a.id]: '' });
                                      reload();
                                    }, 'أُضيفت القيمة.')
                                  }
                                >
                                  <Icon name="plus" size={14} />
                                  أضف قيمة
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
