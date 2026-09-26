'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { Icon } from '@/components/icons';
import { api, apiBlob } from '@/lib/api';
import { money, when } from '@/lib/orders';

interface Row {
  id: string;
  createdAt: string;
  entryType: string;
  label: string;
  direction: 'credit' | 'debit';
  bucket: 'pending' | 'available';
  amountMinorUnits: string;
  subOrderNumber: string | null;
  memo: string | null;
  reversesEntryId: string | null;
  pendingAfter: string;
  availableAfter: string;
}

interface Statement {
  currency: string;
  opening: { pendingMinorUnits: string; availableMinorUnits: string };
  closing: { pendingMinorUnits: string; availableMinorUnits: string };
  rows: Row[];
}

/**
 * تصفية النوع في VD-17 — فوق الأسطر المجلوبة نفسها، لا طلب جديد. كل مجموعة
 * تضمّ أنواع القيد التي تحمل معناها في الدفتر.
 */
const TYPES: { key: string; label: string; entries: string[] }[] = [
  { key: 'all', label: 'الكل', entries: [] },
  { key: 'sale', label: 'بيع', entries: ['sale_credit', 'shipping_credit'] },
  { key: 'commission', label: 'عمولة', entries: ['commission_debit'] },
  { key: 'release', label: 'تحرير', entries: ['hold_release_out', 'hold_release_in'] },
  { key: 'refund', label: 'ردّ مبلغ', entries: ['refund_debit'] },
  { key: 'payout', label: 'سحب', entries: ['payout_debit'] },
  { key: 'adjust', label: 'تسوية', entries: ['adjustment_credit', 'adjustment_debit', 'fx_rounding'] },
];

/** لون شارة النوع كما في VD-17 */
const TYPE_TONE: Record<string, string> = {
  sale_credit: 'badge--money',
  shipping_credit: 'badge--pending',
  commission_debit: 'badge--pending',
  hold_release_out: 'badge--success',
  hold_release_in: 'badge--success',
  refund_debit: 'badge--danger',
  payout_debit: 'badge--info',
  adjustment_credit: 'badge--warning',
  adjustment_debit: 'badge--warning',
  fx_rounding: 'badge--warning',
};

/**
 * VD-19 — كشف الحساب.
 *
 * كل سطر قيد في الدفتر بلا تجميع ولا حذف، والرصيد بعده. التصحيح يظهر قيداً
 * معاكساً بإشارة «يعكس» — لا سطراً اختفى. والتصدير هو الدفتر نفسه.
 */
