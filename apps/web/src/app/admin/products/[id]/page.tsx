'use client';

import Link from 'next/link';
import { use } from 'react';
import { Feedback, Loading, ReasonButton } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { useLocale, useT } from '@/components/locale';
import { localized, pick, type Bilingual } from '@/lib/i18n';
import { media, PRODUCT_STATUS, PRODUCT_STATUS_EN, TONE, useAction, useAdminData } from '@/lib/admin';
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

const PRESETS: Bilingual[] = [
  { ar: 'الصورة الأولى لا تُظهر المنتج', en: 'The first image does not show the product' },
  { ar: 'الوصف لا يطابق الصور', en: 'The description does not match the images' },
  { ar: 'منتج ممنوع البيع على المنصة', en: 'Product not allowed for sale on the platform' },
  { ar: 'السعر غير منطقي أو مضلِّل', en: 'The price is unreasonable or misleading' },
];

/**
 * AD-07 — المنتج كما يراه المشتري. لا مراجعة قبل النشر (قرار صاحب المشروع 15 أكتوبر
 * 2026): البائع ينشر فيظهر فوراً، وللإدارة قرار واحد بعده — إيقاف المنشور المخالف
 * بسبب يصل البائع حرفياً، فيعدّله وينشره من جديد.
 */
export default function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const locale = useLocale();
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
        {t('المنتجات', 'Products')}
      </Link>

      <Feedback error={act.error} notice={act.notice} />

      <article className="card ao-review">
        <header className="ao-review__head">
          <div className="ao-review__title">
            <h1 className="ao-review__name">{p.nameAr}</h1>
            <span className={`badge ${TONE[p.status] ?? ''}`}>{localized(locale, PRODUCT_STATUS, PRODUCT_STATUS_EN)[p.status] ?? p.status}</span>
          </div>
          <div className="ao-review__meta">
            {p.vendorCategory ? <span>{p.vendorCategory.nameAr}</span> : null}
            <span>
              <span className="num">{p.variants.length}</span> {t('متغيّراً', p.variants.length === 1 ? 'variant' : 'variants')}
            </span>
            {low !== null && high !== null ? (
              <span className="money num">
                {money(low, priceCurrency, locale)}
                {high !== low ? ` – ${money(high, priceCurrency, locale)}` : ''}
              </span>
            ) : null}
          </div>
        </header>

        {p.rejectReason ? (
          <div className="ao-note" data-tone="danger">
            <Icon name="alert" size={16} />
            <span>
              {t('سبب الإيقاف: «', 'Takedown reason: “')}
              {p.rejectReason}
              {t('»', '”')}
            </span>
          </div>
        ) : null}

        {p.images.length === 0 ? (
          <div className="ao-note" data-tone="warning">
            <Icon name="image" size={16} />
            <span>{t('لا صور لهذا المنتج.', 'This product has no images.')}</span>
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
            <h2 className="eyebrow">{t('الوصف', 'Description')}</h2>
            <p className="ao-review__desc">{p.descriptionAr ?? '—'}</p>
          </section>
          <section className="ao-review__col">
            <h2 className="eyebrow">{t('الخصائص', 'Attributes')}</h2>
            {p.attributes.length === 0 ? (
              <p className="muted small">—</p>
            ) : (
              <dl className="ao-kv">
                {p.attributes.map((a) => (
                  <div key={a.attributeId}>
                    <dt>{a.nameAr}</dt>
                    <dd>{a.valueAr ?? a.number ?? (a.boolean === null ? '—' : a.boolean ? t('نعم', 'Yes') : t('لا', 'No'))}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        <footer className="ao-review__foot">
          {p.status === 'active' ? (
            <ReasonButton
              label={t('أوقف المنتج بسبب', 'Take down with a reason')}
              presets={PRESETS.map((x) => pick(locale, x))}
              disabled={act.busy}
              onSubmit={(r) =>
                act.run(async () => {
                  await api(`/admin/products/${id}/reject`, { method: 'POST', body: { reason: r } });
                  reload();
                }, t('أُوقف المنتج وأُبلغ البائع بالسبب.', 'Product taken down and the seller told the reason.'))
              }
            />
          ) : null}
          <span className="ao-review__hint">
            <Icon name="info" size={14} />
            {p.status === 'active'
              ? t(
                  'الإيقاف يخفيه من المتجر فوراً، والسبب يصل البائع حرفياً — يعدّله وينشره من جديد.',
                  'Taking it down hides it from the store at once, and the seller receives the reason word for word — they edit it and publish again.',
                )
              : t('غير منشور — لا يظهر للمشترين.', 'Not published — buyers do not see it.')}
          </span>
        </footer>
      </article>

      <section className="card card--flush">
        <header className="card__head">
          <h2>{t('المتغيّرات', 'Variants')}</h2>
        </header>
        <div className="table-wrap">
          <table className="table ao-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>{t('الخيارات', 'Options')}</th>
                <th className="end">{t('السعر', 'Price')}</th>
                <th className="end">{t('المتاح', 'Available')}</th>
              </tr>
            </thead>
            <tbody>
              {p.variants.map((v) => (
                <tr key={v.id}>
                  <td className="num">{v.sku}</td>
                  <td data-label={t('الخيارات', 'Options')} className="wrap">
                    {v.options.map((o) => `${o.nameAr}: ${o.valueAr}`).join(' · ') || '—'}
                  </td>
                  <td data-label={t('السعر', 'Price')} className="end">
                    <span className="money num">{money(v.price.minorUnits, v.price.currency, locale)}</span>
                  </td>
                  <td data-label={t('المتاح', 'Available')} className="end num">
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
