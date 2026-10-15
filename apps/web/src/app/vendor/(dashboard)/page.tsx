'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, EmptyState, PageHead, Spinner } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ProductThumb } from '@/components/product-editor';
import { num, PRODUCT_STATUS, type LowStockRow, type Page, type ProductListItem } from '@/lib/catalog';

interface Snapshot {
  total: number;
  drafts: number;
  rejected: number;
  active: number;
  low: LowStockRow[];
  recent: ProductListItem[];
  rejectedItems: ProductListItem[];
}

/**
 * VD-06 — مؤشّرات البائع.
 *
 * **لا رقم معروض هنا مصطنع.** بطاقات المبيعات والطلبات والمحفظة لا تُقرأ في
 * هذه الصفحة، فلا تُعرض بأصفار تبدو حقيقية: صفر مبيعات يعني «لم تبع» لا «لم
 * يُقرأ». البائع يُحال إلى صفحتيهما حيث الأرقام الفعلية.
 */
export default function DashboardHome() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [all, drafts, rejected, active, low] = await Promise.all([
          api<Page<ProductListItem>>('/vendor/products?pageSize=5'),
          api<Page<ProductListItem>>('/vendor/products?status=draft&pageSize=1'),
          api<Page<ProductListItem>>('/vendor/products?status=rejected&pageSize=5'),
          api<Page<ProductListItem>>('/vendor/products?status=active&pageSize=1'),
          api<LowStockRow[]>('/vendor/inventory/low-stock'),
        ]);
        if (!alive) return;
        setSnap({
          total: all.total,
          drafts: drafts.total,
          rejected: rejected.total,
          active: active.total,
          low,
          recent: all.items,
          rejectedItems: rejected.items,
        });
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'تعذّر تحميل المؤشرات.');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!snap) return <Spinner label="جارٍ تحميل المؤشرات…" />;

  const out = snap.low.filter((l) => l.available <= 0).length;
  const near = snap.low.length - out;

  return (
    <div className="vp-page">
      <PageHead
        title={greeting()}
        meta="ملخّص متجرك الآن"
        actions={
          <Link className="btn btn--primary" href="/vendor/products/new">
            <Icon name="plus" size={16} />
            أضف منتجاً
          </Link>
        }
      />

      {snap.total === 0 ? (
        <EmptyState
          icon="chart"
          title="لا بيانات بعد"
          actions={
            <>
              <Link className="btn btn--primary" href="/vendor/products/new">
                <Icon name="plus" size={16} />
                أضف أول منتج
              </Link>
              <Link className="btn btn--secondary" href="/vendor/products/import">
                <Icon name="upload" size={16} />
                استيراد من ملف
              </Link>
            </>
          }
        >
          متجرك جاهز ولا منتج فيه بعد. أضف أول منتج أو استورد قائمتك من ملف.
        </EmptyState>
      ) : null}

      <div className="stats vp-kpis">
        <Link className="stat" href="/vendor/products">
          <span className="stat__label">
            <Icon name="package" size={15} />
            منتجات منشورة
          </span>
          <span className="stat__value num">{num(snap.active)}</span>
          <span className="stat__note">تظهر للمشترين</span>
        </Link>

{/* لا مراجعة قبل النشر (15 أكتوبر 2026): ما يحتاج البائعَ هو ما أوقفته الإدارة بعد نشره */}
        <Link className="stat" href="/vendor/products?status=rejected">
          <span className="stat__label">
            <Icon name="alert" size={15} />
            موقوفة
          </span>
          <span className="stat__value num">{num(snap.rejected)}</span>
          {snap.rejected > 0 ? (
            <span className="badge badge--danger vp-kpi__badge">
              <Icon name="alert" size={13} />
              أوقفتها الإدارة — تحتاج تصحيحاً
            </span>
          ) : (
            <span className="stat__note">لا شيء موقوف</span>
          )}
        </Link>

        <Link className="stat" href="/vendor/products">
          <span className="stat__label">
            <Icon name="file" size={15} />
            مسوّدات
          </span>
          <span className="stat__value num">{num(snap.drafts)}</span>
          <span className="stat__note">لم تُنشر بعد</span>
        </Link>

        <Link className="stat" href="/vendor/inventory">
          <span className="stat__label">
            <Icon name="boxes" size={15} />
            مخزون منخفض
          </span>
          <span className="stat__value num">{num(snap.low.length)}</span>
          {snap.low.length > 0 ? (
            <span className="vp-kpi__badges">
              {near > 0 ? (
                <span className="badge badge--warning">
                  <span className="num">{num(near)}</span> قارب النفاد
                </span>
              ) : null}
              {out > 0 ? (
                <span className="badge badge--danger">
                  <span className="num">{num(out)}</span> نفد
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="stat__note">
            {snap.low.length > 0 ? 'متغيّرات تحت حدّ التنبيه' : 'المخزون بخير'}
          </span>
        </Link>
      </div>

      <div className="vp-home">
        <div className="vp-home__main">
          {snap.recent.length > 0 ? (
            <section className="card card--flush">
              <header className="card__head">
                <h2>أحدث المنتجات</h2>
                <Link className="btn btn--ghost btn--sm vp-head-link" href="/vendor/products">
                  كل المنتجات
                  <Icon name="chev-end" size={13} mirror />
                </Link>
              </header>
              <ul className="vp-list">
                {snap.recent.map((p) => (
                  <li key={p.id}>
                    <Link className="vp-list__row" href={`/vendor/products/${p.id}`}>
                      <ProductThumb src={p.thumbnail} size="sm" />
                      <span className="vp-list__text">
                        <span className="vp-list__name">{p.nameAr}</span>
                        {p.priceFrom ? (
                          <span className="vp-list__sub money num">{p.priceFrom.formatted}</span>
                        ) : null}
                      </span>
                      <span className={`badge ${PRODUCT_STATUS[p.status].tone}`}>
                        {PRODUCT_STATUS[p.status].label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card vp-note-card">
            <header className="card__title">
              <h2>المبيعات والطلبات والمحفظة</h2>
            </header>
            <p className="small muted">
              أرقامها لا تُعرض هنا بأصفار: صفر مبيعات يعني «لم تبع بعد»، والفرق قرار تتّخذه على
              أساسه. افتحها من صفحاتها حيث الأرقام الفعلية.
            </p>
            <div className="row">
              <Link className="btn btn--secondary btn--sm" href="/vendor/orders">
                <Icon name="truck" size={14} />
                الطلبات
              </Link>
              <Link className="btn btn--secondary btn--sm" href="/vendor/finance">
                <Icon name="wallet" size={14} />
                المحفظة
              </Link>
            </div>
          </section>
        </div>

        <div className="vp-home__side">
          {snap.low.length > 0 ? (
            <section className="card card--flush">
              <header className="card__head">
                <h2>تنبيهات المخزون</h2>
                <Link className="btn btn--ghost btn--sm vp-head-link" href="/vendor/inventory">
                  المخزون
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
                        <span className="badge badge--danger">نفد</span>
                      ) : (
                        <span className="badge badge--warning">
                          بقي <span className="num">{num(l.available)}</span>
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
                <h2>منتجات موقوفة</h2>
                <Link className="btn btn--ghost btn--sm vp-head-link" href="/vendor/products">
                  المنتجات
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
                          {PRODUCT_STATUS.rejected.hint}
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
function greeting(): string {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? 'صباح الخير' : 'مساء الخير';
}