export default function StatementPage() {
  const [currencies, setCurrencies] = useState<string[] | null>(null);
  const [currency, setCurrency] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('all');
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ currency: string }[]>('/vendor/finance/wallets')
      .then((w) => {
        if (!alive) return;
        setCurrencies(w.map((x) => x.currency));
        if (w[0]) setCurrency(w[0].currency);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const query = () => {
    const q = new URLSearchParams({ currency });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return q.toString();
  };

  useEffect(() => {
    if (!currency) return;
    let alive = true;
    const q = new URLSearchParams({ currency });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    api<Statement>(`/vendor/finance/statement?${q}`)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [currency, from, to]);

  const download = async () => {
    try {
      const blob = await apiBlob(`/vendor/finance/statement.csv?${query()}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `basta-statement-${currency}${from ? `-${from}` : ''}${to ? `-${to}` : ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const back = (
    <Link href="/vendor/finance" className="vm-back">
      <Icon name="back" size={14} mirror />
      المحفظة
    </Link>
  );

  if (!currencies) {
    return error ? (
      <div className="vm-page">
        {back}
        <div className="empty">
          <span className="empty__icon vm-error-icon" aria-hidden>
            <Icon name="alert" size={26} />
          </span>
          <p className="empty__title">تعذّر فتح كشف الحساب</p>
          <Alert tone="danger">{error}</Alert>
        </div>
      </div>
    ) : (
      <div className="vm-loading vm-loading--page" role="status">
        <span className="visually-hidden">جارٍ فتح الكشف…</span>
        <span className="skeleton vm-loading__title" />
        <span className="skeleton vm-loading__block" />
        <span className="skeleton vm-loading__panel" />
      </div>
    );
  }

  const picked = TYPES.find((t) => t.key === type) ?? TYPES[0]!;
  const rows = data ? (picked.entries.length ? data.rows.filter((r) => picked.entries.includes(r.entryType)) : data.rows) : [];

  return (
    <div className="vm-page">
      <div className="vm-detail-head">
        {back}
        <PageHead
          title="كشف الحساب"
          meta={currency ? `عملة التسوية: ${currency}` : undefined}
          actions={
            <button type="button" className="btn btn--secondary btn--sm" disabled={!data} onClick={() => void download()}>
              <Icon name="download" size={14} />
              صدّر CSV
            </button>
          }
        />
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {currencies.length === 0 ? (
        <EmptyState icon="wallet" title="لا حركات مالية">
          تظهر قيود دفترك هنا بعد أول عملية بيع مدفوعة.
        </EmptyState>
      ) : null}

      {data ? (
        <div className="vm-balances vm-balances--two">
          <div className="stat stat--money">
            <span className="stat__label">
              <Icon name="history" size={15} />
              الرصيد الافتتاحي
            </span>
            <span className="vm-pair">
              <span>قيد التحرير</span>
              <span className="money num">{money(data.opening.pendingMinorUnits, data.currency)}</span>
            </span>
            <span className="vm-pair">
              <span>متاح</span>
              <span className="money num">{money(data.opening.availableMinorUnits, data.currency)}</span>
            </span>
          </div>
          <div className="stat stat--money">
            <span className="stat__label">
              <Icon name="wallet" size={15} />
              الرصيد الختامي
            </span>
            <span className="vm-pair">
              <span>قيد التحرير</span>
              <span className="money num">{money(data.closing.pendingMinorUnits, data.currency)}</span>
            </span>
            <span className="vm-pair">
              <span>متاح</span>
              <span className="money num">{money(data.closing.availableMinorUnits, data.currency)}</span>
            </span>
          </div>
        </div>
      ) : null}

      {currencies.length ? (
        <section className="card card--flush">
          <header className="card__head vm-stmt-head">
            <h2>القيود</h2>
            {data ? <span className="num vm-count">{rows.length}</span> : null}
            <div className="vm-filters">
              <label className="vm-filter">
                <span className="vm-filter__label">العملة</span>
                <select className="field__control" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="vm-filter">
                <span className="vm-filter__label">من</span>
                <input type="date" className="field__control" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="vm-filter">
                <span className="vm-filter__label">إلى</span>
                <input type="date" className="field__control" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          </header>

          <div className="vm-types" role="group" aria-label="نوع القيد">
            {TYPES.map((t) => (
              <button key={t.key} type="button" className="vm-type" aria-pressed={type === t.key} onClick={() => setType(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {!data ? (
            <div className="vm-loading" role="status">
              <span className="visually-hidden">جارٍ جلب القيود…</span>
              <span className="skeleton vm-loading__row" />
              <span className="skeleton vm-loading__row" />
            </div>
          ) : rows.length === 0 ? (
            <div className="vm-list-empty vm-list-empty--center">
              <p className="vm-list-empty__title">لا حركات في هذا المدى</p>
              <p>وسّع المدى أو أزل تصفية النوع.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table vm-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>النوع</th>
                    <th>المرجع</th>
                    <th>الجيب</th>
                    <th className="end">المبلغ</th>
                    <th className="end">المتاح بعده</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td data-label="التاريخ" className="vm-muted">
                        {when(r.createdAt)}
                      </td>
                      <td data-label="النوع" className="wrap">
                        <span className="vm-entry">
                          <span className={`badge ${TYPE_TONE[r.entryType] ?? 'badge--pending'}`}>{r.label}</span>
                          {r.reversesEntryId ? <span className="badge badge--warning">يعكس قيداً</span> : null}
                        </span>
                        {r.memo ? <span className="vm-entry__memo">{r.memo}</span> : null}
                      </td>
                      <td data-label="المرجع" className="num">
                        {r.subOrderNumber ?? '—'}
                      </td>
                      <td data-label="الجيب" className="vm-muted">
                        {r.bucket === 'pending' ? 'قيد التحرير' : 'متاح'}
                      </td>
                      <td data-label="المبلغ" className="money num end">
                        {r.direction === 'credit' ? '+' : '−'}
                        {money(r.amountMinorUnits, data.currency)}
                      </td>
                      <td data-label="المتاح بعده" className="money num end">
                        {money(r.availableAfter, data.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
