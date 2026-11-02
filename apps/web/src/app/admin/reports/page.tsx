'use client';

import { Fragment, useState } from 'react';
import { AdminHeader, Loading } from '@/components/admin';
import { Icon } from '@/components/icons';
import { Alert, EmptyState } from '@/components/ui';
import { DateField } from '@/components/date-field';
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

/** سطر في جدول العملة: مبلغ بعملته، أو عدد */
type Line = { label: string; note?: string } & ({ minor: string } | { count: number });

/**
 * AD-25 — التقارير. كل رقم مالي من الدفتر نفسه (بوابة 11 البند 2)، مجمّعاً
 * بالعملة. الموحَّد بالدولار عرضٌ يذكر سعره بجانب كل رقم.
 */
export default function AdminReportsPage() {
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
              title: 'المبيعات بعملة الدفع',
              lines: [
                { label: 'الطلبات', count: s.orders, note: 'طلبات مدفوعة في الفترة' },
                { label: 'المقبوض', minor: s.grossMinorUnits, note: 'إجمالي ما دفعه المشترون' },
                { label: 'المُسترد', minor: s.refundedMinorUnits },
                { label: 'متوسط قيمة الطلب', minor: s.averageOrderMinorUnits, note: 'لكل طلب أصلي لا طلب فرعي' },
                { label: 'دخل فرق الصرف', minor: s.fxSpreadMinorUnits, note: 'الهامش على التحويل وقت الدفع' },
              ] as Line[],
            },
          ]
        : []),
      ...(l
        ? [
            {
              title: 'الدفتر بعملة البائعين',
              lines: [
                { label: 'عمولة المنصّة', minor: l.commissionMinorUnits, note: 'حسب قواعد العمولة السارية وقت كل طلب' },
                { label: 'ضريبة محصّلة', minor: l.taxHeldMinorUnits },
                { label: 'دعم الخصم', minor: l.discountSubsidyMinorUnits, note: 'ما تحمّلته المنصّة من الكوبونات' },
                { label: 'صافي المنصّة', minor: l.platformNetMinorUnits },
                { label: 'مبيعات البائعين', minor: l.vendorSalesMinorUnits },
                { label: 'استرداداتهم', minor: l.vendorRefundsMinorUnits },
                { label: 'صافي مستحقاتهم', minor: l.vendorDuesNetMinorUnits },
                { label: 'سحوبات محوَّلة', minor: l.payoutsPaidMinorUnits },
              ] as Line[],
            },
          ]
        : []),
    ];
  };

  return (
    <div className="ac2-page">
      <AdminHeader title="التقارير" hint="المبالغ من الدفتر مجمّعة بالعملة — لا تُجمع عملتان في رقم." />

      <div className="toolbar">
        <div className="seg" role="group" aria-label="الفترة">
          {RANGES.map((d) => (
            <button key={d} type="button" className="seg__opt" aria-pressed={preset === d} onClick={() => pickRange(d)}>
              {d === 7 ? 'آخر 7 أيام' : d === 30 ? 'آخر 30 يوماً' : 'آخر 90 يوماً'}
            </button>
          ))}
        </div>
        <span className="ac2-dates">
          <span className="ac2-inline ac2-hint">
            من
            <DateField label="من" value={from} onChange={(v) => (setFrom(v), setPreset(null))} />
          </span>
          <span className="ac2-inline ac2-hint">
            إلى
            <DateField label="إلى" value={to} onChange={(v) => (setTo(v), setPreset(null))} />
          </span>
        </span>
        <span className="toolbar__end">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download('xlsx')}>
            <Icon name="download" size={14} />
            تصدير Excel
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download('csv')}>
            <Icon name="download" size={14} />
            تصدير CSV
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
                متاجر نشطة
              </span>
              <span className="stat__value num">{data.activeVendors}</span>
              <span className="stat__note">متجر باع مرة واحدة على الأقل</span>
            </div>
            <div className="stat">
              <span className="stat__label">
                <Icon name="chart" size={16} />
                معدّل التحويل
              </span>
              <span className="stat__value num">{data.conversion.ratePct === null ? '—' : `${data.conversion.ratePct}%`}</span>
              <span className="stat__note">
                {data.conversion.paidOrders} من {data.conversion.carts} سلة
              </span>
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="العرض">
            {currencies.map((c) => (
              <button key={c} type="button" role="tab" className="tabs__tab" aria-selected={current === c} onClick={() => setView(c)}>
                <span className="num">{c}</span>
              </button>
            ))}
            <button type="button" role="tab" className="tabs__tab" aria-selected={current === UNIFIED} onClick={() => setView(UNIFIED)}>
              موحّد بالدولار
            </button>
          </div>

          {current === UNIFIED ? (
            <>
              <div className="alert alert--info ac2-callout">
                <Icon name="info" size={16} />
                <span>{data.usd.note || 'العرض الموحّد بالدولار — يظهر سعر الصرف المستخدم بجانب كل رقم محوَّل، والمجموع تقريبي لأغراض المقارنة فقط.'}</span>
              </div>
              {data.usd.rows.length === 0 ? (
                <EmptyState icon="chart" title="لا بيانات في هذه الفترة">
                  تظهر الأرقام هنا بمجرّد وجود طلبات مدفوعة.
                </EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">المؤشر</th>
                        <th scope="col">العملة</th>
                        <th scope="col" className="end">
                          بالدولار
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.usd.rows.map((r, i) => (
                        <tr key={i}>
                          <td>
                            <strong>{r.metric}</strong>
                          </td>
                          <td className="num" data-label="العملة">
                            {r.currency}
                          </td>
                          <td className="end" data-label="بالدولار">
                            {r.usd === null ? <span className="ac2-muted-cell">لا سعر مسجَّل</span> : <span className="money num">${r.usd}</span>}
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
            <EmptyState icon="chart" title="لا بيانات في هذه الفترة">
              تظهر الأرقام هنا بمجرّد وجود طلبات مدفوعة. جرّب فترة أطول.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">المؤشر</th>
                    <th scope="col">القيمة</th>
                    <th scope="col" className="end">
                      ملاحظة
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
                          <td data-label="القيمة">{'minor' in ln ? <span className="money num">{money(ln.minor, current)}</span> : <span className="num ac2-code">{ln.count}</span>}</td>
                          <td className="end ac2-muted-cell" data-label="ملاحظة">
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
