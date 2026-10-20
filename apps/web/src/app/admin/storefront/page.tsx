'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading, SearchBox } from '@/components/admin';
import { Icon } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import { api } from '@/lib/api';
import { media, useAction, useAdminData } from '@/lib/admin';
import { when } from '@/lib/orders';

interface Banner {
  id: string;
  placement: string;
  imageKey: string;
  imageUrl: string;
  linkUrl: string | null;
  titleAr: string | null;
  sort: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

const PLACEMENTS: Record<string, string> = { home_hero: 'أعلى الرئيسية', home_middle: 'وسط الرئيسية' };
/** لافتات «أعلى صفحة التصنيف» القديمة — بلا صفحة تظهر فيها منذ صارت الفئات لكل متجر، فأُطفئت */
const RETIRED: Record<string, string> = { category_top: 'أعلى صفحة التصنيف (أُلغي الموضع)' };

/** المنتج درجةً أعلى في ترتيب المميّز */
function up(ids: string[], id: string): string[] {
  const i = ids.indexOf(id);
  if (i <= 0) return ids;
  const next = [...ids];
  [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
  return next;
}

const FILTERS = [
  { key: 'all', label: 'الكل', test: () => true },
  { key: 'home', label: 'الرئيسية', test: (b: Banner) => b.placement.startsWith('home_') },
];

/**
 * AD-17 و AD-19 — اللافتات والمنتجات المميّزة. الصورة تُرفع أولاً فتُحوَّل
 * WebP بعرض 1600، ثم تُحفظ اللافتة بمفتاحها. المميّز منتجات منشورة فقط،
 * بالترتيب الذي تضعه هنا.
 *
 * المنتج المميّز يُختار ببحث، والقائمة تأتي بأسمائها من الخادم (20 أكتوبر 2026): كانت الأسماء
 * والاختيار من أحدث مئة منتج منشور، فما سواها يظهر بأول معرّفه ولا يُضاف.
 */
export default function AdminStorefrontPage() {
  const banners = useAdminData<Banner[]>('/admin/banners');
  const featured = useAdminData<{ id: string; nameAr: string | null; vendor: string | null; active: boolean }[]>('/admin/storefront/featured');
  const [productSearch, setProductSearch] = useState('');
  const pq = new URLSearchParams({ status: 'active', pageSize: '20', ...(productSearch.trim() ? { search: productSearch.trim() } : {}) });
  const products = useAdminData<{ items: { id: string; nameAr: string; vendor: { nameAr: string } }[]; total: number }>(`/admin/products?${pq}`);
  const act = useAction();
  const [draft, setDraft] = useState({ placement: 'home_hero', titleAr: '', linkUrl: '/shops', imageKey: '', imageUrl: '', startsAt: '', endsAt: '' });
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  const upload = async (file: File) => {
    await act.run(async () => {
      const json = await api<{ imageKey: string; imageUrl: string }>('/admin/banners/image', { method: 'POST', file });
      setDraft((d) => ({ ...d, imageKey: json.imageKey, imageUrl: json.imageUrl }));
    }, 'رُفعت الصورة.');
  };

  const saveFeatured = (ids: string[]) =>
    act.run(async () => {
      await api('/admin/storefront/featured', { method: 'PUT', body: { productIds: ids } });
      featured.reload();
    }, 'حُفظ المميّز.');

  if (!banners.data) return <Loading error={banners.error} forbidden={banners.forbidden} />;
  const all = banners.data;
  // ما لم يعد منشوراً يظهر معلَّماً، ويسقط من أي حفظ — الحفظ يقبل المنشور وحده
  const rows = featured.data ?? [];
  const ids = rows.filter((p) => p.active).map((p) => p.id);
  const test = FILTERS.find((x) => x.key === filter)?.test ?? (() => true);
  const term = q.trim();
  const shown = all.filter(test).filter((b) => !term || (b.titleAr ?? '').includes(term));

  return (
    <div className="ac2-page">
      <AdminHeader title="الواجهة واللافتات" hint="اللافتات بمواضعها وجدولتها، والمنتجات المميّزة في الرئيسية." />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="تصفية اللافتات">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" className="tabs__tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)}>
              {x.label}
              <span className="tabs__count">{all.filter(x.test).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__end">
          <label className="input-icon ac2-search">
            <Icon name="search" size={15} />
            <input type="search" className="field__control" placeholder="ابحث بعنوان اللافتة" aria-label="ابحث بعنوان اللافتة" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--primary" aria-expanded={showNew} onClick={() => setShowNew((v) => !v)}>
            <Icon name="plus" size={15} />
            لافتة جديدة
          </button>
        </div>
      </div>

      <Feedback error={act.error} notice={act.notice} />

      {showNew ? (
        <section className="card" aria-label="لافتة جديدة">
          <h2 className="ac2-title">لافتة جديدة</h2>
          <p className="ac2-hint">الصورة أولاً (600 بكسل عرضاً على الأقل)، ثم الموضع والعنوان والرابط والجدولة.</p>
          <div className="ac2-form">
            <label className="field ac2-form__wide">
              <span className="field__label">الصورة (600 بكسل عرضاً على الأقل)</span>
              <input type="file" accept="image/*" className="field__control" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            </label>
            <label className="field">
              <span className="field__label">الموضع</span>
              <select className="field__control" value={draft.placement} onChange={(e) => setDraft({ ...draft, placement: e.target.value })}>
                {Object.entries(PLACEMENTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">العنوان</span>
              <input className="field__control" value={draft.titleAr} onChange={(e) => setDraft({ ...draft, titleAr: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">الرابط (مسار داخلي)</span>
              <input className="field__control num" dir="ltr" value={draft.linkUrl} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">يبدأ</span>
              <input type="datetime-local" className="field__control" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">ينتهي</span>
              <input type="datetime-local" className="field__control" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
            </label>
          </div>
          {draft.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media(draft.imageUrl) ?? ''} alt="معاينة" className="ac2-preview-img" />
          ) : null}
          <div className="ac2-form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={act.busy || !draft.imageKey}
              onClick={() =>
                void act.run(async () => {
                  await api('/admin/banners', {
                    method: 'POST',
                    body: {
                      placement: draft.placement,
                      imageKey: draft.imageKey,
                      titleAr: draft.titleAr || null,
                      linkUrl: draft.linkUrl || null,
                      sort: all.filter((b) => b.placement === draft.placement).length,
                      isActive: true,
                      ...(draft.startsAt ? { startsAt: new Date(draft.startsAt).toISOString() } : {}),
                      ...(draft.endsAt ? { endsAt: new Date(draft.endsAt).toISOString() } : {}),
                    },
                  });
                  setDraft({ ...draft, imageKey: '', imageUrl: '', titleAr: '' });
                  banners.reload();
                }, 'نُشرت اللافتة.')
              }
            >
              انشر اللافتة
            </button>
          </div>
        </section>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon="image"
          title={all.length === 0 ? 'لا لافتات بعد' : 'لا لافتات بهذه التصفية'}
          actions={
            all.length === 0 ? (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowNew(true)}>
                <Icon name="plus" size={14} />
                لافتة جديدة
              </button>
            ) : (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFilter('all'), setQ(''))}>
                أزل التصفية
              </button>
            )
          }
        >
          {all.length === 0 ? 'ارفع صورة لافتة واختر موضعها في الواجهة.' : 'جرّب تصفية أخرى أو أضف لافتة.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">اللافتة</th>
                <th scope="col">الموضع</th>
                <th scope="col">الترتيب</th>
                <th scope="col">الجدولة</th>
                <th scope="col" className="end">
                  ظاهرة
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.id} data-tone={b.isActive ? undefined : 'off'}>
                  <td>
                    <span className="ac2-banner">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={media(b.imageUrl) ?? ''} alt="" className="ac2-thumb" />
                      <span className="ac2-cell">
                        <span className="ac2-cell__main">{b.titleAr ?? '—'}</span>
                        <span className="ac2-cell__sub num">{b.linkUrl ?? '—'}</span>
                      </span>
                    </span>
                  </td>
                  <td className="ac2-muted-cell" data-label="الموضع">
                    {PLACEMENTS[b.placement] ?? RETIRED[b.placement] ?? b.placement}
                  </td>
                  <td className="num" data-label="الترتيب">
                    {b.sort}
                  </td>
                  <td className="ac2-muted-cell" data-label="الجدولة">
                    {b.startsAt ? when(b.startsAt) : 'الآن'} — {b.endsAt ? when(b.endsAt) : 'مفتوح'}
                  </td>
                  <td className="end" data-label="ظاهرة">
                    <button
                      type="button"
                      role="switch"
                      className="ac2-switch"
                      aria-checked={b.isActive}
                      aria-label={`إظهار ${b.titleAr ?? 'اللافتة'}`}
                      disabled={act.busy}
                      onClick={() =>
                        void act.run(async () => {
                          await api(`/admin/banners/${b.id}`, {
                            method: 'PATCH',
                            body: { placement: b.placement, imageKey: b.imageKey, linkUrl: b.linkUrl, titleAr: b.titleAr, sort: b.sort, startsAt: b.startsAt, endsAt: b.endsAt, isActive: !b.isActive },
                          });
                          banners.reload();
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="card card--flush" aria-label="المنتجات المميّزة في الرئيسية">
        <header className="card__head">
          <h2 className="ac2-title">المنتجات المميّزة في الرئيسية</h2>
          <span className="ac2-hint">بالترتيب الظاهر — حتى 24 منتجاً منشوراً.</span>
          <span className="ac2-end num ac2-hint">{ids.length} / 24</span>
        </header>
        {rows.length === 0 ? (
          <p className="ac2-section-empty">لا منتجات مميّزة بعد — أضف منتجاً منشوراً من القائمة أدناه.</p>
        ) : (
          <ol className="ac2-rank">
            {rows.map((p, i) => (
              <li key={p.id} className="ac2-rank__item">
                <span className="ac2-rank__num">{i + 1}</span>
                <span className="ac2-rank__name">
                  {p.nameAr ?? p.id.slice(0, 8)}
                  {p.vendor ? <span className="ac2-hint"> — {p.vendor}</span> : null}
                  {p.active ? null : <span className="badge badge--warning">لم يعد منشوراً — يسقط عند الحفظ</span>}
                </span>
                <button type="button" className="icon-btn icon-btn--sm" disabled={i === 0 || !p.active} onClick={() => void saveFeatured(up(ids, p.id))} aria-label="أعلى">
                  <Icon name="chev-down" size={14} className="ac2-flip" />
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void saveFeatured(ids.filter((x) => x !== p.id))}>
                  إزالة
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="card__body ac2-pick">
          <SearchBox value={productSearch} onChange={setProductSearch} placeholder="ابحث باسم المنتج أو المتجر" label="ابحث عن منتج منشور" className="ac2-search" />
          <select className="field__control" value="" onChange={(e) => e.target.value && void saveFeatured([...ids, e.target.value])} aria-label="أضف منتجاً">
            <option value="">
              {!products.data
                ? '…'
                : products.data.total > products.data.items.length
                  ? `أضف منتجاً — أول ${products.data.items.length} من ${products.data.total}، ضيّق بالبحث`
                  : products.data.total === 0
                    ? 'لا منتج منشور بهذا البحث'
                    : 'أضف منتجاً منشوراً…'}
            </option>
            {(products.data?.items ?? [])
              .filter((p) => !ids.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameAr} — {p.vendor.nameAr}
                </option>
              ))}
          </select>
        </div>
      </section>
    </div>
  );
}
