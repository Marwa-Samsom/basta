'use client';

import Link from 'next/link';
import { use } from 'react';
import { Feedback, Loading, ReasonButton } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { media, PRODUCT_STATUS, TONE, useAction, useAdminData } from '@/lib/admin';
import { money } from '@/lib/orders';

interface Detail {
  id: string;
  nameAr: string;
  status: string;
  rejectReason: string | null;
  descriptionAr: string | null;
  vendorCategory: { nameAr: string } | null;
  currency: string;
  attributes: { attributeId: string; nameAr: string; valueAr: string | null; number: string | null; boolean: boolean | null }[];
  variants: { id: string; sku: string; options: { nameAr: string; valueAr: string }[]; price: { minorUnits: string; currency: string }; isActive: boolean; stock: { available: number } }[];
  images: { id: string; altAr: string | null; urls: Record<string, string> }[];
}

const PRESETS = ['الصورة الأولى لا تُظهر المنتج', 'الوصف لا يطابق الصور', 'منتج ممنوع البيع على المنصة', 'السعر غير منطقي أو مضلِّل'];

/**
 * AD-07 — المنتج كما يراه المشتري. لا مراجعة قبل النشر (قرار صاحب المشروع 15 أكتوبر
 * 2026): البائع ينشر فيظهر فوراً، وللإدارة قرار واحد بعده — إيقاف المنشور المخالف
 * بسبب يصل البائع حرفياً، فيعدّله وينشره من جديد.
 */
export default function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: p, error, forbidden, reload } = useAdminData<Detail>(`/admin/products/${id}`);
  const act = useAction();

  if (!p) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;

  const prices = p.variants.map((v) => BigInt(v.price.minorUnits));
  const low = prices.length ? prices.reduce((a, b) => (b < a ? b : a)) : null;
  const high = prices.length ? prices.reduce((a, b) => (b > a ? b : a)) : null;
  const priceCurrency = p.variants[0]?.price.currency ?? p.currency;

  return (
    <div className="ao-page">
      <Link href="/admin/products" className="ao-back">
        <Icon name="back" size={14} mirror />
        المنتجات
      </Link>

      <Feedback error={act.error} notice={act.notice} />

      <article className="card ao-review">
        <header className="ao-review__head">
          <div className="ao-review__title">
            <h1 className="ao-review__name">{p.nameAr}</h1>
            <span className={`badge ${TONE[p.status] ?? ''}`}>{PRODUCT_STATUS[p.status] ?? p.status}</span>
          </div>
          <div className="ao-review__meta">
            {p.vendorCategory ? <span>{p.vendorCategory.nameAr}</span> : null}
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
            <span>سبب الإيقاف: «{p.rejectReason}»</span>
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
          {p.status === 'active' ? (
            <ReasonButton
              label="أوقف المنتج بسبب"
              presets={PRESETS}
              disabled={act.busy}
              onSubmit={(r) =>
                act.run(async () => {
                  await api(`/admin/products/${id}/reject`, { method: 'POST', body: { reason: r } });
                  reload();
                }, 'أُوقف المنتج وأُبلغ البائع بالسبب.')
              }
            />
          ) : null}
          <span className="ao-review__hint">
            <Icon name="info" size={14} />
            {p.status === 'active'
              ? 'الإيقاف يخفيه من المتجر فوراً، والسبب يصل البائع حرفياً — يعدّله وينشره من جديد.'
              : 'غير منشور — لا يظهر للمشترين.'}
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
