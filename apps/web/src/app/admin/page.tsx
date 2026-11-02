'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Loading } from '@/components/admin';
import { Icon, type IconName } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { Alert } from '@/components/ui';
import { useAdminData } from '@/lib/admin';
import { localized, type Locale } from '@/lib/i18n';
import { money } from '@/lib/orders';

interface Dashboard {
  sales: { currency: string; orders: number; grossMinorUnits: string; refundedMinorUnits: string; averageOrderMinorUnits: string; fxSpreadMinorUnits: string }[] | null;
  ledger: { currency: string; commissionMinorUnits: string; platformNetMinorUnits: string; vendorDuesNetMinorUnits: string }[] | null;
  activeVendors?: number;
  conversion?: { carts: number; paidOrders: number; ratePct: number | null };
  queues: { vendors: number; payouts: number; disputes: number; overdueAcceptance: number };
  alerts: { view: string; rows: number }[];
}

/** `hot`: الطابور الذي يتأخّر فيه أحد — يُلوَّن بالتحذير ما دام فيه شيء */
const QUEUES: { key: keyof Dashboard['queues']; label: string; labelEn: string; sub: string; subEn: string; href: string; icon: IconName; hot: boolean }[] = [
  { key: 'vendors', label: 'متاجر تنتظر الاعتماد', labelEn: 'Shops awaiting approval', sub: 'الأقدم أولاً', subEn: 'Oldest first', href: '/admin/vendors', icon: 'store', hot: true },
  { key: 'payouts', label: 'طلبات تحويل', labelEn: 'Payout requests', sub: 'بانتظار الموافقة أو التحويل', subEn: 'Awaiting approval or transfer', href: '/admin/payouts', icon: 'wallet', hot: false },
  { key: 'disputes', label: 'نزاعات مفتوحة', labelEn: 'Open disputes', sub: 'مفتوحة ومصعَّدة — الرصيد مجمَّد', subEn: 'Open and escalated — balance frozen', href: '/admin/disputes', icon: 'scale', hot: true },
  // القائمة نفسها التي يعدّها: كانت تفتح كل «قيد التنفيذ» فيضيع الطلب بين المئات
  { key: 'overdueAcceptance', label: 'طلبات فرعية قاربت مهلة القبول', labelEn: 'Shop orders near the acceptance deadline', sub: 'أقل من 12 ساعة على انقضاء المهلة', subEn: 'Less than 12 hours left to accept', href: '/admin/orders?due=acceptance', icon: 'clock', hot: true },
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

const VIEW_LABELS_EN: Record<string, string> = {
  audit_money_conservation: 'Money conservation (seller + platform + refunded ≠ received)',
  audit_wallet_drift: 'Wallet balance does not match its ledger',
  audit_withdrawn_drift: 'Withdrawn amount does not match payout entries',
  audit_sub_order_without_ledger: 'Paid order without a sale entry',
  audit_inventory_drift: 'Stock does not match its movements',
  audit_reservation_drift: 'Reserved stock does not match reservations',
  audit_order_split_drift: 'Shop orders do not add up to the parent order',
  audit_paid_without_split: 'Paid without shop orders',
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

const CURRENCY_NAME_EN: Record<string, string> = {
  SAR: 'Riyal',
  AED: 'Dirham',
  JOD: 'Jordanian Dinar',
  KWD: 'Kuwaiti Dinar',
  BHD: 'Bahraini Dinar',
  OMR: 'Omani Rial',
  QAR: 'Qatari Riyal',
  EGP: 'Pound',
  USD: 'Dollar',
};

/**
 * المبلغ في بطاقة المؤشر: مسافة عادية بين الرقم ورمز العملة بدل المسافة غير المنكسرة، فإن
 * ضاقت البطاقة نزل الرمز كاملاً إلى السطر التالي. كانا كلمة واحدة يقسمها الالتفاف أينما
 * اتفق — «د» في سطر و«أ.» في آخر، أو النقطة وحدها (ADM-015، 29 أكتوبر 2026).
 */
const metricMoney = (minor: string, currency: string, locale: Locale): string => money(minor, currency, locale).replace(' ', ' ');

/**
 * AD-03 — اللوحة. المؤشرات **مجمّعة بالعملة** ولا تُجمع عملتان في رقم.
 * الطوابير بطاقات تقود إلى عملها مباشرة، والتنبيه الأحمر لأي انحراف في
 * منظرات التدقيق — خلل مالي لا ينتظر تقريراً شهرياً.
 */
export default function AdminDashboard() {
  const t = useT();
  const locale = useLocale();
  const { data, error, forbidden, reload } = useAdminData<Dashboard>('/admin/dashboard');
  const [currency, setCurrency] = useState<string | null>(null);

  if (!data) return <Loading error={error} forbidden={forbidden} onRetry={reload} />;
  const currencies = data.sales?.map((s) => s.currency) ?? [];
  const cur = currency ?? currencies[0] ?? null;
  const sales = data.sales?.find((s) => s.currency === cur);
  const ledger = data.ledger?.find((l) => l.currency === cur);
  const viewLabels = localized(locale, VIEW_LABELS, VIEW_LABELS_EN);
  const currencyName = localized(locale, CURRENCY_NAME, CURRENCY_NAME_EN);
  const salesOrders = sales?.orders ?? 0;
  const paidOrders = data.conversion?.paidOrders ?? 0;
  const carts = data.conversion?.carts ?? 0;

  return (
    <div className="ao-page">
      <AdminHeader title={t('لوحة المؤشرات', 'Dashboard')} hint={t('آخر 30 يوماً', 'Last 30 days')} />

      {data.alerts.length > 0 ? (
        <Alert tone="danger" title={t('انحراف في التدقيق — افحصه الآن', 'Audit drift — check it now')}>
          <ul className="ao-alert-list">
            {data.alerts.map((a) => (
              <li key={a.view}>
                {viewLabels[a.view] ?? a.view}: <span className="num">{a.rows}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {data.sales === null ? (
        <div className="ao-note" data-tone="info">
          <Icon name="lock" size={16} />
          <span>{t('الأرقام المالية لمن يملك صلاحية التقارير.', 'Financial figures are only for those with the reports permission.')}</span>
        </div>
      ) : currencies.length === 0 ? (
        <Empty icon="chart" title={t('لا مبيعات في الفترة', 'No sales in this period')}>
          {t('تظهر المؤشرات هنا بمجرّد وجود طلبات مدفوعة في آخر 30 يوماً.', 'Metrics appear here once there are paid orders in the last 30 days.')}
        </Empty>
      ) : (
        <section className="ao-dash" aria-label={t('المؤشرات', 'Metrics')}>
          <div className="ao-dash__bar">
            <span className="ao-dash__lead">
              {t('المؤشرات معروضة بعملة واحدة في كل مرة — لا نجمع عملتين في رقم واحد.', 'Metrics are shown in one currency at a time — we never add two currencies into one figure.')}
            </span>
            <div className="seg ao-cur" role="tablist" aria-label={t('العملة', 'Currency')}>
              {currencies.map((c) => (
                <button key={c} type="button" role="tab" className="seg__opt" aria-selected={cur === c} onClick={() => setCurrency(c)}>
                  {currencyName[c] ?? c}
                  {currencyName[c] ? <span className="ao-cur__code num">{c}</span> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="ao-metrics">
            <div className="ao-metric ao-metric--money">
              <span className="ao-metric__label">{t('المبيعات', 'Sales')}</span>
              <span className="ao-metric__value money num">{sales ? metricMoney(sales.grossMinorUnits, sales.currency, locale) : '—'}</span>
              <span className="ao-metric__note">
                <span className="num">{salesOrders}</span> {t('طلب', salesOrders === 1 ? 'order' : 'orders')}
              </span>
            </div>
            <div className="ao-metric ao-metric--money">
              <span className="ao-metric__label">{t('عمولة المنصّة', 'Platform commission')}</span>
              <span className="ao-metric__value money num">{ledger ? metricMoney(ledger.commissionMinorUnits, ledger.currency, locale) : '—'}</span>
              <span className="ao-metric__note">{t(`من دفتر المنصة · بعملة البائع ${cur}`, `From the platform ledger · in seller currency ${cur}`)}</span>
            </div>
            <div className="ao-metric ao-metric--money">
              <span className="ao-metric__label">{t('دخل فرق الصرف', 'Exchange spread income')}</span>
              <span className="ao-metric__value money num">{sales ? metricMoney(sales.fxSpreadMinorUnits, sales.currency, locale) : '—'}</span>
              <span className="ao-metric__note">{t('تقدير من الفرعيات بعملة مختلفة', 'Estimated from shop orders in another currency')}</span>
            </div>
            <div className="ao-metric ao-metric--money">
              <span className="ao-metric__label">{t('متوسط قيمة الطلب', 'Average order value')}</span>
              <span className="ao-metric__value money num">{sales ? metricMoney(sales.averageOrderMinorUnits, sales.currency, locale) : '—'}</span>
            </div>
            <div className="ao-metric">
              <span className="ao-metric__label">{t('معدّل التحويل', 'Conversion rate')}</span>
              <span className="ao-metric__value num">{data.conversion?.ratePct === null ? '—' : `${data.conversion?.ratePct}%`}</span>
              <span className="ao-metric__note">
                <span className="num">{paidOrders}</span> {t('طلب من', paidOrders === 1 ? 'order from' : 'orders from')} <span className="num">{carts}</span>{' '}
                {t('سلة', carts === 1 ? 'cart' : 'carts')}
              </span>
            </div>
            <div className="ao-metric">
              <span className="ao-metric__label">{t('متاجر نشطة', 'Active shops')}</span>
              <span className="ao-metric__value num">{data.activeVendors ?? 0}</span>
            </div>
          </div>
        </section>
      )}

      <section className="ao-dash__queues" aria-labelledby="ao-queues-title">
        <h2 id="ao-queues-title" className="ao-section-title">
          {t('طوابير تنتظر إجراءً', 'Queues awaiting action')}
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
                  <span className="ao-queue__label">{t(q.label, q.labelEn)}</span>
                  <span className="ao-queue__sub">{n === 0 ? t('لا شيء ينتظر', 'Nothing waiting') : t(q.sub, q.subEn)}</span>
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
