'use client';

import '@/styles/screens/vendor-extra.css';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { DateField } from '@/components/date-field';
import { Icon } from '@/components/icons';
import { api, apiBlob } from '@/lib/api';
import { labelOf, money, toneOf } from '@/lib/orders';

interface Point {
  day: string;
  salesMinorUnits: string;
  orders: number;
}

interface CurrencyReport {
  currency: string;
  salesMinorUnits: string;
  shippingMinorUnits: string;
  commissionMinorUnits: string;
  refundsMinorUnits: string;
  adjustmentsMinorUnits: string;
  netMinorUnits: string;
  paidOrders: number;
  averageOrderMinorUnits: string;
  series: Point[];
  topProducts: { productId: string; nameAr: string; units: number; revenueMinorUnits: string }[];
}

interface Report {
  range: { from: string; to: string; days: number };
  currencies: CurrencyReport[];
  orders: {
    total: number;
    byStatus: Record<string, number>;
    rejectedByVendor: number;
    delivered: number;
    withReturn: number;
    returnRatePct: number | null;
  };
}

const PRESETS = [
  { days: 7, label: '7 أيام' },
  { days: 30, label: '30 يوماً' },
  { days: 90, label: '90 يوماً' },
] as const;

/** أيام UTC كما يقرؤها الخادم — «اليوم» هنا هو يوم الدفتر نفسه */
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const shift = (iso: string, days: number): string => isoDay(new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000));

const dateFmt = new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const fmt = (iso: string, f = dateFmt) => f.format(new Date(`${iso}T00:00:00Z`));

interface Bar {
  label: string;
  title: string;
  sales: bigint;
  orders: number;
}

/**
 * أعمدة الرسم: يومياً حتى 14 يوماً، وإلا مجموعات متساوية لا تتجاوز 12 عموداً
 * — كما في التصميم (7 أعمدة لأسبوع، 10–12 لما فوقه).
 */
function bars(series: Point[]): Bar[] {
  const size = series.length <= 14 ? 1 : Math.ceil(series.length / 12);
  const out: Bar[] = [];
  for (let i = 0; i < series.length; i += size) {
    const chunk = series.slice(i, i + size);
    const first = chunk[0]!.day;
    const last = chunk[chunk.length - 1]!.day;
    out.push({
      label: fmt(first, shortFmt),
      title: size === 1 ? fmt(first) : `${fmt(first)} – ${fmt(last)}`,
      sales: chunk.reduce((a, p) => a + BigInt(p.salesMinorUnits), 0n),
      orders: chunk.reduce((a, p) => a + p.orders, 0),
    });
  }
  return out;
}

