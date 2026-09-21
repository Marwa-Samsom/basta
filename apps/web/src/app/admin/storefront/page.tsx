'use client';

import { useState } from 'react';
import { AdminHeader, Feedback, Loading } from '@/components/admin';
import { Card } from '@/components/ui';
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

const PLACEMENTS: Record<string, string> = { home_hero: 'أعلى الرئيسية', home_middle: 'وسط الرئيسية', category_top: 'أعلى صفحة الفئة' };

/**
 * AD-17 و AD-19 — البانرات والمنتجات المميّزة. الصورة تُرفع أولاً فتُحوَّل
 * WebP بعرض 1600، ثم يُحفظ البانر بمفتاحها. المميّز منتجات منشورة فقط،
 * بالترتيب الذي تضعه هنا.
 */
export default function AdminStorefrontPage() {
  const banners = useAdminData<Banner[]>('/admin/banners');
  const featured = useAdminData<string[]>('/admin/storefront/featured');
  const products = useAdminData<{ items: { id: string; nameAr: string; vendor: { nameAr: string } }[] }>('/admin/products?status=active&pageSize=100');
  const act = useAction();
  const [draft, setDraft] = useState({ placement: 'home_hero', titleAr: '', linkUrl: '/categories', imageKey: '', imageUrl: '', startsAt: '', endsAt: '' });

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
  const ids = featured.data ?? [];
  const nameOf = (id: string) => products.data?.items.find((p) => p.id === id)?.nameAr ?? id.slice(0, 8);

  return (
    <div className="stack stack--loose">
      <AdminHeader title="البانرات والمميّز" />
      <Feedback error={act.error} notice={act.notice} />

      <Card title="بانر جديد">
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field">
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
            <input className="field__control" dir="ltr" value={draft.linkUrl} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">يبدأ</span>
            <input type="datetime-local" className="field__control" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">ينتهي</span>
            <input type="datetime-local" className="field__control" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
          </label>
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
                    sort: banners.data!.filter((b) => b.placement === draft.placement).length,
                    isActive: true,
                    ...(draft.startsAt ? { startsAt: new Date(draft.startsAt).toISOString() } : {}),
                    ...(draft.endsAt ? { endsAt: new Date(draft.endsAt).toISOString() } : {}),
                  },
                });
                setDraft({ ...draft, imageKey: '', imageUrl: '', titleAr: '' });
                banners.reload();
              }, 'نُشر البانر.')
            }
          >
            نشر
          </button>
        </div>
        {draft.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media(draft.imageUrl) ?? ''} alt="معاينة" style={{ maxWidth: '100%', borderRadius: 8, marginBlockStart: 8 }} />
        ) : null}
      </Card>

      <Card title="البانرات">
        <div className="stack">
          {banners.data.map((b) => (
            <div key={b.id} className="row" style={{ alignItems: 'center', opacity: b.isActive ? 1 : 0.5 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={media(b.imageUrl) ?? ''} alt={b.titleAr ?? ''} width={200} style={{ borderRadius: 6, border: '1px solid var(--border-default)' }} />
              <div className="grow small">
                <strong>{b.titleAr ?? '—'}</strong> · {PLACEMENTS[b.placement] ?? b.placement} · ترتيب {b.sort}
                <div className="muted">
                  {b.linkUrl} · {b.startsAt ? when(b.startsAt) : 'الآن'} ← {b.endsAt ? when(b.endsAt) : 'مفتوح'}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() =>
                  void act.run(async () => {
                    await api(`/admin/banners/${b.id}`, {
                      method: 'PATCH',
                      body: { placement: b.placement, imageKey: b.imageKey, linkUrl: b.linkUrl, titleAr: b.titleAr, sort: b.sort, startsAt: b.startsAt, endsAt: b.endsAt, isActive: !b.isActive },
                    });
                    banners.reload();
                  })
                }
              >
                {b.isActive ? 'إخفاء' : 'إظهار'}
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="المنتجات المميّزة في الرئيسية" hint="بالترتيب الظاهر — حتى 24 منتجاً منشوراً.">
        <ol className="stack stack--tight">
          {ids.map((id, i) => (
            <li key={id} className="row row--between">
              <span>{nameOf(id)}</span>
              <span className="row">
                <button type="button" className="btn btn--ghost btn--sm" disabled={i === 0} onClick={() => void saveFeatured(ids.map((x, j) => (j === i - 1 ? id : j === i ? ids[i - 1]! : x)))} aria-label="أعلى">
                  ↑
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void saveFeatured(ids.filter((x) => x !== id))}>
                  إزالة
                </button>
              </span>
            </li>
          ))}
        </ol>
        <select className="field__control" value="" onChange={(e) => e.target.value && void saveFeatured([...ids, e.target.value])} aria-label="أضف منتجاً">
          <option value="">أضف منتجاً منشوراً…</option>
          {(products.data?.items ?? [])
            .filter((p) => !ids.includes(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameAr} — {p.vendor.nameAr}
              </option>
            ))}
        </select>
      </Card>
    </div>
  );
}
