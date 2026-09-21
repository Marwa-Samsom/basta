'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Card, TextArea, TextInput } from '@/components/ui';
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

/**
 * AD-18 — صفحات المحتوى (من نحن، الشروط، الخصوصية، سياسة الإرجاع). النص
 * يُعرض كما يُكتب بفقراته — سطر فارغ يفصل فقرة عن فقرة.
 */
export default function AdminPagesPage() {
  const { data, error, forbidden, reload } = useAdminData<Page[]>('/admin/pages');
  const act = useAction();
  const [f, setF] = useState(EMPTY);
  if (!data) return <Loading error={error} forbidden={forbidden} />;

  const save = () =>
    act.run(async () => {
      const body = { slug: f.slug, titleAr: f.titleAr, bodyAr: f.bodyAr, isPublished: f.isPublished };
      if (f.id) await api(`/admin/pages/${f.id}`, { method: 'PUT', body });
      else await api('/admin/pages', { method: 'POST', body });
      setF(EMPTY);
      reload();
    }, f.isPublished ? 'حُفظت ونُشرت.' : 'حُفظت مسوّدة.');

  return (
    <div className="stack stack--loose">
      <AdminHeader title="صفحات المحتوى" />
      <Feedback error={act.error} notice={act.notice} />
      <div className="grid-2">
        <Card title="الصفحات">
          <ul className="stack stack--tight">
            {data.map((p) => (
              <li key={p.id} className="row row--between">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setF({ id: p.id, slug: p.slug, titleAr: p.titleAr, bodyAr: p.bodyAr, isPublished: p.isPublished })}>
                  {p.titleAr}
                </button>
                <span className="small muted">
                  {p.isPublished ? (
                    <a href={`/pages/${p.slug}`} target="_blank" rel="noreferrer">
                      منشورة
                    </a>
                  ) : (
                    'مسوّدة'
                  )}{' '}
                  · {when(p.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setF(EMPTY)}>
            صفحة جديدة
          </button>
        </Card>
        <Card title={f.id ? 'تعديل' : 'صفحة جديدة'}>
          <div className="stack">
            <TextInput label="العنوان" value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} />
            <TextInput label="المسار" hint="يظهر في الرابط: /pages/terms" dir="ltr" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} />
            <TextArea label="النص" rows={14} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} />
            <label className="row small">
              <input type="checkbox" checked={f.isPublished} onChange={(e) => setF({ ...f, isPublished: e.target.checked })} /> منشورة للزوار
            </label>
            <button type="button" className="btn btn--primary" disabled={act.busy || !f.slug || f.titleAr.length < 2} onClick={() => void save()}>
              حفظ
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