function Chart({ c }: { c: CurrencyReport }) {
  const [metric, setMetric] = useState<'sales' | 'orders'>('sales');
  const data = bars(c.series);
  const value = (b: Bar): number => (metric === 'sales' ? Number(b.sales) : b.orders);
  const max = Math.max(1, ...data.map(value));
  const text = (b: Bar) => (metric === 'sales' ? money(b.sales, c.currency) : `${b.orders} طلباً`);

  return (
    <section className="vx-card" aria-labelledby={`vx-chart-${c.currency}`}>
      <div className="vx-card__head">
        <h3 className="vx-card__title" id={`vx-chart-${c.currency}`}>
          المبيعات والطلبات
        </h3>
        <span className="vx-card__end vx-pills" role="group" aria-label="المؤشّر">
          <button type="button" className="vx-pill" aria-pressed={metric === 'sales'} onClick={() => setMetric('sales')}>
            المبيعات
          </button>
          <button type="button" className="vx-pill" aria-pressed={metric === 'orders'} onClick={() => setMetric('orders')}>
            الطلبات
          </button>
        </span>
      </div>
      <div className="vx-chart" aria-hidden>
        {data.map((b) => (
          <span key={b.title} className="vx-bar" title={`${text(b)} — ${b.title}`}>
            <span
              className={`vx-bar__fill${metric === 'sales' ? ' vx-bar__fill--money' : ''}`}
              style={{ blockSize: `${Math.max(3, Math.round((value(b) / max) * 150))}px` }}
            />
            <span className="vx-bar__label">{b.label}</span>
          </span>
        ))}
      </div>
      {/* الرسم لقارئ الشاشة: الأرقام نفسها جدولاً */}
      <table className="visually-hidden">
        <caption>{metric === 'sales' ? 'المبيعات' : 'الطلبات'} لكل فترة</caption>
        <tbody>
          {data.map((b) => (
            <tr key={b.title}>
              <th scope="row">{b.title}</th>
              <td>{text(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="vx-hint">
        <Icon name="info" size={13} />
        مرّر على العمود لترى قيمته. المبيعات من دفترك (قيود البيع)، بعملة التسوية {c.currency}، وأيام الرسم بتوقيت UTC كأيام الدفتر.
      </p>
    </section>
  );
}

function CurrencySection({ c, report, multi }: { c: CurrencyReport; report: Report; multi: boolean }) {
  const rate = report.orders.returnRatePct;
  return (
    <section className="vx-currency" aria-label={`أرقام ${c.currency}`}>
      {multi ? <h2 className="vx-currency__title">بعملة {c.currency}</h2> : null}

      <div className="vx-kpis">
        <div className="stat stat--money">
          <span className="stat__label">المبيعات</span>
          <span className="stat__value money num">{money(c.salesMinorUnits, c.currency)}</span>
          <span className="stat__note">قيمة منتجاتك المبيعة — بعملة تسويتك</span>
        </div>
        <div className="stat">
          <span className="stat__label">الطلبات</span>
          <span className="stat__value num">{c.paidOrders}</span>
          <span className="stat__note">طلبات مدفوعة في المدى</span>
        </div>
        <div className="stat stat--money">
          <span className="stat__label">العمولة المدفوعة</span>
          <span className="stat__value money num">{money(c.commissionMinorUnits, c.currency)}</span>
          <span className="stat__note">بعد ردّ عمولة القطع المرتجعة</span>
        </div>
        <div className="stat">
          <span className="stat__label">نسبة الإرجاع</span>
          <span className={`stat__value num${rate !== null && rate > 4 ? ' vx-kpi__warn' : ''}`}>{rate === null ? '—' : `${rate.toFixed(1)}%`}</span>
          <span className="stat__note">من الطلبات المسلّمة</span>
        </div>
      </div>

      <Chart c={c} />

      <div className="vx-split">
        <section className="vx-card vx-card--flush" aria-labelledby={`vx-top-${c.currency}`}>
          <div className="vx-card__head vx-card__head--bar">
            <h3 className="vx-card__title" id={`vx-top-${c.currency}`}>
              الأكثر مبيعاً
            </h3>
          </div>
          {c.topProducts.length === 0 ? (
            <p className="vm-list-empty">لا مبيعات في هذا المدى.</p>
          ) : (
            <div role="table" aria-label="الأكثر مبيعاً">
              <div role="row" className="vx-top__row vx-top__row--head">
                <span role="columnheader" className="num">
                  #
                </span>
                <span role="columnheader">المنتج</span>
                <span role="columnheader" className="vx-top__num">
                  الوحدات
                </span>
                <span role="columnheader" className="vx-top__num">
                  قيمة المنتجات
                </span>
              </div>
              {c.topProducts.map((p, i) => (
                <div role="row" key={p.productId} className="vx-top__row">
                  <span role="cell" className="vx-top__rank num">
                    {i + 1}
                  </span>
                  <span role="cell" className="vx-top__name">
                    <Link href={`/vendor/products/${p.productId}`}>{p.nameAr}</Link>
                  </span>
                  <span role="cell" className="vx-top__num num">
                    {p.units}
                  </span>
                  <span role="cell" className="vx-top__money money num">
                    {money(p.revenueMinorUnits, c.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="vx-card" aria-labelledby={`vx-misc-${c.currency}`}>
          <h3 className="vx-card__title" id={`vx-misc-${c.currency}`}>
            مؤشرات أخرى
          </h3>
          <ul className="vx-misc">
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">صافي أرباحك</span>
                <span className="vx-misc__note">المبيعات + الشحن − العمولة − المرتجعات ± التسويات</span>
              </span>
              <span className="vx-misc__value money num">{money(c.netMinorUnits, c.currency)}</span>
            </li>
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">متوسط قيمة الطلب</span>
                <span className="vx-misc__note">المبيعات ÷ الطلبات</span>
              </span>
              <span className="vx-misc__value money num">{money(c.averageOrderMinorUnits, c.currency)}</span>
            </li>
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">الشحن المحصَّل</span>
                <span className="vx-misc__note">لا عمولة على الشحن</span>
              </span>
              <span className="vx-misc__value money num">{money(c.shippingMinorUnits, c.currency)}</span>
            </li>
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">المرتجعات</span>
                <span className="vx-misc__note">ما رُدّ من مبيعاتك للمشترين</span>
              </span>
              <span className="vx-misc__value money num">{money(c.refundsMinorUnits, c.currency)}</span>
            </li>
            {c.adjustmentsMinorUnits !== '0' ? (
              <li className="vx-misc__row">
                <span className="vx-misc__text">
                  <span className="vx-misc__label">تسويات</span>
                  <span className="vx-misc__note">قيود تصحيح من الإدارة وفروق صرف</span>
                </span>
                <span className="vx-misc__value money num">{money(c.adjustmentsMinorUnits, c.currency)}</span>
              </li>
            ) : null}
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">طلبات رُفضت منك</span>
                <span className="vx-misc__note">تؤثّر على تقييم متجرك</span>
              </span>
              <span className={`vx-misc__value num${report.orders.rejectedByVendor > 0 ? ' vx-misc__value--danger' : ''}`}>
                {report.orders.rejectedByVendor}
              </span>
            </li>
          </ul>
        </section>
      </div>
    </section>
  );
}

/**
 * VD-19 — التقارير.
 *
 * كل مبلغ من الدفتر لا من إجماليات الطلبات، ولكل عملة وحدها — لا يُجمع
 * ريال إلى دينار. المدى أيام كاملة: 7 أو 30 أو 90 يوماً حتى اليوم، أو من–إلى.
 */
export default function ReportsPage() {
  const today = isoDay(new Date());
  const [preset, setPreset] = useState<number | null>(30);
  const [from, setFrom] = useState(shift(today, -29));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  // المدى الذي وصلت أرقامه — «جارٍ التحديث» ما دام المطلوب غيره
  const [loaded, setLoaded] = useState('');
  const loading = loaded !== `${from}|${to}`;

  useEffect(() => {
    let alive = true;
    api<Report>(`/vendor/reports?from=${from}&to=${to}`)
      .then((r) => {
        if (!alive) return;
        setData(r);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoaded(`${from}|${to}`));
    return () => {
      alive = false;
    };
  }, [from, to]);

  const pick = (days: number) => {
    setPreset(days);
    setTo(today);
    setFrom(shift(today, -(days - 1)));
  };

  const download = async (kind: 'csv' | 'xlsx') => {
    try {
      const blob = await apiBlob(`/vendor/reports/export.${kind}?from=${from}&to=${to}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `basta-reports-${from}-${to}.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const statuses = Object.entries(data?.orders.byStatus ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="vm-page">
      <PageHead
        title="التقارير"
        meta={data ? `${fmt(data.range.from)} – ${fmt(data.range.to)}` : undefined}
        actions={
          <span className="vx-range">
            <span className="seg" role="group" aria-label="المدى">
              {PRESETS.map((p) => (
                <button key={p.days} type="button" className="seg__opt" aria-pressed={preset === p.days} onClick={() => pick(p.days)}>
                  {p.label}
                </button>
              ))}
            </span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download('xlsx')}>
              <Icon name="download" size={14} />
              Excel
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download('csv')}>
              <Icon name="download" size={14} />
              CSV
            </button>
          </span>
        }
      />

      <div className="vx-range">
        <span className="vx-range__dates">
          من
          <DateField
            label="من"
            value={from}
            max={to}
            onChange={(v) => {
              if (!v) return;
              setPreset(null);
              setFrom(v);
            }}
          />
        </span>
        <span className="vx-range__dates">
          إلى
          <DateField
            label="إلى"
            value={to}
            min={from}
            max={today}
            onChange={(v) => {
              if (!v) return;
              setPreset(null);
              setTo(v);
            }}
          />
        </span>
        {loading && data ? <span className="vx-range__dates">جارٍ التحديث…</span> : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!data ? (
        error ? null : (
          <div className="vm-loading vm-loading--page" role="status">
            <span className="visually-hidden">جارٍ حساب التقرير…</span>
            <span className="skeleton vm-loading__block" />
            <span className="skeleton vm-loading__panel" />
          </div>
        )
      ) : data.currencies.length === 0 ? (
        <EmptyState icon="chart" title="لا مبيعات في هذا المدى">
          اختر مدى أطول، أو عد بعد أول طلب مدفوع — تظهر أرقامك هنا من دفترك مباشرة.
        </EmptyState>
      ) : (
        data.currencies.map((c) => <CurrencySection key={c.currency} c={c} report={data} multi={data.currencies.length > 1} />)
      )}

      {data && data.orders.total > 0 ? (
        <section className="vx-card" aria-labelledby="vx-status-title">
          <div className="vx-card__head">
            <h2 className="vx-card__title" id="vx-status-title">
              الطلبات حسب الحالة
            </h2>
            <span className="vx-card__sub">
              <span className="num">{data.orders.total}</span> طلباً وصلك في المدى
            </span>
          </div>
          <ul className="vx-misc">
            {statuses.map(([s, n]) => (
              <li key={s} className="vx-misc__row">
                <span className={`badge ${toneOf(s)}`}>{labelOf(s)}</span>
                <span className="vx-misc__value num">{n}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
