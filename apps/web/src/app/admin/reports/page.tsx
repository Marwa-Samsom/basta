'use client';

import { Fragment, useState } from 'react';
import { AdminHeader, Loading } from '@/components/admin';
import { Icon } from '@/components/icons';
import { Alert, EmptyState } from '@/components/ui';
import { DateField } from '@/components/date-field';
import { useLocale, useT } from '@/components/locale';
import { apiBlob } from '@/lib/api';
import { downloadName, useAdminData } from '@/lib/admin';
import { money } from '@/lib/orders';

interface Report {
  sales: { currency: string; orders: number; grossMinorUnits: string; refundedMinorUnits: string; averageOrderMinorUnits: string; fxSpreadMinorUnits: string }[];
  ledger: {
    currency: string;
    commissionMinorUnits: string;
    taxHeldMinorUnits: string;
    discountSubsidyMinorUnits: string;
    roundingMinorUnits: string;
    platformNetMinorUnits: string;
    vendorSalesMinorUnits: string;
    vendorRefundsMinorUnits: string;
    vendorDuesNetMinorUnits: string;
    payoutsPaidMinorUnits: string;
  }[];
  activeVendors: number;
  conversion: { carts: number; paidOrders: number; ratePct: number | null };
  usd: { note: string; rows: { metric: string; currency: string; rate: number | null; usd: string | null }[] };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const RANGES = [7, 30, 90] as const;
const UNIFIED = '__usd';

/** أسماء المؤشرات وملاحظة العرض الموحّد كما يكتبها الخادم — بالإنجليزية لزرّ اللغة */
const SERVER_EN: Record<string, string> = {
  'المبيعات': 'Sales',
  'العمولة': 'Commission',
  'تحويل عرض فقط بآخر سعر مسجَّل — لا يدخل أي دفتر': 'Display-only conversion at the latest recorded rate — it does not enter any ledger',
};

/** سطر في جدول العملة: مبلغ بعملته، أو عدد */
type Line = { label: string; note?: string } & ({ minor: string } | { count: number });

/**
 * AD-25 — التقارير. كل رقم مالي من الدفتر نفسه (بوابة 11 البند 2)، مجمّعاً
 * بالعملة. الموحَّد بالدولار عرضٌ يذكر سعره بجانب كل رقم.
 */
export default function AdminReportsPage() {
  const t = useT();
  const locale = useLocale();
  const serverText = (text: string) => (locale === 'en' ? (SERVER_EN[text] ?? text) : text);
  // الافتراضي آخر 30 يوماً — مهيّأ مرة واحدة لا في كل تصيير
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [preset, setPreset] = useState<number | null>(30);
  const [view, setView] = useState<string | null>(null);
  const q = `from=${from}&to=${to}`;
  const { data, error, forbidden } = useAdminData<Report>(`/admin/reports/financial?${q}`);
  const [dlError, setDlError] = useState<string | null>(null);

  const download = async (ext: 'csv' | 'xlsx') => {
    try {
      const blob = await apiBlob(`/admin/reports/financial.${ext}?${q}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = downloadName('basta-report', ext);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setDlError((e as Error).message);
    }
  };

  const pickRange = (days: number) => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - days);
    setPreset(days);
    setFrom(iso(start));
    setTo(iso(today));
  };

  const currencies = data ? [...new Set([...data.sales.map((s) => s.currency), ...data.ledger.map((l) => l.currency)])] : [];
  // «موحّد بالدولار» مفتاح خاص لا رمز عملة: عملة دفع بالدولار تبقى عرضاً مستقلاً
  const current = view === UNIFIED || (view && currencies.includes(view)) ? view : (currencies[0] ?? UNIFIED);

  const linesFor = (code: string): { title: string; lines: Line[] }[] => {
    if (!data) return [];
    const s = data.sales.find((x) => x.currency === code);
    const l = data.ledger.find((x) => x.currency === code);
    return [
      ...(s
        ? [
            {
              title: t('المبيعات بعملة الدفع', 'Sales in payment currency'),
              lines: [
                { label: t('الطلبات', 'Orders'), count: s.orders, note: t('طلبات مدفوعة في الفترة', 'Paid orders in the period') },
                { label: t('المقبوض', 'Collected'), minor: s.grossMinorUnits, note: t('إجمالي ما دفعه المشترون', 'Total paid by buyers') },
                { label: t('المُسترد', 'Refunded'), minor: s.refundedMinorUnits },
                { label: t('متوسط قيمة الطلب', 'Average order value'), minor: s.averageOrderMinorUnits, note: t('لكل طلب أصلي لا طلب فرعي', 'Per parent order, not per shop order') },
                { label: t('دخل فرق الصرف', 'FX spread income'), minor: s.fxSpreadMinorUnits, note: t('الهامش على التحويل وقت الدفع', 'The margin on conversion at payment time') },
              ] as Line[],
            },
          ]
        : []),
      ...(l
        ? [
            {
              title: t('الدفتر بعملة البائعين', "Ledger in sellers' currency"),
              lines: [
                { label: t('عمولة المنصّة', 'Platform commission'), minor: l.commissionMinorUnits, note: t('حسب قواعد العمولة السارية وقت كل طلب', 'Per the commission rules in force at the time of each order') },
                { label: t('ضريبة محصّلة', 'Tax collected'), minor: l.taxHeldMinorUnits },
                { label: t('دعم الخصم', 'Discount subsidy'), minor: l.discountSubsidyMinorUnits, note: t('ما تحمّلته المنصّة من الكوبونات', 'What the platform covered from coupons') },
                { label: t('صافي المنصّة', 'Platform net'), minor: l.platformNetMinorUnits },
                { label: t('مبيعات البائعين', 'Seller sales'), minor: l.vendorSalesMinorUnits },
                { label: t('استرداداتهم', 'Their refunds'), minor: l.vendorRefundsMinorUnits },
                { label: t('صافي مستحقاتهم', 'Their net dues'), minor: l.vendorDuesNetMinorUnits },
                { label: t('سحوبات محوَّلة', 'Payouts transferred'), minor: l.payoutsPaidMinorUnits },
              ] as Line[],
            },
          ]
        : []),
    ];
  };

  return (
    <div className="ac2-page">
      <AdminHeader
        title={t('التقارير', 'Reports')}
        hint={t('المبالغ من الدفتر مجمّعة بالعملة — لا تُجمع عملتان في رقم.', 'Amounts from the ledger, grouped by currency — two currencies are never added into one number.')}
      />

      <div className="toolbar">
        <div className="seg" role="group" aria-label={t('الفترة', 'Period')}>
          {RANGES.map((d) => (
            <button key={d} type="button" className="seg__opt" aria-pressed={preset === d} onClick={() => pickRange(d)}>
              {d === 7 ? t('آخر 7 أيام', 'Last 7 days') : d === 30 ? t('آخر 30 يوماً', 'Last 30 days') : t('آخر 90 يوماً', 'Last 90 days')}
            </button>
          ))}
        </div>
        <span className="ac2-dates">
          <span className="ac2-inline ac2-hint">
            {t('من', 'From')}
            <DateField label={t('من', 'From')} value={from} onChange={(v) => (setFrom(v), setPreset(null))} />
          </span>
          <span className="ac2-inline ac2-hint">
            {t('إلى', 'To')}
            <DateField label={t('إلى', 'To')} value={to} onChange={(v) => (setTo(v), setPreset(null))} />
          </span>
        </span>
        <span className="toolbar__end">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download('xlsx')}>
            <Icon name="download" size={14} />
            {t('تصدير Excel', 'Export Excel')}
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download('csv')}>
            <Icon name="download" size={14} />
            {t('تصدير CSV', 'Export CSV')}
          </button>
        </span>
      </div>
      {dlError ? <Alert tone="danger">{dlError}</Alert> : null}

      {!data ? (
        <Loading error={error} forbidden={forbidden} />
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat__label">
                <Icon name="store" size={16} />
                {t('متاجر نشطة', 'Active shops')}
              </span>
              <span className="stat__value num">{data.activeVendors}</span>
              <span className="stat__note">{t('متجر باع مرة واحدة على الأقل', 'Shops that sold at least once')}</span>
            </div>
            <div className="stat">
              <span className="stat__label">
                <Icon name="chart" size={16} />
                {t('معدّل التحويل', 'Conversion rate')}
              </span>
              <span className="stat__value num">{data.conversion.ratePct === null ? '—' : `${data.conversion.ratePct}%`}</span>
              <span className="stat__note">
                {t(
                  `${data.conversion.paidOrders} من ${data.conversion.carts} سلة`,
                  `${data.conversion.paidOrders} of ${data.conversion.carts} ${data.conversion.carts === 1 ? 'cart' : 'carts'}`,
                )}
              </span>
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label={t('العرض', 'View')}>
            {currencies.map((c) => (
              <button key={c} type="button" role="tab" className="tabs__tab" aria-selected={current === c} onClick={() => setView(c)}>
                <span className="num">{c}</span>
              </button>
            ))}
            <button type="button" role="tab" className="tabs__tab" aria-selected={current === UNIFIED} onClick={() => setView(UNIFIED)}>
              {t('موحّد بالدولار', 'Unified in USD')}
            </button>
          </div>

          {current === UNIFIED ? (
            <>
              <div className="alert alert--info ac2-callout">
                <Icon name="info" size={16} />
                <span>
                  {data.usd.note
                    ? serverText(data.usd.note)
                    : t(
                        'العرض الموحّد بالدولار — يظهر سعر الصرف المستخدم بجانب كل رقم محوَّل، والمجموع تقريبي لأغراض المقارنة فقط.',
                        'Unified USD view — the exchange rate used appears next to each converted number, and the total is approximate, for comparison only.',
                      )}
                </span>
              </div>
              {data.usd.rows.length === 0 ? (
                <EmptyState icon="chart" title={t('لا بيانات في هذه الفترة', 'No data in this period')}>
                  {t('تظهر الأرقام هنا بمجرّد وجود طلبات مدفوعة.', 'Numbers appear here as soon as there are paid orders.')}
                </EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{t('المؤشر', 'Metric')}</th>
                        <th scope="col">{t('العملة', 'Currency')}</th>
                        <th scope="col" className="end">
                          {t('بالدولار', 'In USD')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.usd.rows.map((r, i) => (
                        <tr key={i}>
                          <td>
                            <strong>{serverText(r.metric)}</strong>
                          </td>
                          <td className="num" data-label={t('العملة', 'Currency')}>
                            {r.currency}
                          </td>
                          <td className="end" data-label={t('بالدولار', 'In USD')}>
                            {r.usd === null ? <span className="ac2-muted-cell">{t('لا سعر مسجَّل', 'No recorded rate')}</span> : <span className="money num">${r.usd}</span>}
                            <span className="ac2-rate-sub">{r.rate === null ? '—' : `1 USD = ${r.rate} ${r.currency}`}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : currencies.length === 0 ? (
            <EmptyState icon="chart" title={t('لا بيانات في هذه الفترة', 'No data in this period')}>
              {t('تظهر الأرقام هنا بمجرّد وجود طلبات مدفوعة. جرّب فترة أطول.', 'Numbers appear here as soon as there are paid orders. Try a longer period.')}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('المؤشر', 'Metric')}</th>
                    <th scope="col">{t('القيمة', 'Value')}</th>
                    <th scope="col" className="end">
                      {t('ملاحظة', 'Note')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linesFor(current).map((g) => (
                    <Fragment key={g.title}>
                      <tr className="ac2-group">
                        <td colSpan={3}>{g.title}</td>
                      </tr>
                      {g.lines.map((ln) => (
                        <tr key={ln.label}>
                          <td>
                            <strong>{ln.label}</strong>
                          </td>
                          <td data-label={t('القيمة', 'Value')}>{'minor' in ln ? <span className="money num">{money(ln.minor, current, locale)}</span> : <span className="num ac2-code">{ln.count}</span>}</td>
                          <td className="end ac2-muted-cell" data-label={t('ملاحظة', 'Note')}>
                            {ln.note ?? ''}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
