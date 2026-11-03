'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, EmptyState, PageHead, Spinner } from '@/components/ui';
import { AcceptQueue } from '@/components/accept-countdown';
import { Icon } from '@/components/icons';
import { ProductThumb } from '@/components/product-editor';
import { num, PRODUCT_STATUS, PRODUCT_STATUS_EN, type LowStockRow, type Page, type ProductListItem } from '@/lib/catalog';
import { useLocale, useT } from '@/components/locale';
import { localized, type Translate } from '@/lib/i18n';
import { useReturnTick } from '@/lib/fresh';

interface Snapshot {
  total: number;
  drafts: number;
  rejected: number;
  active: number;
  low: LowStockRow[];
  recent: ProductListItem[];
  rejectedItems: ProductListItem[];
  /** بانتظار القبول وموعد أقربها إلى الإلغاء الآلي — VON-057 */
  waiting: { count: number; nearest: Date | null };
}

/**
 * VD-06 — مؤشّرات البائع.
 *
 * **لا رقم معروض هنا مصطنع.** بطاقات المبيعات والطلبات والمحفظة لا تُقرأ في
 * هذه الصفحة، فلا تُعرض بأصفار تبدو حقيقية: صفر مبيعات يعني «لم تبع» لا «لم
 * يُقرأ». البائع يُحال إلى صفحتيهما حيث الأرقام الفعلية.
 */
