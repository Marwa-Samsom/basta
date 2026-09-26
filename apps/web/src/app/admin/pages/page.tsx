'use client';

import { useRef, useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Icon } from '@/components/icons';
import { EmptyState, TextArea, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminData } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Page {
  id: string;
  slug: string;
  titleAr: string;
  bodyAr: string;
  isPublished: boolean;
  updatedAt: string;
}

const EMPTY = { id: '', slug: '', titleAr: '', bodyAr: '', isPublished: false };

const FILTERS = [
  { key: 'all', label: 'الكل', test: () => true },
  { key: 'published', label: 'منشورة', test: (p: Page) => p.isPublished },
  { key: 'draft', label: 'مسوّدة', test: (p: Page) => !p.isPublished },
];

const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/**
 * AD-18 — صفحات المحتوى (من نحن، الشروط، الخصوصية، سياسة الإرجاع). النص
 * يُعرض كما يُكتب بفقراته — سطر فارغ يفصل فقرة عن فقرة.
 */
export default function AdminPagesPage() {
  const { data, error, forbidden, reload } = useAdminData<Page[]>('/admin/pages');
  const act = useAction();
  const [f, setF] = useState(EMPTY);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const editorRef = useRef<HTMLElement | null>(null);
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const save = () =>
    act.run(async () => {
      const body = { slug: f.slug, titleAr: f.titleAr, bodyAr: f.bodyAr, isPublished: f.isPublished };
      if (f.id) await api(`/admin/pages/${f.id}`, { method: 'PUT', body });
      else await api('/admin/pages', { method: 'POST', body });
      setF(EMPTY);
      reload();
    }, f.isPublished ? 'حُفظت ونُشرت.' : 'حُفظت مسوّدة.');

  const open = (next: typeof EMPTY) => {
    setF(next);
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const test = FILTERS.find((x) => x.key === filter)?.test ?? (() => true);
  const term = q.trim();
  const shown = data.filter(test).filter((p) => !term || p.titleAr.includes(term) || p.slug.includes(term.toLowerCase()));

  return (
    <div className="ac2-page">
      <AdminHeader title="صفحات المحتوى" hint="من نحن، الشروط، الخصوصية، سياسة الإرجاع — تُعرض للزوار على /pages." />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="تصفية الصفحات">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}>
              {x.label}
              <span className="tabs__count">{data.filter(x.test).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input type="search" className="field__control" placeholder="ابحث بعنوان الصفحة" aria-label="ابحث بعنوان الصفحة" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" onClick={() => open(EMPTY)}>
            <Icon name="plus" size={15} />
            صفحة جديدة
          </button>
        </div>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      <div className="ac2-split ac2-split--wide">
        {shown.length === 0 ? (
          <EmptyState
            icon="file"
            title={data.length === 0 ? 'لا صفحات بعد' : 'لا صفحات بهذه التصفية'}
            actions={
              data.length === 0 ? null : (
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
                  أزل التصفية
                </button>
              )
            }
          >
            {data.length === 0 ? 'اكتب أول صفحة من المحرّر — تُحفظ مسوّدة حتى تنشرها.' : 'جرّب تصفية أخرى.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">الصفحة</th>
                  <th scope="col">الرابط</th>
                  <th scope="col">آخر تعديل</th>
                  <th scope="col">الكلمات</th>
                  <th scope="col">الحالة</th>
                  <th scope="col" className="end">
                    <span className="visually-hidden">إجراء</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} data-tone={f.id === p.id ? 'selected' : undefined}>
                    <td>
                      <strong>{p.titleAr}</strong>
                    </td>
                    <td className="num" data-label="الرابط">
                      /pages/{p.slug}
                    </td>
                    <td className="ac2-muted-cell" data-label="آخر تعديل">
                      {when(p.updatedAt)}
                    </td>
                    <td className="num" data-label="الكلمات">
                      {words(p.bodyAr)}
                    </td>
                    <td data-label="الحالة">{p.isPublished ? <span className="badge badge--success">منشورة</span> : <span className="badge badge--pending">مسوّدة</span>}</td>
                    <td className="end" data-label="">
                      <span className="ac2-actions">
                        <button type="button" className="btn btn--secondary btn--sm" aria-pressed={f.id === p.id} onClick={() => open({ id: p.id, slug: p.slug, titleAr: p.titleAr, bodyAr: p.bodyAr, isPublished: p.isPublished })}>
                          حرّر
                        </button>
                        {p.isPublished ? (
                          <a className="btn btn--ghost btn--sm" href={`/pages/${p.slug}`} target="_blank" rel="noreferrer">
                            عاين
                          </a>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <section ref={editorRef} className="card ac2-sticky" aria-label={f.id ? 'تحرير الصفحة' : 'صفحة جديدة'}>
          <h2 className="ac2-title">{f.id ? `تحرير «${f.titleAr || 'صفحة'}»` : 'صفحة جديدة'}</h2>
          <TextInput label="العنوان" value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} />
          <TextInput label="المُعرّف النصّي" hint="يظهر في الرابط: /pages/terms" dir="ltr" className="field__control num" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} />
          <TextArea label="النص" hint="سطر فارغ يفصل فقرة عن فقرة." rows={14} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} />
          <div className="ac2-setting__row">
            <span className="ac2-setting__label">
              <span className="field__label">منشورة للزوار</span>
              <span className="ac2-fine">المسوّدة لا تظهر في المتجر.</span>
            </span>
            <button type="button" role="switch" className="ac2-switch" aria-checked={f.isPublished} aria-label="منشورة للزوار" onClick={() => setF({ ...f, isPublished: !f.isPublished })} />
          </div>
          <div className="ac2-form__actions">
            <button type="button" className="btn btn--primary" disabled={act.busy || !f.slug || f.titleAr.length < 2} onClick={() => void save()}>
              {f.isPublished ? 'احفظ وانشر' : 'احفظ مسوّدة'}
            </button>
            {f.id ? (
              <button type="button" className="btn btn--ghost" onClick={() => setF(EMPTY)}>
                تراجع
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
