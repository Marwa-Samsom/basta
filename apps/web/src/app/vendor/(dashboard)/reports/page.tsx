'use client';

import '@/styles/screens/vendor-extra.css';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { DateField } from '@/components/date-field';
import { Icon } from '@/components/icons';
import { api, apiBlob } from '@/lib/api';
import { labelOf, money, toneOf } from '@/lib/orders';
import { useLocale, useT } from '@/components/locale';
import { intlLocale, type Locale } from '@/lib/i18n';

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
  { days: 7, label: '7 أيام', en: '7 days' },
  { days: 30, label: '30 يوماً', en: '30 days' },
  { days: 90, label: '90 يوماً', en: '90 days' },
] as const;

/** أيام UTC كما يقرؤها الخادم — «اليوم» هنا هو يوم الدفتر نفسه */
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const shift = (iso: string, days: number): string => isoDay(new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000));

const formatsOf = (locale: Locale) => ({
  date: new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
  short: new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'numeric', timeZone: 'UTC' }),
});
const FORMATS: Readonly<Record<Locale, ReturnType<typeof formatsOf>>> = { ar: formatsOf('ar'), en: formatsOf('en') };
const fmt = (iso: string, locale: Locale, kind: 'date' | 'short' = 'date') =>
  FORMATS[locale][kind].format(new Date(`${iso}T00:00:00Z`));

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
function bars(series: Point[], locale: Locale): Bar[] {
  const size = series.length <= 14 ? 1 : Math.ceil(series.length / 12);
  const out: Bar[] = [];
  for (let i = 0; i < series.length; i += size) {
    const chunk = series.slice(i, i + size);
    const first = chunk[0]!.day;
    const last = chunk[chunk.length - 1]!.day;
    out.push({
      label: fmt(first, locale, 'short'),
      title: size === 1 ? fmt(first, locale) : `${fmt(first, locale)} – ${fmt(last, locale)}`,
      sales: chunk.reduce((a, p) => a + BigInt(p.salesMinorUnits), 0n),
      orders: chunk.reduce((a, p) => a + p.orders, 0),
    });
  }
  return out;
}

function Chart({ c }: { c: CurrencyReport }) {
  const t = useT();
  const locale = useLocale();
  const [metric, setMetric] = useState<'sales' | 'orders'>('sales');
  const data = bars(c.series, locale);
  const value = (b: Bar): number => (metric === 'sales' ? Number(b.sales) : b.orders);
  const max = Math.max(1, ...data.map(value));
  const text = (b: Bar) =>
    metric === 'sales'
      ? money(b.sales, c.currency, locale)
      : t(`${b.orders} طلباً`, `${b.orders} ${b.orders === 1 ? 'order' : 'orders'}`);

  return (
    <section className="vx-card" aria-labelledby={`vx-chart-${c.currency}`}>
      <div className="vx-card__head">
        <h3 className="vx-card__title" id={`vx-chart-${c.currency}`}>
          {t('المبيعات والطلبات', 'Sales and orders')}
        </h3>
        <span className="vx-card__end vx-pills" role="group" aria-label={t('المؤشّر', 'Metric')}>
          <button type="button" className="vx-pill" aria-pressed={metric === 'sales'} onClick={() => setMetric('sales')}>
            {t('المبيعات', 'Sales')}
          </button>
          <button type="button" className="vx-pill" aria-pressed={metric === 'orders'} onClick={() => setMetric('orders')}>
            {t('الطلبات', 'Orders')}
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
        <caption>
          {metric === 'sales' ? t('المبيعات', 'Sales') : t('الطلبات', 'Orders')} {t('لكل فترة', 'per period')}
        </caption>
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
        {t(
          `مرّر على العمود لترى قيمته. المبيعات من دفترك (قيود البيع)، بعملة التسوية ${c.currency}، وأيام الرسم بتوقيت UTC كأيام الدفتر.`,
          `Hover over a bar to see its value. Sales come from your ledger (sale entries), in settlement currency ${c.currency}; chart days are in UTC, like the ledger.`,
        )}
      </p>
    </section>
  );
}

