'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Card, Spinner } from '@/components/ui';
import { api, apiBlob } from '@/lib/api';
import { money, when } from '@/lib/orders';

interface Row {
  id: string;
  createdAt: string;
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

  if (!currencies) return error ? <Alert tone="danger">{error}</Alert> : <Spinner label="جارٍ فتح الكشف…" />;

  return (
    <div className="stack stack--loose">
      <header className="row row--between">
        <div className="stack stack--tight">
          <Link href="/vendor/finance" className="small">
            → المحفظة
          </Link>
          <h1>كشف الحساب</h1>
        </div>
        <button type="button" className="btn btn--secondary btn--sm" disabled={!data} onClick={() => void download()}>
          تصدير CSV
        </button>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {currencies.length === 0 ? <p className="empty muted">لا حركات بعد.</p> : null}

      {currencies.length ? (
        <div className="row">
          <label className="field">
            <span className="field__label">العملة</span>
            <select className="field__control" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">من</span>
            <input type="date" className="field__control" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">إلى</span>
            <input type="date" className="field__control" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat__label">افتتاحي — معلّق / متاح</span>
              <span className="stat__value money small">
                {money(data.opening.pendingMinorUnits, data.currency)} / {money(data.opening.availableMinorUnits, data.currency)}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">ختامي — معلّق / متاح</span>
              <span className="stat__value money small">
                {money(data.closing.pendingMinorUnits, data.currency)} / {money(data.closing.availableMinorUnits, data.currency)}
              </span>
            </div>
          </div>
          <Card>
            {data.rows.length === 0 ? (
              <p className="empty muted">لا قيود في هذه الفترة.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>البيان</th>
                      <th>الطلب</th>
                      <th>الجيب</th>
                      <th>دائن</th>
                      <th>مدين</th>
                      <th>المتاح بعده</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="small">{when(r.createdAt)}</td>
                        <td className="wrap">
                          {r.label}
                          {r.reversesEntryId ? <span className="badge badge--pending"> يعكس قيداً</span> : null}
                          {r.memo ? <div className="small muted">{r.memo}</div> : null}
                        </td>
                        <td className="num small">{r.subOrderNumber ?? '—'}</td>
                        <td className="small">{r.bucket === 'pending' ? 'معلّق' : 'متاح'}</td>
                        <td className="money">{r.direction === 'credit' ? money(r.amountMinorUnits, data.currency) : ''}</td>
                        <td className="money">{r.direction === 'debit' ? money(r.amountMinorUnits, data.currency) : ''}</td>
                        <td className="money">{money(r.availableAfter, data.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
