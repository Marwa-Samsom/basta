'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading, Tabs } from '@/components/admin';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminData } from '@/lib/admin';

interface Cat {
  id: string;
  parentId: string | null;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  depth: number;
  sort: number;
  isActive: boolean;
  _count: { products: number; children: number };
}

interface Attr {
  id: string;
  code: string;
  nameAr: string;
  inputType: string;
  unit: string | null;
  isFilterable: boolean;
  isVariantAxis: boolean;
  values: { id: string; valueAr: string; hexColor: string | null }[];
  categories: { isRequired: boolean; category: { id: string; nameAr: string } }[];
}

const TYPES: Record<string, string> = { select: 'قائمة', multiselect: 'قائمة متعددة', number: 'رقم', text: 'نص', boolean: 'نعم/لا' };

/**
 * AD-08 الفئات · AD-09 السمات. الخادم يمنع نقل فرع تحت أحد أبنائه وتجاوز
 * أربعة مستويات — الرسالة تعود هنا كما هي. السمة تُربط بفئة فيرثها كل فرعها.
 */
export default function AdminCategoriesPage() {
  const [tab, setTab] = useState('categories');
  return (
    <div className="stack stack--loose">
      <AdminHeader title="الفئات والسمات" />
      <Tabs value={tab} onChange={setTab} options={[{ key: 'categories', label: 'شجرة الفئات' }, { key: 'attributes', label: 'السمات' }]} />
      {tab === 'categories' ? <Categories /> : <Attributes />}
    </div>
  );
}

