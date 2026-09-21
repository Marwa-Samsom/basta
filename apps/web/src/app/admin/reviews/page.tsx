'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, ReasonButton, Tabs } from '@/components/admin';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useAdminData } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: string;
  rejectReason: string | null;
  createdAt: string;
  product: { nameAr: string; slug: string };
  user: { fullName: string | null };
}

/**
 * AD-22 — مراجعات المنتجات. كلها موثّقة بشراء فعلي وتُنشر فوراً؛ الإدارة
 * تُخفي المسيء بسبب مكتوب وتعيده إن أخطأت.
 */
export default function AdminReviewsPage() {
  const [status, setStatus] = useState('published');
  const { data, error, forbidden, reload } = useAdminData<Review[]>(`/admin/reviews?status=${status}`);
  const act = useAction();

  const moderate = (id: string, next: 'published' | 'rejected', reason?: string) =>
    act.run(async () => {
      await api(`/admin/reviews/${id}/moderate`, { method: 'POST', body: { status: next, ...(reason ? { reason } : {}) } });
      reload();
    }, next === 'rejected' ? 'أُخفيت المراجعة.' : 'نُشرت المراجعة.');

  return (
    <div className="stack stack--loose">
      <AdminHeader title="مراجعات المنتجات" hint="كل مراجعة موثّقة بشراء فعلي." />
      <Feedback error={act.error} notice={act.notice} />
      <Tabs value={status} onChange={setStatus} options={[{ key: 'published', label: 'منشورة' }, { key: 'rejected', label: 'مخفية' }]} />
      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : data.length === 0 ? (
        <Card>
          <Empty>لا مراجعات.</Empty>
        </Card>
      ) : (
        data.map((r) => (
          <Card key={r.id}>
            <div className="stack stack--tight">
              <div className="row row--between">
                <span>
                  <span aria-label={`${r.rating} من 5`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span> · {r.product.nameAr}
                </span>
                <span className="small muted">
                  {(r.user.fullName ?? '').split(' ')[0]} · {when(r.createdAt)} · <span className="badge badge--approved">شراء موثّق</span>
                </span>
              </div>
              {r.title ? <strong>{r.title}</strong> : null}
              {r.body ? <p style={{ margin: 0 }}>{r.body}</p> : null}
              {r.rejectReason ? <p className="small muted">سبب الإخفاء: «{r.rejectReason}»</p> : null}
              <div className="row">
                {r.status === 'published' ? (
                  <ReasonButton label="إخفاء" presets={['ألفاظ مسيئة', 'بيانات شخصية', 'لا تتعلّق بالمنتج']} disabled={act.busy} onSubmit={(reason) => moderate(r.id, 'rejected', reason)} />
                ) : (
                  <button type="button" className="btn btn--secondary btn--sm" disabled={act.busy} onClick={() => void moderate(r.id, 'published')}>
                    إعادة النشر
                  </button>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
