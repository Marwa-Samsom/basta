'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect } from 'react';
import { AdminHeader, Feedback, Loading, ReasonButton } from '@/components/admin';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { media, PRODUCT_STATUS, TONE, useAction, useAdminData } from '@/lib/admin';
import { money } from '@/lib/orders';

interface Detail {
  id: string;
  nameAr: string;
  status: string;
  rejectReason: string | null;
  descriptionAr: string | null;
  category: { nameAr: string };
  currency: string;
  attributes: { attributeId: string; nameAr: string; valueAr: string | null; number: string | null; boolean: boolean | null }[];
  variants: { id: string; sku: string; options: { nameAr: string; valueAr: string }[]; price: { minorUnits: string; currency: string }; isActive: boolean; stock: { available: number } }[];
  images: { id: string; altAr: string | null; urls: Record<string, string> }[];
}

const PRESETS = ['الصورة الأولى لا تُظهر المنتج', 'الوصف لا يطابق الصور', 'منتج ممنوع البيع على المنصة', 'السعر غير منطقي أو مضلِّل'];

/**
 * AD-07 — المنتج كما سيراه المشتري، ثم قرار واحد: اعتماد (ينشر فوراً) أو
 * رفض بسبب يصل البائع حرفياً. «التالي» يفتح أقدم منتج في الطابور.
 * اختصارات: A اعتماد · N التالي.
 */
export default function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: p, error, forbidden, reload } = useAdminData<Detail>(`/admin/products/${id}`);
  const act = useAction();

  const next = async () => {
    const q = await api<{ items: { id: string }[] }>('/admin/products?status=pending_review&pageSize=2');
    const n = q.items.find((x) => x.id !== id);
    router.push(n ? `/admin/products/${n.id}` : '/admin/products');
  };

  const approve = () =>
    act.run(async () => {
      await api(`/admin/products/${id}/approve`, { method: 'POST' });
      await next();
    }, 'نُشر المنتج.');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key.toLowerCase() === 'a' && p?.status === 'pending_review') void approve();
      if (e.key.toLowerCase() === 'n') void next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!p) return <Loading error={error} forbidden={forbidden} />;

  return (
    <div className="stack stack--loose">
      <Link href="/admin/products" className="small">
        → الطابور
      </Link>
      <AdminHeader title={p.nameAr} hint={p.category.nameAr}>
        <span className={`badge ${TONE[p.status] ?? ''}`}>{PRODUCT_STATUS[p.status] ?? p.status}</span>
      </AdminHeader>
      <Feedback error={act.error} notice={act.notice} />
      {p.rejectReason ? <p className="small muted">سبب الرفض: «{p.rejectReason}»</p> : null}

      <Card>
        <div className="row">
          {p.status === 'pending_review' ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={act.busy} onClick={() => void approve()}>
              اعتماد ونشر (A)
            </button>
          ) : null}
          {p.status === 'pending_review' || p.status === 'active' ? (
            <ReasonButton
              label={p.status === 'active' ? 'إيقاف المنشور بسبب' : 'رفض'}
              presets={PRESETS}
              disabled={act.busy}
              onSubmit={(r) =>
                act.run(async () => {
                  await api(`/admin/products/${id}/reject`, { method: 'POST', body: { reason: r } });
                  reload();
                }, 'رُفض المنتج وأُبلغ البائع بالسبب.')
              }
            />
          ) : null}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void next()}>
            التالي (N)
          </button>
        </div>
      </Card>

      <div className="grid-2">
        <Card title="الصور">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {p.images.length === 0 ? <span className="muted">لا صور.</span> : null}
            {p.images.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={img.id} src={media(img.urls['thumb.webp']) ?? ''} alt={img.altAr ?? p.nameAr} width={140} height={140} style={{ objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-default)' }} />
            ))}
          </div>
        </Card>
        <Card title="الوصف">
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.descriptionAr ?? '—'}</p>
          <ul className="small stack stack--tight">
            {p.attributes.map((a) => (
              <li key={a.attributeId}>
                {a.nameAr}: {a.valueAr ?? a.number ?? (a.boolean === null ? '—' : a.boolean ? 'نعم' : 'لا')}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="المتغيّرات">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>الخيارات</th>
                <th>السعر</th>
                <th>المتاح</th>
              </tr>
            </thead>
            <tbody>
              {p.variants.map((v) => (
                <tr key={v.id}>
                  <td className="num small">{v.sku}</td>
                  <td className="small">{v.options.map((o) => `${o.nameAr}: ${o.valueAr}`).join(' · ') || '—'}</td>
                  <td className="money">{money(v.price.minorUnits, v.price.currency)}</td>
                  <td className="num">{v.stock.available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