function Categories() {
  const { data, error, forbidden, reload } = useAdminData<Cat[]>('/admin/categories');
  const act = useAction();
  const [draft, setDraft] = useState({ parentId: '', nameAr: '', slug: '' });
  const [editing, setEditing] = useState<Record<string, string>>({});
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const patch = (id: string, body: Record<string, unknown>, msg: string) =>
    act.run(async () => {
      await api(`/admin/categories/${id}`, { method: 'PATCH', body });
      reload();
    }, msg);

  return (
    <div className="stack">
      <Feedback error={act.error} notice={act.notice} />
      <Card title="فئة جديدة">
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field">
            <span className="field__label">تحت</span>
            <select className="field__control" value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
              <option value="">(جذر)</option>
              {data.filter((c) => c.depth < 3).map((c) => (
                <option key={c.id} value={c.id}>
                  {'— '.repeat(c.depth)}
                  {c.nameAr}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">الاسم</span>
            <input className="field__control" value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">المسار (لاتيني)</span>
            <input className="field__control" dir="ltr" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            disabled={act.busy || !draft.nameAr.trim() || !draft.slug.trim()}
            onClick={() =>
              void act.run(async () => {
                await api('/admin/categories', { method: 'POST', body: { nameAr: draft.nameAr.trim(), slug: draft.slug.trim(), ...(draft.parentId ? { parentId: draft.parentId } : {}) } });
                setDraft({ parentId: draft.parentId, nameAr: '', slug: '' });
                reload();
              }, 'أُضيفت الفئة.')
            }
          >
            إضافة
          </button>
        </div>
      </Card>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>الفئة</th>
              <th>المسار</th>
              <th>منتجات</th>
              <th>نقل إلى</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} style={{ opacity: c.isActive ? 1 : 0.6 }}>
                <td>
                  <span style={{ paddingInlineStart: `${c.depth * 1.25}rem` }} />
                  {editing[c.id] !== undefined ? (
                    <span className="row">
                      <input className="field__control" value={editing[c.id]} onChange={(e) => setEditing({ ...editing, [c.id]: e.target.value })} />
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => void patch(c.id, { nameAr: editing[c.id] }, 'حُفظ الاسم.').then(() => setEditing(({ [c.id]: _, ...rest }) => rest))}>
                        حفظ
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn--ghost btn--sm" title="تعديل الاسم" onClick={() => setEditing({ ...editing, [c.id]: c.nameAr })}>
                      {c.nameAr}
                    </button>
                  )}
                </td>
                <td className="num small" dir="ltr">
                  {c.slug}
                </td>
                <td className="num">{c._count.products}</td>
                <td>
                  <select
                    className="field__control"
                    value={c.parentId ?? ''}
                    aria-label={`نقل ${c.nameAr}`}
                    onChange={(e) =>
                      void act.run(async () => {
                        await api(`/admin/categories/${c.id}/move`, { method: 'POST', body: { parentId: e.target.value || null } });
                        reload();
                      }, 'نُقل الفرع كاملاً.')
                    }
                  >
                    <option value="">(جذر)</option>
                    {data
                      .filter((p) => p.id !== c.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {'— '.repeat(p.depth)}
                          {p.nameAr}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={act.busy} onClick={() => void patch(c.id, { isActive: !c.isActive }, c.isActive ? 'أُخفيت الفئة.' : 'فُعِّلت الفئة.')}>
                    {c.isActive ? 'فعّالة — إخفاء' : 'مخفية — تفعيل'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Attributes() {
  const { data, error, forbidden, reload } = useAdminData<Attr[]>('/admin/attributes');
  const { data: cats } = useAdminData<Cat[]>('/admin/categories');
  const act = useAction();
  const [draft, setDraft] = useState({ code: '', nameAr: '', inputType: 'select', unit: '', values: '', isFilterable: true, isVariantAxis: false });
  const [link, setLink] = useState<Record<string, { categoryId: string; isRequired: boolean }>>({});
  const [newValue, setNewValue] = useState<Record<string, string>>({});
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  return (
    <div className="stack">
      <Feedback error={act.error} notice={act.notice} />
      <Card title="سمة جديدة">
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field">
            <span className="field__label">الرمز (لاتيني)</span>
            <input className="field__control" dir="ltr" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase() })} />
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
            <label className="field">
              <span className="field__label">القيم (مفصولة بفاصلة)</span>
              <input className="field__control" value={draft.values} onChange={(e) => setDraft({ ...draft, values: e.target.value })} />
            </label>
          ) : null}
          <label className="row small">
            <input type="checkbox" checked={draft.isFilterable} onChange={(e) => setDraft({ ...draft, isFilterable: e.target.checked })} /> تُفلتر بها النتائج
          </label>
          <label className="row small">
            <input type="checkbox" checked={draft.isVariantAxis} onChange={(e) => setDraft({ ...draft, isVariantAxis: e.target.checked })} /> محور متغيّرات (مقاس، لون)
          </label>
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
              }, 'أُضيفت السمة.')
            }
          >
            إضافة
          </button>
        </div>
      </Card>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>السمة</th>
              <th>النوع</th>
              <th>القيم</th>
              <th>مربوطة بـ</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.nameAr}
                  <div className="small muted num" dir="ltr">
                    {a.code}
                  </div>
                  <div className="small muted">
                    {a.isFilterable ? 'فلتر' : ''} {a.isVariantAxis ? '· محور متغيّرات' : ''}
                  </div>
                </td>
                <td className="small">
                  {TYPES[a.inputType] ?? a.inputType}
                  {a.unit ? ` (${a.unit})` : ''}
                </td>
                <td className="wrap small">
                  {a.values.map((v) => v.valueAr).join('، ') || '—'}
                  {a.inputType === 'select' || a.inputType === 'multiselect' ? (
                    <div className="row">
                      <input className="field__control" placeholder="قيمة جديدة" value={newValue[a.id] ?? ''} onChange={(e) => setNewValue({ ...newValue, [a.id]: e.target.value })} />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={!newValue[a.id]?.trim()}
                        onClick={() =>
                          void act.run(async () => {
                            await api(`/admin/attributes/${a.id}/values`, { method: 'POST', body: { valueAr: newValue[a.id]!.trim() } });
                            setNewValue({ ...newValue, [a.id]: '' });
                            reload();
                          }, 'أُضيفت القيمة.')
                        }
                      >
                        +
                      </button>
                    </div>
                  ) : null}
                </td>
                <td className="wrap small">
                  {a.categories.map((c) => `${c.category.nameAr}${c.isRequired ? ' (إلزامية)' : ''}`).join('، ') || '—'}
                  <div className="row">
                    <select className="field__control" value={link[a.id]?.categoryId ?? ''} onChange={(e) => setLink({ ...link, [a.id]: { categoryId: e.target.value, isRequired: link[a.id]?.isRequired ?? false } })} aria-label="ربط بفئة">
                      <option value="">ربط بفئة…</option>
                      {(cats ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {'— '.repeat(c.depth)}
                          {c.nameAr}
                        </option>
                      ))}
                    </select>
                    <label className="row">
                      <input type="checkbox" checked={link[a.id]?.isRequired ?? false} onChange={(e) => setLink({ ...link, [a.id]: { categoryId: link[a.id]?.categoryId ?? '', isRequired: e.target.checked } })} /> إلزامية
                    </label>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!link[a.id]?.categoryId}
                      onClick={() =>
                        void act.run(async () => {
                          await api(`/admin/categories/${link[a.id]!.categoryId}/attributes/${a.id}`, { method: 'PUT', body: { isRequired: link[a.id]!.isRequired } });
                          reload();
                        }, 'رُبطت السمة — يرثها كل فرع الفئة.')
                      }
                    >
                      ربط
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
