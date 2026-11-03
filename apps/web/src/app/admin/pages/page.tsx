'use client';

import { useRef, useState } from 'react';
import { AdminHeader, Feedback, Loading, MoreButton } from '@/components/admin';
import { Icon } from '@/components/icons';
import { EmptyState, TextArea, TextInput } from '@/components/ui';
import { useLocale, useT } from '@/components/locale';
import { api } from '@/lib/api';
import { useAction, useAdminList } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Page {
  id: string;
  slug: string;
  titleAr: string;
  bodyAr: string;
  isPublished: boolean;
  updatedAt: string;
}

type Filter = 'all' | 'published' | 'draft';

const EMPTY = { id: '', slug: '', titleAr: '', bodyAr: '', isPublished: false };

const FILTERS: { key: Filter; label: string; en: string }[] = [
  { key: 'all', label: 'الكل', en: 'All' },
  { key: 'published', label: 'منشورة', en: 'Published' },
  { key: 'draft', label: 'مسوّدة', en: 'Draft' },
];

const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/**
 * AD-18 — صفحات المحتوى (من نحن، الشروط، الخصوصية، سياسة الإرجاع). النص
 * يُعرض كما يُكتب بفقراته — سطر فارغ يفصل فقرة عن فقرة.
 *
 * الحالة والبحث والصفحات من الخادم (3 نوفمبر 2026): كانت الصفحات كلها تُجلب وتُصفّى هنا،
 * 263 صفحة بلا «المزيد» ولا «السابق» (ACFG-056).
 */