function CurrencySection({ c, report, multi }: { c: CurrencyReport; report: Report; multi: boolean }) {
  const t = useT();
  const locale = useLocale();
  const rate = report.orders.returnRatePct;
  return (
    <section className="vx-currency" aria-label={t(`أرقام ${c.currency}`, `${c.currency} figures`)}>
      {multi ? <h2 className="vx-currency__title">{t(`بعملة ${c.currency}`, `In ${c.currency}`)}</h2> : null}

      <div className="vx-kpis">
        <div className="stat stat--money">
          <span className="stat__label">{t('المبيعات', 'Sales')}</span>
          <span className="stat__value money num">{money(c.salesMinorUnits, c.currency, locale)}</span>
          <span className="stat__note">{t('قيمة منتجاتك المبيعة — بعملة تسويتك', 'Value of your products sold — in your settlement currency')}</span>
        </div>
        <div className="stat">
          <span className="stat__label">{t('الطلبات', 'Orders')}</span>
          <span className="stat__value num">{c.paidOrders}</span>
          <span className="stat__note">{t('طلبات مدفوعة في المدى', 'Paid orders in this range')}</span>
        </div>
        <div className="stat stat--money">
          <span className="stat__label">{t('العمولة المدفوعة', 'Commission paid')}</span>
          <span className="stat__value money num">{money(c.commissionMinorUnits, c.currency, locale)}</span>
          <span className="stat__note">{t('بعد ردّ عمولة القطع المرتجعة', 'After commission refunded on returned items')}</span>
        </div>
        <div className="stat">
          <span className="stat__label">{t('نسبة الإرجاع', 'Return rate')}</span>
          <span className={`stat__value num${rate !== null && rate > 4 ? ' vx-kpi__warn' : ''}`}>{rate === null ? '—' : `${rate.toFixed(1)}%`}</span>
          <span className="stat__note">{t('من الطلبات المسلّمة', 'Of delivered orders')}</span>
        </div>
      </div>

      <Chart c={c} />

      <div className="vx-split">
        <section className="vx-card vx-card--flush" aria-labelledby={`vx-top-${c.currency}`}>
          <div className="vx-card__head vx-card__head--bar">
            <h3 className="vx-card__title" id={`vx-top-${c.currency}`}>
              {t('الأكثر مبيعاً', 'Best sellers')}
            </h3>
          </div>
          {c.topProducts.length === 0 ? (
            <p className="vm-list-empty">{t('لا مبيعات في هذا المدى.', 'No sales in this range.')}</p>
          ) : (
            <div role="table" aria-label={t('الأكثر مبيعاً', 'Best sellers')}>
              <div role="row" className="vx-top__row vx-top__row--head">
                <span role="columnheader" className="num">
                  #
                </span>
                <span role="columnheader">{t('المنتج', 'Product')}</span>
                <span role="columnheader" className="vx-top__num">
                  {t('الوحدات', 'Units')}
                </span>
                <span role="columnheader" className="vx-top__num">
                  {t('قيمة المنتجات', 'Product value')}
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
                    {money(p.revenueMinorUnits, c.currency, locale)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="vx-card" aria-labelledby={`vx-misc-${c.currency}`}>
          <h3 className="vx-card__title" id={`vx-misc-${c.currency}`}>
            {t('مؤشرات أخرى', 'Other indicators')}
          </h3>
          <ul className="vx-misc">
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">{t('صافي أرباحك', 'Your net earnings')}</span>
                <span className="vx-misc__note">
                  {t('المبيعات + الشحن − العمولة − المرتجعات ± التسويات', 'Sales + shipping − commission − returns ± adjustments')}
                </span>
              </span>
              <span className="vx-misc__value money num">{money(c.netMinorUnits, c.currency, locale)}</span>
            </li>
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">{t('متوسط قيمة الطلب', 'Average order value')}</span>
                <span className="vx-misc__note">{t('المبيعات ÷ الطلبات', 'Sales ÷ orders')}</span>
              </span>
              <span className="vx-misc__value money num">{money(c.averageOrderMinorUnits, c.currency, locale)}</span>
            </li>
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">{t('الشحن المحصَّل', 'Shipping collected')}</span>
                <span className="vx-misc__note">{t('لا عمولة على الشحن', 'No commission on shipping')}</span>
              </span>
              <span className="vx-misc__value money num">{money(c.shippingMinorUnits, c.currency, locale)}</span>
            </li>
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">{t('المرتجعات', 'Returns')}</span>
                <span className="vx-misc__note">{t('ما رُدّ من مبيعاتك للمشترين', 'Sales refunded to buyers')}</span>
              </span>
              <span className="vx-misc__value money num">{money(c.refundsMinorUnits, c.currency, locale)}</span>
            </li>
            {c.adjustmentsMinorUnits !== '0' ? (
              <li className="vx-misc__row">
                <span className="vx-misc__text">
                  <span className="vx-misc__label">{t('تسويات', 'Adjustments')}</span>
                  <span className="vx-misc__note">{t('قيود تصحيح من الإدارة وفروق صرف', 'Correction entries from admin and exchange differences')}</span>
                </span>
                <span className="vx-misc__value money num">{money(c.adjustmentsMinorUnits, c.currency, locale)}</span>
              </li>
            ) : null}
            <li className="vx-misc__row">
              <span className="vx-misc__text">
                <span className="vx-misc__label">{t('طلبات رُفضت منك', 'Orders you rejected')}</span>
                <span className="vx-misc__note">{t('تؤثّر على تقييم متجرك', "Affects your shop's rating")}</span>
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
  const t = useT();
  const locale = useLocale();
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
        title={t('التقارير', 'Reports')}
        meta={data ? `${fmt(data.range.from, locale)} – ${fmt(data.range.to, locale)}` : undefined}
        actions={
          <span className="vx-range">
            <span className="seg" role="group" aria-label={t('المدى', 'Range')}>
              {PRESETS.map((p) => (
                <button key={p.days} type="button" className="seg__opt" aria-pressed={preset === p.days} onClick={() => pick(p.days)}>
                  {t(p.label, p.en)}
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
          {t('من', 'From')}
          <DateField
            label={t('من', 'From')}
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
          {t('إلى', 'To')}
          <DateField
            label={t('إلى', 'To')}
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
        {loading && data ? <span className="vx-range__dates">{t('جارٍ التحديث…', 'Updating…')}</span> : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!data ? (
        error ? null : (
          <div className="vm-loading vm-loading--page" role="status">
            <span className="visually-hidden">{t('جارٍ حساب التقرير…', 'Calculating the report…')}</span>
            <span className="skeleton vm-loading__block" />
            <span className="skeleton vm-loading__panel" />
          </div>
        )
      ) : data.currencies.length === 0 ? (
        <EmptyState icon="chart" title={t('لا مبيعات في هذا المدى', 'No sales in this range')}>
          {t(
            'اختر مدى أطول، أو عد بعد أول طلب مدفوع — تظهر أرقامك هنا من دفترك مباشرة.',
            'Pick a longer range, or come back after your first paid order — your figures show here straight from your ledger.',
          )}
        </EmptyState>
      ) : (
        data.currencies.map((c) => <CurrencySection key={c.currency} c={c} report={data} multi={data.currencies.length > 1} />)
      )}

      {data && data.orders.total > 0 ? (
        <section className="vx-card" aria-labelledby="vx-status-title">
          <div className="vx-card__head">
            <h2 className="vx-card__title" id="vx-status-title">
              {t('الطلبات حسب الحالة', 'Orders by status')}
            </h2>
            <span className="vx-card__sub">
              <span className="num">{data.orders.total}</span>{' '}
              {t('طلباً وصلك في المدى', data.orders.total === 1 ? 'order received in this range' : 'orders received in this range')}
            </span>
          </div>
          <ul className="vx-misc">
            {statuses.map(([s, n]) => (
              <li key={s} className="vx-misc__row">
                <span className={`badge ${toneOf(s)}`}>{labelOf(s, locale)}</span>
                <span className="vx-misc__value num">{n}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
