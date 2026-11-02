'use client';

import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, MoreButton, ReasonButton, SearchBox, SortButton, Tabs } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { useAction, useAdminList } from '@/lib/admin';
import { when } from '@/lib/orders';
import { useLocale, useT } from '@/components/locale';

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
 * تُخفي المسيء بسبب مكتوب وتعيده إن أخطأت. البحث باسم المنتج أو المشتري أو نصّ المراجعة،
 * و«المزيد» لما بعد الخمسين.
 */
export default function AdminReviewsPage() {
  const t = useT();
  const locale = useLocale();
  const [status, setStatus] = useState('published');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const query = new URLSearchParams({ status, sort, ...(search.trim() ? { search: search.trim() } : {}) });
  const list = useAdminList<Review>(`/admin/reviews?${query}`, (r) => r.id);
  const { data, error, forbidden, reload } = list;
  const act = useAction();

  const moderate = (id: string, next: 'published' | 'rejected', reason?: string) =>
    act.run(async () => {
      await api(`/admin/reviews/${id}/moderate`, { method: 'POST', body: { status: next, ...(reason ? { reason } : {}) } });
      reload();
    }, next === 'rejected' ? t('أُخفيت المراجعة.', 'Review hidden.') : t('نُشرت المراجعة.', 'Review published.'));

  return (
    <div className="ao-page">
      <AdminHeader
        title={t('تقييمات المنتجات', 'Product reviews')}
        count={data ? t(`${data.total} تقييم`, `${data.total} ${data.total === 1 ? 'review' : 'reviews'}`) : undefined}
        hint={t('كل مراجعة موثّقة بشراء فعلي.', 'Every review is verified by an actual purchase.')}
      />
      <Feedback error={act.error} notice={act.notice} />
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={setStatus}
          label={t('حالة التقييم', 'Review status')}
          options={[
            { key: 'published', label: t('منشورة', 'Published') },
            { key: 'rejected', label: t('مخفية', 'Hidden') },
          ]}
        />
        <div className="toolbar__end">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={t('المنتج أو المشتري أو نصّ المراجعة', 'Product, buyer, or review text')}
            label={t('بحث في التقييمات', 'Search reviews')}
          />
          <SortButton value={sort} onChange={setSort} />
        </div>
      </div>
      {!data ? (
        <Loading error={error} forbidden={forbidden} onRetry={reload} />
      ) : data.items.length === 0 ? (
        search.trim() ? (
          <Empty
            icon="search"
            title={t('لا تقييمات بهذا البحث', 'No reviews match this search')}
            actions={
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>
                {t('أزل التصفية', 'Clear filters')}
              </button>
            }
          >
            {t('جرّب كلمة أخرى أو الحالة الأخرى.', 'Try another word or the other status.')}
          </Empty>
        ) : (
          <Empty icon="star" title={status === 'published' ? t('لا تقييمات منشورة', 'No published reviews') : t('لا تقييمات مخفية', 'No hidden reviews')}>
            {status === 'published'
              ? t('تظهر التقييمات هنا فور نشرها من المشترين.', 'Reviews appear here as soon as buyers publish them.')
              : t('لم تُخفِ الإدارة أي تقييم.', 'Admins have not hidden any review.')}
          </Empty>
        )
      ) : (
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>{t('التقييم', 'Rating')}</th>
                <th>{t('المراجعة', 'Review')}</th>
                <th>{t('المنتج', 'Product')}</th>
                <th>{t('الشراء', 'Purchase')}</th>
                <th className="end">
                  <span className="visually-hidden">{t('الإجراء', 'Action')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="ao-stars" role="img" aria-label={t(`${r.rating} من 5`, `${r.rating} out of 5`)}>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Icon key={i} name={i <= r.rating ? 'star-fill' : 'star'} size={14} />
                      ))}
                    </span>
                  </td>
                  <td data-label={t('المراجعة', 'Review')} className="wrap ao-rtext">
                    <span className="ao-stack">
                      {r.title ? <span className="ao-strong">{r.title}</span> : null}
                      {r.body ? <span>{r.body}</span> : null}
                      <span className="ao-stack__sub">
                        {(r.user.fullName ?? '').split(' ')[0]} · {when(r.createdAt, locale)}
                      </span>
                      {r.rejectReason ? (
                        <span className="ao-rownote">
                          <Icon name="alert" size={13} />
                          <span>
                            {t('سبب الإخفاء: «', 'Reason for hiding: “')}
                            {r.rejectReason}
                            {t('»', '”')}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td data-label={t('المنتج', 'Product')} className="wrap ao-strong">
                    {r.product.nameAr}
                  </td>
                  <td data-label={t('الشراء', 'Purchase')}>
                    <span className="badge badge--approved">{t('شراء موثّق', 'Verified purchase')}</span>
                  </td>
                  <td data-label="" className="end">
                    {r.status === 'published' ? (
                      <ReasonButton
                        label={t('إخفاء', 'Hide')}
                        icon="eye-off"
                        presets={[t('ألفاظ مسيئة', 'Offensive language'), t('بيانات شخصية', 'Personal data'), t('لا تتعلّق بالمنتج', 'Not about the product')]}
                        disabled={act.busy}
                        onSubmit={(reason) => moderate(r.id, 'rejected', reason)}
                      />
                    ) : (
                      <button type="button" className="btn btn--primary btn--sm" disabled={act.busy} onClick={() => void moderate(r.id, 'published')}>
                        <Icon name="eye" size={14} />
                        {t('إعادة النشر', 'Republish')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton list={list} />
    </div>
  );
}
