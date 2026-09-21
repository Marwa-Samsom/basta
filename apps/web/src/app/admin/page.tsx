'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Loading, Tabs } from '@/components/admin';
import { Alert, Card } from '@/components/ui';
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

const QUEUES: { key: keyof Dashboard['queues']; label: string; href: string }[] = [
  { key: 'vendors', label: 'بائعون بانتظار المراجعة', href: '/admin/vendors' },
  { key: 'products', label: 'منتجات بانتظار المراجعة', href: '/admin/products' },
  { key: 'payouts', label: 'طلبات سحب', href: '/admin/payouts' },
  { key: 'disputes', label: 'نزاعات مفتوحة', href: '/admin/disputes' },
  { key: 'overdueAcceptance', label: 'طلبات قاربت مهلة القبول', href: '/admin/orders?status=processing' },
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

/**
 * AD-03 — اللوحة. المؤشرات **مجمّعة بالعملة** ولا تُجمع عملتان في رقم.
 * الطوابير أولاً لأنها ما يُعمل عليه اليوم، والتنبيه الأحمر لأي انحراف
 * في منظرات التدقيق — خلل مالي لا ينتظر تقريراً شهرياً.
 */
export default function AdminDashboard() {
  const { data, error, forbidden } = useAdminData<Dashboard>('/admin/dashboard');
  const [currency, setCurrency] = useState<string | null>(null);

  if (!data) return <Loading error={error} forbidden={forbidden} />;
  const currencies = data.sales?.map((s) => s.currency) ?? [];
  const cur = currency ?? currencies[0] ?? null;
  const sales = data.sales?.find((s) => s.currency === cur);
  const ledger = data.ledger?.find((l) => l.currency === cur);

  return (
    <div className="stack stack--loose">
      <AdminHeader title="اللوحة" hint="آخر 30 يوماً" />

      {data.alerts.length > 0 ? (
        <Alert tone="danger" title="انحراف في التدقيق — افحصه الآن">
          <ul>
            {data.alerts.map((a) => (
              <li key={a.view}>
                {VIEW_LABELS[a.view] ?? a.view}: <span className="num">{a.rows}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <section className="stats">
        {QUEUES.map((q) => (
          <Link key={q.key} href={q.href} className="stat" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="stat__label">{q.label}</span>
            <span className="stat__value num">{data.queues[q.key]}</span>
          </Link>
        ))}
      </section>

      {data.sales === null ? (
        <Card>
          <p className="muted">الأرقام المالية لمن يملك صلاحية التقارير.</p>
        </Card>
      ) : currencies.length === 0 ? (
        <Card>
          <p className="empty muted">لا مبيعات في الفترة.</p>
        </Card>
      ) : (
        <Card title="المؤشرات">
          <div className="stack">
            <Tabs value={cur ?? ''} options={currencies.map((c) => ({ key: c, label: c }))} onChange={setCurrency} />
            <div className="stats">
              <div className="stat">
                <span className="stat__label">المبيعات</span>
                <span className="stat__value money">{sales ? money(sales.grossMinorUnits, sales.currency) : '—'}</span>
                <span className="stat__note">{sales?.orders ?? 0} طلب</span>
              </div>
              <div className="stat">
                <span className="stat__label">متوسط الطلب</span>
                <span className="stat__value money">{sales ? money(sales.averageOrderMinorUnits, sales.currency) : '—'}</span>
              </div>
              <div className="stat">
                <span className="stat__label">هامش الصرف</span>
                <span className="stat__value money">{sales ? money(sales.fxSpreadMinorUnits, sales.currency) : '—'}</span>
                <span className="stat__note">تقدير من الفرعيات بعملة مختلفة</span>
              </div>
              <div className="stat">
                <span className="stat__label">عمولة المنصة (بعملة البائع {cur})</span>
                <span className="stat__value money">{ledger ? money(ledger.commissionMinorUnits, ledger.currency) : '—'}</span>
                <span className="stat__note">من دفتر المنصة</span>
              </div>
              <div className="stat">
                <span className="stat__label">بائعون نشطون</span>
                <span className="stat__value num">{data.activeVendors ?? 0}</span>
              </div>
              <div className="stat">
                <span className="stat__label">معدّل التحويل</span>
                <span className="stat__value num">{data.conversion?.ratePct === null ? '—' : `${data.conversion?.ratePct}%`}</span>
                <span className="stat__note">
                  {data.conversion?.paidOrders ?? 0} طلب من {data.conversion?.carts ?? 0} سلة
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
