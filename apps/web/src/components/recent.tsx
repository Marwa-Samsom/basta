'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { ProductGrid } from '@/components/product-card';
import { EmptyState, PageHead, Spinner } from '@/components/ui';
import { priceLabel, useProductPages, type Fetched } from '@/lib/compare';
import { intlLocale, translator, type Locale } from '@/lib/i18n';
import { clearRecent, recordView, useHydrated, useRecent, type RecentItem } from '@/lib/recent';
import { imageUrl, type ProductCard, type ProductPage } from '@/lib/storefront';
import { productCount } from '@/components/compare';

/** يسجّل مشاهدة المنتج في هذا الجهاز — لا يرسم شيئاً */
export function RecordView({ slug, nameAr, thumb }: { slug: string; nameAr: string; thumb: string | null }) {
  useEffect(() => {
    recordView({ slug, nameAr, thumb });
  }, [slug, nameAr, thumb]);
  return null;
}

/** صفحة المنتج الحيّة بشكل بطاقة المنتج — السعر الأدنى وخصم متغيّره إن وُجد */
function toCard(p: ProductPage): ProductCard {
  const cheapest = p.variants.find((v) => v.price.minorUnits === p.priceFrom.minorUnits);
  return {
    id: p.id,
    slug: p.slug,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    price: p.priceFrom,
    compareAtPrice: cheapest?.compareAtPrice ?? null,
    vendor: { id: p.vendor.id, slug: p.vendor.slug, nameAr: p.vendor.nameAr },
    thumbnail: p.images[0]?.urls['thumb'] ?? null,
    available: p.available,
    isSoldOut: p.isSoldOut,
  };
}

/** قسم الرئيسية — آخر ما شوهد على هذا الجهاز، ولا يظهر إن لم يُشاهَد شيء */
const HOME_RECENT = 4;

export function RecentSection() {
  const t = useT();
  const locale = useLocale();
  const recent = useRecent();
  const top = recent.slice(0, HOME_RECENT);
  const pages = useProductPages(top.map((x) => x.slug));
  const cards = top
    .map((x) => pages[x.slug])
    .filter((p): p is ProductPage => !!p && p !== 'error')
    .map(toCard);

  if (cards.length === 0) return null;

  return (
    <section className="sd-section" aria-labelledby="sx-recent-title">
      <div className="sd-section__head">
        <h2 id="sx-recent-title" className="sd-section__title">
          {t('شوهد مؤخراً', 'Recently viewed')}
        </h2>
        <Link href="/account/recent" className="sd-section__link">
          {t('السجلّ كاملاً', 'Full history')}
          <Icon name="chev-end" size={14} mirror />
        </Link>
      </div>
      <ProductGrid products={cards} locale={locale} />
    </section>
  );
}

// ================================================================ ST-24

const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (t: number): number => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function groupOf(viewedAt: number, today: number, locale: Locale): string {
  const t = translator(locale);
  if (viewedAt >= today) return t('اليوم', 'Today');
  if (viewedAt >= today - DAY) return t('أمس', 'Yesterday');
  return t('أقدم', 'Earlier');
}