export default function AdminPagesPage() {
  const t = useT();
  const locale = useLocale();
  const act = useAction();
  const [f, setF] = useState(EMPTY);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const query = new URLSearchParams({ ...(filter !== 'all' ? { status: filter } : {}), ...(q.trim() ? { search: q.trim() } : {}) });
  const list = useAdminList<Page, { counts: Record<Filter, number> }>(`/admin/pages?${query}`, (p) => p.id);
  const { data, error, forbidden, reload } = list;
  const editorRef = useRef<HTMLElement | null>(null);
  if (!data) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;

  const save = () =>
    act.run(async () => {
      const body = { slug: f.slug, titleAr: f.titleAr, bodyAr: f.bodyAr, isPublished: f.isPublished };
      if (f.id) await api(`/admin/pages/${f.id}`, { method: 'PUT', body });
      else await api('/admin/pages', { method: 'POST', body });
      setF(EMPTY);
      reload();
    }, f.isPublished ? t('حُفظت ونُشرت.', 'Saved and published.') : t('حُفظت مسوّدة.', 'Saved as draft.'));

  const open = (next: typeof EMPTY) => {
    setF(next);
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const shown = list.items;
  const none = data.counts.all === 0;

  return (
    <div className="ac2-page">
      <AdminHeader
        title={t('صفحات المحتوى', 'Content pages')}
        hint={t('من نحن، الشروط، الخصوصية، سياسة الإرجاع — تُعرض للزوار على /pages.', 'About us, terms, privacy, return policy — shown to visitors at /pages.')}
      />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label={t('تصفية الصفحات', 'Filter pages')}>
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}>
              {t(x.label, x.en)}
              <span className="tabs__count">{data.counts[x.key]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input type="search" className="field__control" placeholder={t('ابحث بعنوان الصفحة أو رابطها', 'Search by page title or link')} aria-label={t('ابحث بعنوان الصفحة', 'Search by page title')} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" onClick={() => open(EMPTY)}>
            <Icon name="plus" size={15} />
            {t('صفحة جديدة', 'New page')}
          </button>
        </div>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      <div className="ac2-split ac2-split--wide">
        {shown.length === 0 ? (
          <EmptyState
            icon="file"
            title={none ? t('لا صفحات بعد', 'No pages yet') : t('لا صفحات بهذه التصفية', 'No pages match this filter')}
            actions={
              none ? null : (
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
                  {t('أزل التصفية', 'Clear filters')}
                </button>
              )
            }
          >
            {none
              ? t('اكتب أول صفحة من المحرّر — تُحفظ مسوّدة حتى تنشرها.', 'Write the first page in the editor — it is saved as a draft until you publish it.')
              : t('جرّب تصفية أخرى.', 'Try another filter.')}
          </EmptyState>
        ) : (
          <div className="ac2-col">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('الصفحة', 'Page')}</th>
                    <th scope="col">{t('الرابط', 'Link')}</th>
                    <th scope="col">{t('آخر تعديل', 'Last edited')}</th>
                    <th scope="col">{t('الكلمات', 'Words')}</th>
                    <th scope="col">{t('الحالة', 'Status')}</th>
                    <th scope="col" className="end">
                      <span className="visually-hidden">{t('إجراء', 'Action')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} data-tone={f.id === p.id ? 'selected' : undefined}>
                      <td>
                        <strong>{p.titleAr}</strong>
                      </td>
                      <td className="num" data-label={t('الرابط', 'Link')}>
                        /pages/{p.slug}
                      </td>
                      <td className="ac2-muted-cell" data-label={t('آخر تعديل', 'Last edited')}>
                        {when(p.updatedAt, locale)}
                      </td>
                      <td className="num" data-label={t('الكلمات', 'Words')}>
                        {words(p.bodyAr)}
                      </td>
                      <td data-label={t('الحالة', 'Status')}>
                        {p.isPublished ? <span className="badge badge--success">{t('منشورة', 'Published')}</span> : <span className="badge badge--pending">{t('مسوّدة', 'Draft')}</span>}
                      </td>
                      <td className="end" data-label="">
                        <span className="ac2-actions">
                          <button type="button" className="btn btn--secondary btn--sm" aria-pressed={f.id === p.id} onClick={() => open({ id: p.id, slug: p.slug, titleAr: p.titleAr, bodyAr: p.bodyAr, isPublished: p.isPublished })}>
                            {t('حرّر', 'Edit')}
                          </button>
                          {p.isPublished ? (
                            <a className="btn btn--ghost btn--sm" href={`/pages/${p.slug}`} target="_blank" rel="noreferrer">
                              {t('عاين', 'Preview')}
                            </a>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <MoreButton list={list} />
          </div>
        )}

        <section ref={editorRef} className="card ac2-sticky" aria-label={f.id ? t('تحرير الصفحة', 'Edit page') : t('صفحة جديدة', 'New page')}>
          <h2 className="ac2-title">{f.id ? t(`تحرير «${f.titleAr || 'صفحة'}»`, `Edit “${f.titleAr || 'page'}”`) : t('صفحة جديدة', 'New page')}</h2>
          <TextInput label={t('العنوان', 'Title')} value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} />
          <TextInput label={t('المُعرّف النصّي', 'Slug')} hint={
              // الرابط بالمعرّف المكتوب لا بمثال ثابت: «tajriba» كانت تقول «/pages/terms»
              f.slug
                ? t(`يظهر في الرابط: /pages/${f.slug}`, `Shown in the link: /pages/${f.slug}`)
                : t('يظهر في الرابط، مثلاً: /pages/terms', 'Shown in the link, for example: /pages/terms')
            } dir="ltr" className="field__control num" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} />
          <TextArea label={t('النص', 'Text')} hint={t('سطر فارغ يفصل فقرة عن فقرة.', 'A blank line separates paragraphs.')} rows={14} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} />
          <div className="ac2-setting__row">
            <span className="ac2-setting__label">
              <span className="field__label">{t('منشورة للزوار', 'Published for visitors')}</span>
              <span className="ac2-fine">{t('المسوّدة لا تظهر في المتجر.', 'Drafts do not appear in the store.')}</span>
            </span>
            <button type="button" role="switch" className="ac2-switch" aria-checked={f.isPublished} aria-label={t('منشورة للزوار', 'Published for visitors')} onClick={() => setF({ ...f, isPublished: !f.isPublished })} />
          </div>
          <div className="ac2-form__actions">
            <button type="button" className="btn btn--primary" disabled={act.busy || !f.slug || f.titleAr.length < 2} onClick={() => void save()}>
              {f.isPublished ? t('احفظ وانشر', 'Save and publish') : t('احفظ مسوّدة', 'Save draft')}
            </button>
            {f.id ? (
              <button type="button" className="btn btn--ghost" onClick={() => setF(EMPTY)}>
                {t('تراجع', 'Cancel')}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
