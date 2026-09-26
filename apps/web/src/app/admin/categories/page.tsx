'use client';

import { Fragment, useRef, useState, type CSSProperties } from 'react';
import { AdminHeader, Feedback, Loading, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
import { EmptyState } from '@/components/ui';
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

/** سلسلة الآباء من الأقرب إلى الجذر — الخصيصة المربوطة بأيٍّ منها يرثها الفرع */
const ancestorsOf = (cats: Cat[], id: string): string[] => {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out: string[] = [];
  let cur = byId.get(id)?.parentId ?? null;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return out;
};

/**
 * AD-08 التصنيفات · AD-09 الخصائص. الخادم يمنع نقل فرع تحت أحد أبنائه وتجاوز
 * أربعة مستويات — الرسالة تعود هنا كما هي. الخصيصة تُربط بتصنيف فيرثها كل فرعه.
 */
export default function AdminCategoriesPage() {
  const [tab, setTab] = useState('categories');
  return (
    <div className="ac2-page">
      <AdminHeader title="التصنيفات والخصائص" hint="الشجرة حتى أربعة مستويات، والخصيصة المربوطة بتصنيف يرثها كل فرعه." />
      <Tabs value={tab} onChange={setTab} options={[{ key: 'categories', label: 'شجرة التصنيفات' }, { key: 'attributes', label: 'الخصائص' }]} />
      {tab === 'categories' ? <Categories onManageAttributes={() => setTab('attributes')} /> : <Attributes />}
    </div>
  );
}

function Categories({ onManageAttributes }: { onManageAttributes: () => void }) {
  const { data, error, forbidden, reload } = useAdminData<Cat[]>('/admin/categories');
  const { data: attrs } = useAdminData<Attr[]>('/admin/attributes');
  const act = useAction();
  const [draft, setDraft] = useState({ parentId: '', nameAr: '', slug: '' });
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [selId, setSelId] = useState<string | null>(null);
  const newNameRef = useRef<HTMLInputElement | null>(null);
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const patch = (id: string, body: Record<string, unknown>, msg: string) =>
    act.run(async () => {
      await api(`/admin/categories/${id}`, { method: 'PATCH', body });
      reload();
    }, msg);

  const move = (c: Cat, parentId: string) =>
    void act.run(async () => {
      await api(`/admin/categories/${c.id}/move`, { method: 'POST', body: { parentId: parentId || null } });
      reload();
    }, 'نُقل الفرع كاملاً.');

  const startNew = (parentId: string) => {
    setDraft({ parentId, nameAr: '', slug: '' });
    newNameRef.current?.focus();
  };

  const sel = data.find((c) => c.id === selId) ?? data[0] ?? null;
  const ancestors = sel ? ancestorsOf(data, sel.id) : [];
  const selAttrs = sel
    ? (attrs ?? []).flatMap((a) => {
        const own = a.categories.find((l) => l.category.id === sel.id);
        if (own) return [{ id: a.id, name: a.nameAr, inherited: false, required: own.isRequired }];
        const inh = a.categories.find((l) => ancestors.includes(l.category.id));
        return inh ? [{ id: a.id, name: a.nameAr, inherited: true, required: inh.isRequired }] : [];
      })
    : [];

  return (
    <div className="ac2-page">
      <Feedback error={act.error} notice={act.notice} />
      <div className="ac2-split">
        <section className="card card--flush" aria-label="شجرة التصنيفات">
          <header className="card__head">
            <h2 className="ac2-title">الشجرة — حتى 4 مستويات</h2>
            <span className="ac2-hint">اختر تصنيفاً لتحريره، و«+» يضيف فرعاً تحته.</span>
            <span className="ac2-end">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => startNew('')}>
                <Icon name="plus" size={14} />
                قسم رئيسي
              </button>
            </span>
          </header>
          {data.length === 0 ? (
            <EmptyState icon="package" title="لا تصنيفات بعد">
              أضف قسماً رئيسياً من اللوحة الجانبية، ثم فروعه حتى أربعة مستويات.
            </EmptyState>
          ) : (
            <ul className="ac2-tree">
              {data.map((c) => {
                const selected = sel?.id === c.id;
                return (
                  <li key={c.id} className="ac2-node" data-selected={selected} data-depth={c.depth} style={{ '--ac2-depth': c.depth } as CSSProperties}>
                    {editing[c.id] !== undefined ? (
                      <span className="ac2-node__rename">
                        <input className="field__control" aria-label={`الاسم الجديد لـ ${c.nameAr}`} value={editing[c.id]} onChange={(e) => setEditing({ ...editing, [c.id]: e.target.value })} />
                        <button type="button" className="btn btn--primary btn--sm" disabled={act.busy} onClick={() => void patch(c.id, { nameAr: editing[c.id] }, 'حُفظ الاسم.').then(() => setEditing(({ [c.id]: _, ...rest }) => rest))}>
                          حفظ
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(({ [c.id]: _, ...rest }) => rest)}>
                          تراجع
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="ac2-node__pick" aria-pressed={selected} onClick={() => setSelId(c.id)}>
                        <span className="ac2-node__name">{c.nameAr}</span>
                        <span className="ac2-node__meta num" data-hide-sm>
                          {c.slug}
                        </span>
                        <span className="ac2-node__meta num">L{c.depth + 1}</span>
                        <span className="ac2-node__count num" title="عدد المنتجات">
                          {c._count.products}
                        </span>
                      </button>
                    )}
                    {!c.isActive ? <span className="badge badge--pending">مخفي</span> : null}
                    <button type="button" className="icon-btn" aria-label={`إعادة تسمية ${c.nameAr}`} title="إعادة تسمية" onClick={() => setEditing({ ...editing, [c.id]: c.nameAr })}>
                      <Icon name="copy" size={14} />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`أضف فرعاً تحت ${c.nameAr}`} title="أضف فرعاً" disabled={c.depth >= 3} onClick={() => startNew(c.id)}>
                      <Icon name="plus" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="ac2-col ac2-sticky">
          {sel ? (
            <section className="card" aria-label={`تحرير ${sel.nameAr}`}>
              <h2 className="ac2-title">{sel.nameAr}</h2>
              <CategoryEditor key={sel.id} cat={sel} busy={act.busy} onSave={(body) => void patch(sel.id, body, 'حُفظ التصنيف.')} />
              <div className="ac2-setting__row">
                <span className="ac2-setting__label">
                  <span className="field__label">مفعّل</span>
                  <span className="ac2-fine">الإخفاء يُخفي التصنيف وفرعه من الشجرة العامة.</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  className="ac2-switch"
                  aria-checked={sel.isActive}
                  aria-label={`${sel.nameAr} مفعّل`}
                  disabled={act.busy}
                  onClick={() => void patch(sel.id, { isActive: !sel.isActive }, sel.isActive ? 'أُخفي التصنيف.' : 'فُعِّل التصنيف.')}
                />
              </div>
              <label className="field">
                <span className="field__label">نقل تحت</span>
                <select className="field__control" value={sel.parentId ?? ''} aria-label={`نقل ${sel.nameAr}`} onChange={(e) => move(sel, e.target.value)}>
                  <option value="">(قسم رئيسي)</option>
                  {data
                    .filter((p) => p.id !== sel.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {'— '.repeat(p.depth)}
                        {p.nameAr}
                      </option>
                    ))}
                </select>
                <span className="field__hint">يُنقل الفرع كاملاً بأبنائه.</span>
              </label>
              <div className="ac2-divider">
                <span className="field__label">الخصائص</span>
                {selAttrs.length === 0 ? (
                  <p className="ac2-fine">لا خصائص مربوطة بهذا التصنيف أو بآبائه.</p>
                ) : (
                  <ul className="ac2-attrs">
                    {selAttrs.map((a) => (
                      <li key={a.id} className="ac2-attr" data-inherited={a.inherited}>
                        <span className="ac2-attr__name">{a.name}</span>
                        <span className={`badge ${a.inherited ? 'badge--pending' : 'badge--brand'}`}>{a.inherited ? 'موروثة' : 'خاصة'}</span>
                        {a.required ? <span className="ac2-required">إلزامي</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="btn btn--secondary btn--sm" onClick={onManageAttributes}>
                  أدر الخصائص
                </button>
              </div>
            </section>
          ) : null}

          <section className="card" aria-label="تصنيف جديد">
            <h2 className="ac2-title">تصنيف جديد</h2>
            <label className="field">
              <span className="field__label">تحت</span>
              <select className="field__control" value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
                <option value="">(قسم رئيسي)</option>
                {data.filter((c) => c.depth < 3).map((c) => (
                  <option key={c.id} value={c.id}>
                    {'— '.repeat(c.depth)}
                    {c.nameAr}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">الاسم بالعربية</span>
              <input ref={newNameRef} className="field__control" value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">المُعرّف النصّي</span>
              <input className="field__control num" dir="ltr" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} />
              <span className="field__hint">حروف لاتينية صغيرة وأرقام بشرطات.</span>
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
                }, 'أُضيف التصنيف.')
              }
            >
              <Icon name="plus" size={15} />
              إضافة
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

/** حقول التصنيف المختار — تُرسل ما تغيّر وحده */
function CategoryEditor({ cat, busy, onSave }: { cat: Cat; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ nameAr: cat.nameAr, nameEn: cat.nameEn ?? '', slug: cat.slug, sort: String(cat.sort) });
  const body: Record<string, unknown> = {
    ...(f.nameAr.trim() !== cat.nameAr ? { nameAr: f.nameAr.trim() } : {}),
    ...(f.nameEn.trim() && f.nameEn.trim() !== (cat.nameEn ?? '') ? { nameEn: f.nameEn.trim() } : {}),
    ...(f.slug.trim() !== cat.slug ? { slug: f.slug.trim() } : {}),
    ...(f.sort !== String(cat.sort) && /^-?\d+$/.test(f.sort) ? { sort: Number(f.sort) } : {}),
  };
  return (
    <>
      <label className="field">
        <span className="field__label">الاسم بالعربية</span>
        <input className="field__control" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
      </label>
      <label className="field">
        <span className="field__label">Name (English)</span>
        <input className="field__control" dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
      </label>
      <label className="field">
        <span className="field__label">المُعرّف النصّي</span>
        <input className="field__control num" dir="ltr" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} />
      </label>
      <label className="field">
        <span className="field__label">الترتيب</span>
        <input className="field__control num" dir="ltr" inputMode="numeric" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} />
      </label>
      <button type="button" className="btn btn--primary btn--sm" disabled={busy || Object.keys(body).length === 0} onClick={() => onSave(body)}>
        احفظ التغييرات
      </button>
    </>
  );
}

const ATTR_FILTERS = [
  { key: 'all', label: 'الكل', test: () => true },
  { key: 'axis', label: 'محاور المتغيّرات', test: (a: Attr) => a.isVariantAxis },
  { key: 'filter', label: 'قابلة للتصفية', test: (a: Attr) => a.isFilterable },
];

function Attributes() {
  const { data, error, forbidden, reload } = useAdminData<Attr[]>('/admin/attributes');
  const { data: cats } = useAdminData<Cat[]>('/admin/categories');
  const act = useAction();
  const [draft, setDraft] = useState({ code: '', nameAr: '', inputType: 'select', unit: '', values: '', isFilterable: true, isVariantAxis: false });
  const [link, setLink] = useState<Record<string, { categoryId: string; isRequired: boolean }>>({});
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
          {data.length === 0 ? 'أضف أول خصيصة من «خصيصة جديدة» ثم اربطها بتصنيف.' : 'جرّب تصفية أخرى.'}
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
                <th scope="col">التصنيفات</th>
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
                    <td className="wrap ac2-muted-cell" data-label="التصنيفات">
                      {a.categories.map((c) => `${c.category.nameAr}${c.isRequired ? ' (إلزامي)' : ''}`).join(' · ') || '—'}
                    </td>
                    <td className="end" data-label="">
                      <button type="button" className="btn btn--secondary btn--sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.id)}>
                        {isOpen ? 'أغلق' : 'حرّر'}
                      </button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="ac2-expand">
                      <td colSpan={8} data-label="">
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
                          <div className="stack stack--tight">
                            <span className="field__label">ربط بتصنيف</span>
                            <div className="ac2-inline">
                              <select className="field__control" value={link[a.id]?.categoryId ?? ''} onChange={(e) => setLink({ ...link, [a.id]: { categoryId: e.target.value, isRequired: link[a.id]?.isRequired ?? false } })} aria-label="ربط بتصنيف">
                                <option value="">اختر تصنيفاً…</option>
                                {(cats ?? []).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {'— '.repeat(c.depth)}
                                    {c.nameAr}
                                  </option>
                                ))}
                              </select>
                              <label className="ac2-check">
                                <input type="checkbox" checked={link[a.id]?.isRequired ?? false} onChange={(e) => setLink({ ...link, [a.id]: { categoryId: link[a.id]?.categoryId ?? '', isRequired: e.target.checked } })} /> إلزامية
                              </label>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                disabled={!link[a.id]?.categoryId}
                                onClick={() =>
                                  void act.run(async () => {
                                    await api(`/admin/categories/${link[a.id]!.categoryId}/attributes/${a.id}`, { method: 'PUT', body: { isRequired: link[a.id]!.isRequired } });
                                    reload();
                                  }, 'رُبطت الخصيصة — يرثها كل فرع التصنيف.')
                                }
                              >
                                اربط
                              </button>
                            </div>
                            <span className="ac2-fine">يرثها كل فرع التصنيف المربوط.</span>
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
