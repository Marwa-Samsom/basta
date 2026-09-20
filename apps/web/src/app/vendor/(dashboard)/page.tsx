'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Card, Spinner } from '@/components/ui';
import { num, PRODUCT_STATUS, type LowStockRow, type Page, type ProductListItem } from '@/lib/catalog';

interface Snapshot {
  total: number;
  drafts: number;
  inReview: number;
  rejected: number;
  active: number;
  low: LowStockRow[];
  recent: ProductListItem[];
}

/**
 * VD-06 — مؤشّرات البائع.
 *
 * **لا رقم معروض هنا مصطنع.** بطاقات المبيعات والطلبات والمحفظة تحتاج
 * الطلبات والمال (المرحلتان 09 و10)، فتُذكر صراحةً أنها لم تُفعَّل بعد بدل
 * أن تُعرض بأصفار تبدو حقيقية: صفر مبيعات يعني «لم تبع» لا «لم يُبنَ بعد».
 */
export default function DashboardHome() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [all, drafts, inReview, rejected, active, low] = await Promise.all([
          api<Page<ProductListItem>>('/vendor/products?pageSize=5'),
          api<Page<ProductListItem>>('/vendor/products?status=draft&pageSize=1'),
          api<Page<ProductListItem>>('/vendor/products?status=pending_review&pageSize=1'),
          api<Page<ProductListItem>>('/vendor/products?status=rejected&pageSize=5'),
          api<Page<ProductListItem>>('/vendor/products?status=active&pageSize=1'),
          api<LowStockRow[]>('/vendor/inventory/low-stock'),
        ]);
        if (!alive) return;
        setSnap({
          total: all.total,
          drafts: drafts.total,
          inReview: inReview.total,
          rejected: rejected.total,
          active: active.total,
          low,
          recent: all.items,
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

  return (
    <>
      <header className="row row--between">
        <h1>المؤشرات</h1>
        <Link className="btn btn--primary" href="/vendor/products/new">
          منتج جديد
        </Link>
      </header>

      <div className="stats">
        <Stat label="منتجات منشورة" value={num(snap.active)} note="تظهر للمشترين" />
        <Stat
          label="قيد المراجعة"
          value={num(snap.inReview)}
          note={snap.inReview > 0 ? 'بانتظار الإدارة' : 'لا شيء ينتظر'}
        />
        <Stat
          label="مرفوضة"
          value={num(snap.rejected)}
          note={snap.rejected > 0 ? 'تحتاج تصحيحاً' : 'لا رفض'}
        />
        <Stat label="مسوّدات" value={num(snap.drafts)} note="لم تُرسل بعد" />
        <Stat
          label="مخزون منخفض"
          value={num(snap.low.length)}
          note={snap.low.length > 0 ? 'متغيّرات تحت حدّ التنبيه' : 'المخزون بخير'}
        />
      </div>

      {snap.total === 0 ? (
        <div className="empty">
          <p>متجرك جاهز ولا منتج فيه بعد. أضف أول منتج أو استورد قائمتك من ملف.</p>
          <div className="row">
            <Link className="btn btn--primary" href="/vendor/products/new">
              أضف أول منتج
            </Link>
            <Link className="btn btn--secondary" href="/vendor/products/import">
              استيراد من ملف
            </Link>
          </div>
        </div>
      ) : null}

      {snap.rejected > 0 ? (
        <Card title="منتجات مرفوضة تحتاج تصحيحاً">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">المنتج</th>
                  <th scope="col">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {snap.recent
                  .filter((p) => p.status === 'rejected')
                  .map((p) => (
                    <tr key={p.id}>
                      <td className="wrap">
                        <Link href={`/vendor/products/${p.id}`}>{p.nameAr}</Link>
                      </td>
                      <td>
                        <span className={`badge ${PRODUCT_STATUS[p.status].tone}`}>
                          {PRODUCT_STATUS[p.status].label}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {snap.low.length > 0 ? (
        <Card
          title="تنبيهات المخزون"
          aside={
            <Link className="btn btn--secondary btn--sm" href="/vendor/inventory">
              كل المخزون
            </Link>
          }
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">المنتج</th>
                  <th scope="col">SKU</th>
                  <th scope="col">المتاح</th>
                  <th scope="col">الحد</th>
                </tr>
              </thead>
              <tbody>
                {snap.low.slice(0, 8).map((l) => (
                  <tr key={l.variantId}>
                    <td className="wrap">
                      <Link href={`/vendor/products/${l.productId}`}>{l.productNameAr}</Link>
                    </td>
                    <td className="num">{l.sku}</td>
                    <td className="num">{num(l.available)}</td>
                    <td className="num">{num(l.lowStockThreshold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title="المبيعات والطلبات والمحفظة">
        <p className="small muted">
          هذه البطاقات تُفعَّل مع الطلبات والمال في مرحلتيهما. لا تُعرض هنا بأصفار: صفر مبيعات يعني
          «لم تبع بعد» لا «لم يُبنَ بعد»، والفرق بينهما قرار تتّخذه أنت على أساسه.
        </p>
      </Card>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value num">{value}</span>
      <span className="stat__note">{note}</span>
    </div>
  );
}
