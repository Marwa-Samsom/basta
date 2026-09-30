'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect } from 'react';
import { Feedback, Loading, ReasonButton } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api, ApiError } from '@/lib/api';
import { media, PRODUCT_STATUS, TONE, useAction, useAdminData } from '@/lib/admin';
import { money } from '@/lib/orders';

interface Detail {
  id: string;
  nameAr: string;
  status: string;
  rejectReason: string | null;
  /** النسخة المعروضة — يُعتمد بها، فلا يُنشر ما عدّله البائع بعد فتحها */
  contentRevision: number;
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
      if (!p) return;
      try {
        await api(`/admin/products/${id}/approve`, { method: 'POST', body: { contentRevision: p.contentRevision } });
      } catch (e) {
        // البائع عدّل بعد الفتح: تُعرض النسخة الحالية ليقرأها قبل أن يعتمد، والرسالة تقول لماذا
        if (e instanceof ApiError && e.details?.['reason'] === 'CONTENT_CHANGED') reload();
        throw e;
      }
      await next();
    }, 'نُشر المنتج.');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, dialog')) return;
      if (e.key.toLowerCase() === 'a' && p?.status === 'pending_review') void approve();
      if (e.key.toLowerCase() === 'n') void next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!p) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;

  const prices = p.variants.map((v) => BigInt(v.price.minorUnits));
  const low = prices.length ? prices.reduce((a, b) => (b < a ? b : a)) : null;
  const high = prices.length ? prices.reduce((a, b) => (b > a ? b : a)) : null;
  const priceCurrency = p.variants[0]?.price.currency ?? p.currency;

  return (
    <div className="ao-page">
      <Link href="/admin/products" className="ao-back">
        <Icon name="back" size={14} mirror />
        الطابور
      </Link>

      <Feedback error={act.error} notice={act.notice} />

      <article className="card ao-review">
        <header className="ao-review__head">
          <div className="ao-review__title">
            <h1 className="ao-review__name">{p.nameAr}</h1>
            <span className={`badge ${TONE[p.status] ?? ''}`}>{PRODUCT_STATUS[p.status] ?? p.status}</span>
          </div>
          <div className="ao-review__meta">
            <span>{p.category.nameAr}</span>
            <span>
              <span className="num">{p.variants.length}</span> متغيّراً
            </span>
            {low !== null && high !== null ? (
              <span className="money num">
                {money(low, priceCurrency)}
                {high !== low ? ` – ${money(high, priceCurrency)}` : ''}
              </span>
            ) : null}
          </div>
        </header>

        {p.rejectReason ? (
          <div className="ao-note" data-tone="danger">
            <Icon name="alert" size={16} />
            <span>سبب الرفض: «{p.rejectReason}»</span>
          </div>
        ) : null}

        {p.images.length === 0 ? (
          <div className="ao-note" data-tone="warning">
            <Icon name="image" size={16} />
            <span>لا صور لهذا المنتج.</span>
          </div>
        ) : (
          <div className="ao-gallery">
            {p.images.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={img.id} src={media(img.urls['thumb.webp']) ?? ''} alt={img.altAr ?? p.nameAr} width={140} height={140} />
            ))}
          </div>
        )}

        <div className="ao-review__cols">
          <section className="ao-review__col">
            <h2 className="eyebrow">الوصف</h2>
            <p className="ao-review__desc">{p.descriptionAr ?? '—'}</p>
          </section>
          <section className="ao-review__col">
            <h2 className="eyebrow">الخصائص</h2>
            {p.attributes.length === 0 ? (
              <p className="muted small">—</p>
            ) : (
              <dl className="ao-kv">
                {p.attributes.map((a) => (
                  <div key={a.attributeId}>
                    <dt>{a.nameAr}</dt>
                    <dd>{a.valueAr ?? a.number ?? (a.boolean === null ? '—' : a.boolean ? 'نعم' : 'لا')}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        <footer className="ao-review__foot">
          {p.status === 'pending_review' ? (
            <button type="button" className="btn btn--primary" disabled={act.busy} aria-keyshortcuts="A" onClick={() => void approve()}>
              <Icon name="check" size={16} />
              اعتمد وانشر
              <kbd className="ao-kbd">A</kbd>
            </button>
          ) : null}
          {p.status === 'pending_review' || p.status === 'active' ? (
            <ReasonButton
              label={p.status === 'active' ? 'إيقاف المنشور بسبب' : 'ارفض بسبب'}
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
          <button type="button" className="btn btn--ghost btn--sm" aria-keyshortcuts="N" onClick={() => void next()}>
            التالي
            <kbd className="ao-kbd">N</kbd>
            <Icon name="next" size={14} mirror />
          </button>
          <span className="ao-review__hint">
            <Icon name="info" size={14} />
            الرفض يصل البائع بسببه حرفياً.
          </span>
        </footer>
      </article>

      <section className="card card--flush">
        <header className="card__head">
          <h2>المتغيّرات</h2>
        </header>
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>الخيارات</th>
                <th className="end">السعر</th>
                <th className="end">المتاح</th>
              </tr>
            </thead>
            <tbody>
              {p.variants.map((v) => (
                <tr key={v.id}>
                  <td className="num">{v.sku}</td>
                  <td data-label="الخيارات" className="wrap">
                    {v.options.map((o) => `${o.nameAr}: ${o.valueAr}`).join(' · ') || '—'}
                  </td>
                  <td data-label="السعر" className="end">
                    <span className="money num">{money(v.price.minorUnits, v.price.currency)}</span>
                  </td>
                  <td data-label="المتاح" className="end num">
                    {v.stock.available}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
