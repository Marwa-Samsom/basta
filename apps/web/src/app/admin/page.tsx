'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading } from '@/components/admin';
import { Icon, type IconName } from '@/components/icons';
import { Alert } from '@/components/ui';
import { useAdminData } from '@/lib/admin';
import { money } from '@/lib/orders';

interface Dashboard {
  sales: { currency: string; orders: number; grossMinorUnits: string; refundedMinorUnits: string; averageOrderMinorUnits: string; fxSpreadMinorUnits: string }[] | null;
  ledger: { currency: string; commissionMinorUnits: string; platformNetMinorUnits: string; vendorDuesNetMinorUnits: string }[] | null;
  activeVendors?: number;
  conversion?: { carts: number; paidOrders: number; ratePct: number | null };
  queues: { vendors: number; products: number; payouts: number; disputes: number; overdueAcceptance: number };
  alerts: { view: string; rows: number }[];
}

/** `hot`: الطابور الذي يتأخّر فيه أحد — يُلوَّن بالتحذير ما دام فيه شيء */
const QUEUES: { key: keyof Dashboard['queues']; label: string; sub: string; href: string; icon: IconName; hot: boolean }[] = [
  { key: 'vendors', label: 'متاجر تنتظر الاعتماد', sub: 'الأقدم أولاً', href: '/admin/vendors', icon: 'store', hot: true },
  { key: 'products', label: 'منتجات تنتظر المراجعة', sub: 'جديدة ومعدَّلة بعد النشر', href: '/admin/products', icon: 'package', hot: true },
  { key: 'payouts', label: 'طلبات تحويل', sub: 'بانتظار الموافقة أو التحويل', href: '/admin/payouts', icon: 'wallet', hot: false },
  { key: 'disputes', label: 'نزاعات مفتوحة', sub: 'مفتوحة ومصعَّدة — الرصيد مجمَّد', href: '/admin/disputes', icon: 'scale', hot: true },
  { key: 'overdueAcceptance', label: 'طلبات فرعية قاربت مهلة القبول', sub: 'أقل من 12 ساعة على انقضاء المهلة', href: '/admin/orders?status=processing', icon: 'clock', hot: true },
];

const VIEW_LABELS: Record<string, string> = {
  audit_money_conservation: 'حفظ المال (بائع + منصة + مُسترد ≠ مقبوض)',
  audit_wallet_drift: 'رصيد محفظة لا يطابق دفترها',
  audit_withdrawn_drift: 'المسحوب لا يطابق قيود السحب',
  audit_sub_order_without_ledger: 'طلب مدفوع بلا قيد بيع',
  audit_inventory_drift: 'مخزون لا يطابق حركاته',
  audit_reservation_drift: 'محجوز لا يطابق الحجوزات',
  audit_order_split_drift: 'مجموع الفرعيات لا يساوي الأب',
  audit_paid_without_split: 'مدفوع بلا طلبات فرعية',
};

/** اسم العملة بجانب رمزها في مبدّل العملة — الرمز وحده إن لم نعرف الاسم */
const CURRENCY_NAME: Record<string, string> = {
  SAR: 'الريال',
  AED: 'الدرهم',
  JOD: 'الدينار الأردني',
  KWD: 'الدينار الكويتي',
  BHD: 'الدينار البحريني',
  OMR: 'الريال العُماني',
  QAR: 'الريال القطري',
  EGP: 'الجنيه',
  USD: 'الدولار',
};

/**
 * AD-03 — اللوحة. المؤشرات **مجمّعة بالعملة** ولا تُجمع عملتان في رقم.
 * الطوابير بطاقات تقود إلى عملها مباشرة، والتنبيه الأحمر لأي انحراف في
 * منظرات التدقيق — خلل مالي لا ينتظر تقريراً شهرياً.
 */