export default function DashboardHome() {
  const t = useT();
  const locale = useLocale();
  const statusOf = localized(locale, PRODUCT_STATUS, PRODUCT_STATUS_EN);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const returned = useReturnTick();
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [all, drafts, rejected, active, low, awaiting] = await Promise.all([
          api<Page<ProductListItem>>('/vendor/products?pageSize=5'),
          api<Page<ProductListItem>>('/vendor/products?status=draft&pageSize=1'),
          api<Page<ProductListItem>>('/vendor/products?status=rejected&pageSize=5'),
          api<Page<ProductListItem>>('/vendor/products?status=active&pageSize=1'),
          api<LowStockRow[]>('/vendor/inventory/low-stock'),
          api<{ items: { placedAt: string }[]; counts: Record<string, number>; acceptanceHours: number }>(
            '/vendor/orders?status=awaiting_vendor&sort=oldest',
          ),
        ]);
        const oldest = awaiting.items[0];
        if (!alive) return;
        setSnap({
          total: all.total,
          drafts: drafts.total,
          rejected: rejected.total,
          active: active.total,
          low,
          recent: all.items,
          rejectedItems: rejected.items,
          waiting: {
            count: awaiting.counts['awaiting_vendor'] ?? 0,
            nearest: oldest ? new Date(new Date(oldest.placedAt).getTime() + awaiting.acceptanceHours * 3_600_000) : null,
          },
        });
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : t('تعذّر تحميل المؤشرات.', 'Could not load the dashboard.'));
      }
    })();
    return () => {
      alive = false;
    };
  }, [t, returned]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!snap) return <Spinner label={t('جارٍ تحميل المؤشرات…', 'Loading the dashboard…')} />;

  const out = snap.low.filter((l) => l.available <= 0).length;
  const near = snap.low.length - out;

  return (
    <div className="vp-page">
      <PageHead
        title={greeting(t)}
        meta={t('ملخّص متجرك الآن', 'Your shop at a glance')}
        actions={
          <Link className="btn btn--primary" href="/vendor/products/new">
            <Icon name="plus" size={16} />
            {t('أضف منتجاً', 'Add product')}
          </Link>
        }
      />

      {snap.waiting.count > 0 && snap.waiting.nearest ? <AcceptQueue count={snap.waiting.count} nearest={snap.waiting.nearest} /> : null}

      {snap.total === 0 ? (
        <EmptyState
          icon="chart"
          title={t('لا بيانات بعد', 'No data yet')}
          actions={
            <>
              <Link className="btn btn--primary" href="/vendor/products/new">
                <Icon name="plus" size={16} />
                {t('أضف أول منتج', 'Add your first product')}
              </Link>
              <Link className="btn btn--secondary" href="/vendor/products/import">
                <Icon name="upload" size={16} />
                {t('استيراد من ملف', 'Import from file')}
              </Link>
            </>
          }
        >
          {t(
            'متجرك جاهز ولا منتج فيه بعد. أضف أول منتج أو استورد قائمتك من ملف.',
            'Your shop is ready but has no products yet. Add your first product or import your list from a file.',
          )}
        </EmptyState>
      ) : null}

      <div className="stats vp-kpis">
        <Link className="stat" href="/vendor/products">
          <span className="stat__label">
            <Icon name="package" size={15} />
            {t('منتجات منشورة', 'Published products')}
          </span>
          <span className="stat__value num">{num(snap.active, locale)}</span>
          <span className="stat__note">{t('تظهر للمشترين', 'Visible to buyers')}</span>
        </Link>

{/* لا مراجعة قبل النشر (15 أكتوبر 2026): ما يحتاج البائعَ هو ما أوقفته الإدارة بعد نشره */}
        <Link className="stat" href="/vendor/products?status=rejected">
          <span className="stat__label">
            <Icon name="alert" size={15} />
            {t('موقوفة', 'Taken down')}
          </span>
          <span className="stat__value num">{num(snap.rejected, locale)}</span>
          {snap.rejected > 0 ? (
            <span className="badge badge--danger vp-kpi__badge">
              <Icon name="alert" size={13} />
              {t('أوقفتها الإدارة — تحتاج تصحيحاً', 'Taken down by admin — needs fixing')}
            </span>
          ) : (
            <span className="stat__note">{t('لا شيء موقوف', 'Nothing taken down')}</span>
          )}
        </Link>

        <Link className="stat" href="/vendor/products">
          <span className="stat__label">
            <Icon name="file" size={15} />
            {t('مسوّدات', 'Drafts')}
          </span>
          <span className="stat__value num">{num(snap.drafts, locale)}</span>
          <span className="stat__note">{t('لم تُنشر بعد', 'Not published yet')}</span>
        </Link>

        <Link className="stat" href="/vendor/inventory">
          <span className="stat__label">
            <Icon name="boxes" size={15} />
            {t('مخزون منخفض', 'Low stock')}
          </span>
          <span className="stat__value num">{num(snap.low.length, locale)}</span>
          {snap.low.length > 0 ? (
            <span className="vp-kpi__badges">
              {near > 0 ? (
                <span className="badge badge--warning">
                  <span className="num">{num(near, locale)}</span> {t('قارب النفاد', 'running low')}
                </span>
              ) : null}
              {out > 0 ? (
                <span className="badge badge--danger">
                  <span className="num">{num(out, locale)}</span> {t('نفد', 'out of stock')}
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="stat__note">
            {snap.low.length > 0
              ? t('متغيّرات تحت حدّ التنبيه', 'Variants below the alert level')
              : t('المخزون بخير', 'Stock is fine')}
          </span>
        </Link>
      </div>

      <div className="vp-home">
        <div className="vp-home__main">
          {snap.recent.length > 0 ? (
            <section className="card card--flush">
              <header className="card__head">
                <h2>{t('أحدث المنتجات', 'Latest products')}</h2>
                <Link className="btn btn--ghost btn--sm vp-head-link" href="/vendor/products">
                  {t('كل المنتجات', 'All products')}
                  <Icon name="chev-end" size={13} mirror />
                </Link>
              </header>
              <ul className="vp-list">
                {snap.recent.map((p) => (
                  <li key={p.id}>
                    <Link className="vp-list__row" href={`/vendor/products/${p.id}`}>
                      <ProductThumb src={p.thumbnail} size="sm" />
                      <span className="vp-list__text">
                        <span className="vp-list__name">{locale === 'en' && p.nameEn ? p.nameEn : p.nameAr}</span>
                        {p.priceFrom ? (
                          <span className="vp-list__sub money num">{p.priceFrom.formatted}</span>
                        ) : null}
                      </span>
                      <span className={`badge ${statusOf[p.status].tone}`}>
                        {statusOf[p.status].label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card vp-note-card">
            <header className="card__title">
              <h2>{t('المبيعات والطلبات والمحفظة', 'Sales, orders and wallet')}</h2>
            </header>
            <p className="small muted">
              {t(
                'أرقامها لا تُعرض هنا بأصفار: صفر مبيعات يعني «لم تبع بعد»، والفرق قرار تتّخذه على أساسه. افتحها من صفحاتها حيث الأرقام الفعلية.',
                'Their figures are not shown here as zeros: zero sales means “not sold yet”, and that difference shapes your decisions. Open their own pages for the real figures.',
              )}
            </p>
            <div className="row">
              <Link className="btn btn--secondary btn--sm" href="/vendor/orders">
                <Icon name="truck" size={14} />
                {t('الطلبات', 'Orders')}
              </Link>
              <Link className="btn btn--secondary btn--sm" href="/vendor/finance">
                <Icon name="wallet" size={14} />
                {t('المحفظة', 'Wallet')}
              </Link>
            </div>
          </section>
        </div>

        <div className="vp-home__side">
          {snap.low.length > 0 ? (
            <section className="card card--flush">
              <header className="card__head">
                <h2>{t('تنبيهات المخزون', 'Stock alerts')}</h2>
                <Link className="btn btn--ghost btn--sm vp-head-link" href="/vendor/inventory">
                  {t('المخزون', 'Inventory')}
                  <Icon name="chev-end" size={13} mirror />
                </Link>
              </header>
              <ul className="vp-list">
                {snap.low.slice(0, 8).map((l) => (
                  <li key={l.variantId}>
                    <Link className="vp-list__row" href={`/vendor/products/${l.productId}`}>
                      <ProductThumb src={null} size="sm" />
                      <span className="vp-list__text">
                        <span className="vp-list__name">{l.productNameAr}</span>
                        <span className="vp-list__sub num">{l.sku}</span>
                      </span>
                      {l.available <= 0 ? (
                        <span className="badge badge--danger">{t('نفد', 'Out of stock')}</span>
                      ) : (
                        <span className="badge badge--warning">
                          {t('بقي', 'Left:')} <span className="num">{num(l.available, locale)}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {snap.rejected > 0 ? (
            <section className="card card--flush">
              <header className="card__head">
                <h2>{t('منتجات موقوفة', 'Taken-down products')}</h2>
                <Link className="btn btn--ghost btn--sm vp-head-link" href="/vendor/products">
                  {t('المنتجات', 'Products')}
                  <Icon name="chev-end" size={13} mirror />
                </Link>
              </header>
              <ul className="vp-list">
                {snap.rejectedItems.map((p) => (
                  <li key={p.id}>
                    <Link className="vp-list__row vp-list__row--top" href={`/vendor/products/${p.id}`}>
                      <span className="vp-alert-dot" aria-hidden>
                        <Icon name="alert" size={13} />
                      </span>
                      <span className="vp-list__text">
                        <span className="vp-list__name vp-list__name--wrap">{p.nameAr}</span>
                        <span className="vp-list__sub vp-list__sub--danger">
                          {statusOf.rejected.hint}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** تحية بحسب ساعة جهاز البائع — الصفحة تُرسم عند العميل بعد وصول البيانات */
function greeting(t: Translate): string {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? t('صباح الخير', 'Good morning') : t('مساء الخير', 'Good evening');
}
