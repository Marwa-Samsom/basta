'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, ReasonButton, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
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
    <div className="ao-page">
      <AdminHeader title="تقييمات المنتجات" count={data ? `${data.length} تقييم` : undefined} hint="كل مراجعة موثّقة بشراء فعلي." />
      <Feedback error={act.error} notice={act.notice} />
      <Tabs value={status} onChange={setStatus} label="حالة التقييم" options={[{ key: 'published', label: 'منشورة' }, { key: 'rejected', label: 'مخفية' }]} />
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.length === 0 ? (
        <Empty icon="star" title={status === 'published' ? 'لا تقييمات منشورة' : 'لا تقييمات مخفية'}>
          {status === 'published' ? 'تظهر التقييمات هنا فور نشرها من المشترين.' : 'لم تُخفِ الإدارة أي تقييم.'}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>التقييم</th>
                <th>المراجعة</th>
                <th>المنتج</th>
                <th>الشراء</th>
                <th className="end">
                  <span className="visually-hidden">الإجراء</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="ao-stars" role="img" aria-label={`${r.rating} من 5`}>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Icon key={i} name={i <= r.rating ? 'star-fill' : 'star'} size={14} />
                      ))}
                    </span>
                  </td>
                  <td data-label="المراجعة" className="wrap ao-rtext">
                    <span className="ao-stack">
                      {r.title ? <span className="ao-strong">{r.title}</span> : null}
                      {r.body ? <span>{r.body}</span> : null}
                      <span className="ao-stack__sub">
                        {(r.user.fullName ?? '').split(' ')[0]} · {when(r.createdAt)}
                      </span>
                      {r.rejectReason ? (
                        <span className="ao-rownote">
                          <Icon name="alert" size={13} />
                          <span>سبب الإخفاء: «{r.rejectReason}»</span>
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td data-label="المنتج" className="wrap ao-strong">
                    {r.product.nameAr}
                  </td>
                  <td data-label="الشراء">
                    <span className="badge badge--approved">شراء موثّق</span>
                  </td>
                  <td data-label="" className="end">
                    {r.status === 'published' ? (
                      <ReasonButton label="إخفاء" icon="eye-off" presets={['ألفاظ مسيئة', 'بيانات شخصية', 'لا تتعلّق بالمنتج']} disabled={act.busy} onSubmit={(reason) => moderate(r.id, 'rejected', reason)} />
                    ) : (
                      <button type="button" className="btn btn--primary btn--sm" disabled={act.busy} onClick={() => void moderate(r.id, 'published')}>
                        <Icon name="eye" size={14} />
                        إعادة النشر
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