export default function AdminDashboard() {
  const { data, error, forbidden, reload } = useAdminData<Dashboard>('/admin/dashboard');
  const [currency, setCurrency] = useState<string | null>(null);

  if (!data) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;
  const currencies = data.sales?.map((s) => s.currency) ?? [];
  const cur = currency ?? currencies[0] ?? null;
  const sales = data.sales?.find((s) => s.currency === cur);
  const ledger = data.ledger?.find((l) => l.currency === cur);

  return (
    <div className="ao-page">
      <AdminHeader title="لوحة المؤشرات" hint="آخر 30 يوماً" />

      {data.alerts.length > 0 ? (
        <Alert tone="danger" title="انحراف في التدقيق — افحصه الآن">
          <ul className="ao-alert-list">
            {data.alerts.map((a) => (
              <li key={a.view}>
                {VIEW_LABELS[a.view] ?? a.view}: <span className="num">{a.rows}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {data.sales === null ? (
        <div className="ao-note" data-tone="info">
          <Icon name="lock" size={16} />
          <span>الأرقام المالية لمن يملك صلاحية التقارير.</span>
        </div>
      ) : currencies.length === 0 ? (
        <Empty icon="chart" title="لا مبيعات في الفترة">
          تظهر المؤشرات هنا بمجرّد وجود طلبات مدفوعة في آخر 30 يوماً.
        </Empty>
      ) : (
        <section className="ao-dash" aria-label="المؤشرات">
          <div className="ao-dash__bar">
            <span className="ao-dash__lead">المؤشرات معروضة بعملة واحدة في كل مرة — لا نجمع عملتين في رقم واحد.</span>
            <div className="seg ao-cur" role="tablist" aria-label="العملة">
              {currencies.map((c) => (
                <button key={c} type="button" role="tab" className="seg__opt" aria-selected={cur === c} onClick={() => setCurrency(c)}>
                  {CURRENCY_NAME[c] ?? c}
                  {CURRENCY_NAME[c] ? <span className="ao-cur__code num">{c}</span> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="ao-metrics">
            <div className="ao-metric ao-metric--money">
              <span className="ao-metric__label">المبيعات</span>
              <span className="ao-metric__value money num">{sales ? money(sales.grossMinorUnits, sales.currency) : '—'}</span>
              <span className="ao-metric__note">
                <span className="num">{sales?.orders ?? 0}</span> طلب
              </span>
            </div>
            <div className="ao-metric ao-metric--money">
              <span className="ao-metric__label">عمولة المنصّة</span>
              <span className="ao-metric__value money num">{ledger ? money(ledger.commissionMinorUnits, ledger.currency) : '—'}</span>
              <span className="ao-metric__note">من دفتر المنصة · بعملة البائع {cur}</span>
            </div>
            <div className="ao-metric ao-metric--money">
              <span className="ao-metric__label">دخل فرق الصرف</span>
              <span className="ao-metric__value money num">{sales ? money(sales.fxSpreadMinorUnits, sales.currency) : '—'}</span>
              <span className="ao-metric__note">تقدير من الفرعيات بعملة مختلفة</span>
            </div>
            <div className="ao-metric ao-metric--money">
              <span className="ao-metric__label">متوسط قيمة الطلب</span>
              <span className="ao-metric__value money num">{sales ? money(sales.averageOrderMinorUnits, sales.currency) : '—'}</span>
            </div>
            <div className="ao-metric">
              <span className="ao-metric__label">معدّل التحويل</span>
              <span className="ao-metric__value num">{data.conversion?.ratePct === null ? '—' : `${data.conversion?.ratePct}%`}</span>
              <span className="ao-metric__note">
                <span className="num">{data.conversion?.paidOrders ?? 0}</span> طلب من <span className="num">{data.conversion?.carts ?? 0}</span> سلة
              </span>
            </div>
            <div className="ao-metric">
              <span className="ao-metric__label">متاجر نشطة</span>
              <span className="ao-metric__value num">{data.activeVendors ?? 0}</span>
            </div>
          </div>
        </section>
      )}

      <section className="ao-dash__queues" aria-labelledby="ao-queues-title">
        <h2 id="ao-queues-title" className="ao-section-title">
          طوابير تنتظر إجراءً
        </h2>
        <div className="ao-queues">
          {QUEUES.map((q) => {
            const n = data.queues[q.key];
            const hot = q.hot && n > 0;
            return (
              <Link key={q.key} href={q.href} className="ao-queue" data-hot={hot} data-zero={n === 0}>
                <span className="ao-queue__icon" aria-hidden>
                  <Icon name={q.icon} size={17} />
                </span>
                <span className="ao-queue__text">
                  <span className="ao-queue__label">{q.label}</span>
                  <span className="ao-queue__sub">{n === 0 ? 'لا شيء ينتظر' : q.sub}</span>
                </span>
                <span className="ao-queue__count num">{n}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