function whenOf(viewedAt: number, now: number, today: number, locale: Locale): string {
  const t = translator(locale);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  const clock = new Intl.DateTimeFormat(intlLocale(locale), { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long' });
  const mins = Math.round((now - viewedAt) / 60000);
  if (viewedAt >= today) {
    if (mins < 1) return t('الآن', 'Just now');
    if (mins < 60) return rtf.format(-mins, 'minute');
    return rtf.format(-Math.round(mins / 60), 'hour');
  }
  if (viewedAt >= today - DAY) return t(`أمس · ${clock.format(viewedAt)}`, `Yesterday · ${clock.format(viewedAt)}`);
  return date.format(viewedAt);
}

export function RecentView() {
  const t = useT();
  const locale = useLocale();
  const hydrated = useHydrated();
  const recent = useRecent();
  const pages = useProductPages(recent.map((x) => x.slug));
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  // الوقت يُقرأ مرة عند فتح الصفحة — «قبل ساعة» لا يحتاج أن يتحرّك وأنت تنظر
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (asking && !el.open) el.showModal();
    if (!asking && el.open) el.close();
  }, [asking]);

  if (!hydrated) {
    return (
      <div className="sx-page">
        <PageHead title={t('شوهدت مؤخّراً', 'Recently viewed')} />
        <Spinner label={t('جارٍ فتح سجلّ المشاهدة…', 'Opening your viewing history…')} />
      </div>
    );
  }

  const today = startOfDay(now);
  const groups: { label: string; items: RecentItem[] }[] = [];
  for (const item of recent) {
    const label = groupOf(item.viewedAt, today, locale);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="sx-page">
      <PageHead
        title={t('شوهدت مؤخّراً', 'Recently viewed')}
        count={recent.length ? productCount(recent.length, locale) : undefined}
        actions={
          <button
            type="button"
            className="btn btn--danger"
            disabled={recent.length === 0}
            onClick={() => setAsking(true)}
          >
            <Icon name="trash" size={15} />
            {t('امسح السجلّ', 'Clear history')}
          </button>
        }
      />

      {done ? (
        <p className="alert alert--success" role="status">
          {t('مُسح سجلّ المشاهدة من هذا الجهاز.', 'Your viewing history was cleared from this device.')}
        </p>
      ) : null}

      {recent.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="history"
            title={t('لا سجلّ مشاهدة بعد', 'No viewing history yet')}
            actions={
              <Link className="btn btn--primary" href="/">
                {t('تصفّح المتجر', 'Browse the store')}
              </Link>
            }
          >
            {t(
              'ما تتصفّحه يظهر هنا لتعود إليه بسرعة. السجلّ محفوظ على جهازك ويمكنك مسحه في أي وقت.',
              'What you browse shows up here so you can get back to it quickly. The history is saved on your device and you can clear it at any time.',
            )}
          </EmptyState>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="sx-recent__group" aria-label={g.label}>
            <h2 className="sx-recent__label">{g.label}</h2>
            <ul className="sx-recent__grid">
              {g.items.map((item) => (
                <li key={item.slug}>
                  <RecentCard item={item} page={pages[item.slug]} when={whenOf(item.viewedAt, now, today, locale)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <dialog ref={dialog} className="sx-dialog" aria-labelledby="sx-recent-ask" onClose={() => setAsking(false)}>
        <div className="sx-dialog__body">
          <h2 id="sx-recent-ask" className="sx-dialog__title">
            {t('امسح سجلّ المشاهدة؟', 'Clear viewing history?')}
          </h2>
          <p>
            {t(
              'يُحذف سجلّ المنتجات التي تصفّحتها على هذا الجهاز. لا يؤثّر على سلّتك ولا على طلباتك.',
              "The list of products you browsed on this device will be deleted. It doesn't affect your cart or your orders.",
            )}
          </p>
        </div>
        <div className="sx-dialog__foot">
          <button type="button" className="btn btn--secondary" onClick={() => setAsking(false)}>
            {t('إلغاء', 'Cancel')}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              clearRecent();
              setAsking(false);
              setDone(true);
            }}
          >
            <Icon name="trash" size={16} />
            {t('امسح السجلّ', 'Clear history')}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function RecentCard({ item, page, when }: { item: RecentItem; page: Fetched; when: string }) {
  const t = useT();
  const locale = useLocale();
  const live = page && page !== 'error' ? page : null;
  const src = imageUrl(live?.images[0]?.urls['thumb'] ?? item.thumb);
  const name = (locale === 'en' ? live?.nameEn : null) ?? live?.nameAr ?? item.nameAr;
  const price = live ? priceLabel(live, locale) : null;

  const body = (
    <>
      <span className="sx-rcard__media" aria-hidden>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" width={240} height={240} loading="lazy" />
        ) : (
          <Icon name="image" size={26} />
        )}
      </span>
      <span className="sx-rcard__body">
        <span className="sx-rcard__name">{name}</span>
        {price ? (
          <span className="sx-rcard__price">
            {price.prefix ? <span className="sx-rcard__from">{price.prefix}</span> : null}
            <span className="money num">{price.formatted}</span>
          </span>
        ) : page === undefined ? (
          <span className="skeleton sx-rcard__skel" aria-hidden />
        ) : page === null ? (
          <span className="sx-rcard__gone">{t('لم يعد معروضاً', 'No longer listed')}</span>
        ) : null}
        {live?.isSoldOut ? <span className="sx-rcard__gone">{t('نفد من المخزون', 'Out of stock')}</span> : null}
        <span className="sx-rcard__when">{when}</span>
      </span>
    </>
  );

  // منتج أُزيل من المتجر لا رابط له: الرابط يذهب إلى 404
  return page === null ? (
    <div className="sx-rcard" data-gone>
      {body}
    </div>
  ) : (
    <Link href={`/p/${item.slug}`} className="sx-rcard">
      {body}
    </Link>
  );
}
