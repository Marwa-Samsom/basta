'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { DateField } from '@/components/date-field';
import { Icon } from '@/components/icons';
import { api, apiBlob } from '@/lib/api';
import { money, when } from '@/lib/orders';
import { useLocale, useT } from '@/components/locale';
import { useReturnTick } from '@/lib/fresh';

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
  /** الكشف صفحات (500 قيد) — المؤشّر يجلب التالية، null حين لا تالية */
  nextCursor: string | null;
}

/**
 * تصفية النوع في VD-17 — فوق الأسطر المجلوبة نفسها، لا طلب جديد. كل مجموعة
 * تضمّ أنواع القيد التي تحمل معناها في الدفتر.
 */
const TYPES: { key: string; label: string; en: string; entries: string[] }[] = [
  { key: 'all', label: 'الكل', en: 'All', entries: [] },
  { key: 'sale', label: 'بيع', en: 'Sale', entries: ['sale_credit', 'shipping_credit'] },
  { key: 'commission', label: 'عمولة', en: 'Commission', entries: ['commission_debit'] },
  { key: 'release', label: 'تحرير', en: 'Release', entries: ['hold_release_out', 'hold_release_in'] },
  { key: 'refund', label: 'ردّ مبلغ', en: 'Refund', entries: ['refund_debit'] },
  { key: 'payout', label: 'سحب', en: 'Payout', entries: ['payout_debit'] },
  { key: 'adjust', label: 'تسوية', en: 'Adjustment', entries: ['adjustment_credit', 'adjustment_debit', 'fx_rounding'] },
];

/** أسماء أنواع القيد بالإنجليزية — الخادم يرسل `label` بالعربية وحدها */
const ENTRY_LABEL_EN: Record<string, string> = {
  sale_credit: 'Sales',
  shipping_credit: 'Shipping',
  commission_debit: 'Platform commission',
  hold_release_out: 'Released from pending',
  hold_release_in: 'Released to available',
  refund_debit: 'Refund to buyer',
  payout_debit: 'Payout',
  adjustment_credit: 'Credit adjustment',
  adjustment_debit: 'Debit adjustment',
  fx_rounding: 'Exchange difference',
};

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
  const t = useT();
  const locale = useLocale();
  const [currencies, setCurrencies] = useState<string[] | null>(null);
  const [currency, setCurrency] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('all');
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

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

  const returned = useReturnTick();
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
  }, [currency, from, to, returned]);

  // الصفحة التالية تُلحق بما جُلب: الرصيد بعد كل سطر يكمل من آخر سطر، والافتتاحي والختامي للمدة كلها
  const loadMore = async () => {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await api<Statement>(`/vendor/finance/statement?${query()}&cursor=${data.nextCursor}`);
      setData({ ...next, rows: [...data.rows, ...next.rows] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

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
      {t('المحفظة', 'Wallet')}
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
          <p className="empty__title">{t('تعذّر فتح كشف الحساب', 'Could not open the statement')}</p>
          <Alert tone="danger">{error}</Alert>
        </div>
      </div>
    ) : (
      <div className="vm-loading vm-loading--page" role="status">
        <span className="visually-hidden">{t('جارٍ فتح الكشف…', 'Opening the statement…')}</span>
        <span className="skeleton vm-loading__title" />
        <span className="skeleton vm-loading__block" />
        <span className="skeleton vm-loading__panel" />
      </div>
    );
  }

  const picked = TYPES.find((x) => x.key === type) ?? TYPES[0]!;
  const rows = data ? (picked.entries.length ? data.rows.filter((r) => picked.entries.includes(r.entryType)) : data.rows) : [];

  return (
    <div className="vm-page">
      <div className="vm-detail-head">
        {back}
        <PageHead
          title={t('كشف الحساب', 'Statement')}
          meta={currency ? t(`عملة التسوية: ${currency}`, `Settlement currency: ${currency}`) : undefined}
          actions={
            <button type="button" className="btn btn--secondary btn--sm" disabled={!data} onClick={() => void download()}>
              <Icon name="download" size={14} />
              {t('صدّر CSV', 'Export CSV')}
            </button>
          }
        />
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {currencies.length === 0 ? (
        <EmptyState icon="wallet" title={t('لا حركات مالية', 'No transactions')}>
          {t('تظهر قيود دفترك هنا بعد أول عملية بيع مدفوعة.', 'Your ledger entries show here after your first paid sale.')}
        </EmptyState>
      ) : null}

      {data ? (
        <div className="vm-balances vm-balances--two">
          <div className="stat stat--money">
            <span className="stat__label">
              <Icon name="history" size={15} />
              {t('الرصيد الافتتاحي', 'Opening balance')}
            </span>
            <span className="vm-pair">
              <span>{t('قيد التحرير', 'Pending release')}</span>
              <span className="money num">{money(data.opening.pendingMinorUnits, data.currency, locale)}</span>
            </span>
            <span className="vm-pair">
              <span>{t('متاح', 'Available')}</span>
              <span className="money num">{money(data.opening.availableMinorUnits, data.currency, locale)}</span>
            </span>
          </div>
          <div className="stat stat--money">
            <span className="stat__label">
              <Icon name="wallet" size={15} />
              {t('الرصيد الختامي', 'Closing balance')}
            </span>
            <span className="vm-pair">
              <span>{t('قيد التحرير', 'Pending release')}</span>
              <span className="money num">{money(data.closing.pendingMinorUnits, data.currency, locale)}</span>
            </span>
            <span className="vm-pair">
              <span>{t('متاح', 'Available')}</span>
              <span className="money num">{money(data.closing.availableMinorUnits, data.currency, locale)}</span>
            </span>
          </div>
        </div>
      ) : null}

      {currencies.length ? (
        <section className="card card--flush">
          <header className="card__head vm-stmt-head">
            <h2>{t('القيود', 'Entries')}</h2>
            {data ? <span className="num vm-count">{rows.length}</span> : null}
            <div className="vm-filters">
              <label className="vm-filter">
                <span className="vm-filter__label">{t('العملة', 'Currency')}</span>
                <select className="field__control" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <div className="vm-filter">
                <span className="vm-filter__label">{t('من', 'From')}</span>
                <DateField label={t('من', 'From')} clearable value={from} onChange={setFrom} />
              </div>
              <div className="vm-filter">
                <span className="vm-filter__label">{t('إلى', 'To')}</span>
                <DateField label={t('إلى', 'To')} clearable value={to} onChange={setTo} />
              </div>
            </div>
          </header>

          <div className="vm-types" role="group" aria-label={t('نوع القيد', 'Entry type')}>
            {TYPES.map((x) => (
              <button key={x.key} type="button" className="vm-type" aria-pressed={type === x.key} onClick={() => setType(x.key)}>
                {t(x.label, x.en)}
              </button>
            ))}
          </div>

          {!data ? (
            <div className="vm-loading" role="status">
              <span className="visually-hidden">{t('جارٍ جلب القيود…', 'Loading entries…')}</span>
              <span className="skeleton vm-loading__row" />
              <span className="skeleton vm-loading__row" />
            </div>
          ) : rows.length === 0 ? (
            <div className="vm-list-empty vm-list-empty--center">
              <p className="vm-list-empty__title">{t('لا حركات في هذا المدى', 'No transactions in this range')}</p>
              <p>{t('وسّع المدى أو أزل تصفية النوع.', 'Widen the range or clear the type filter.')}</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table vm-table">
                <thead>
                  <tr>
                    <th>{t('التاريخ', 'Date')}</th>
                    <th>{t('النوع', 'Type')}</th>
                    <th>{t('المرجع', 'Reference')}</th>
                    <th>{t('الجيب', 'Balance')}</th>
                    <th className="end">{t('المبلغ', 'Amount')}</th>
                    <th className="end">{t('المتاح بعده', 'Available after')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td data-label={t('التاريخ', 'Date')} className="vm-muted">
                        {when(r.createdAt, locale)}
                      </td>
                      <td data-label={t('النوع', 'Type')} className="wrap">
                        <span className="vm-entry">
                          <span className={`badge ${TYPE_TONE[r.entryType] ?? 'badge--pending'}`}>
                            {locale === 'en' ? (ENTRY_LABEL_EN[r.entryType] ?? r.label) : r.label}
                          </span>
                          {r.reversesEntryId ? <span className="badge badge--warning">{t('يعكس قيداً', 'Reverses an entry')}</span> : null}
                        </span>
                        {r.memo ? <span className="vm-entry__memo">{r.memo}</span> : null}
                      </td>
                      <td data-label={t('المرجع', 'Reference')} className="num">
                        {r.subOrderNumber ?? '—'}
                      </td>
                      <td data-label={t('الجيب', 'Balance')} className="vm-muted">
                        {r.bucket === 'pending' ? t('قيد التحرير', 'Pending release') : t('متاح', 'Available')}
                      </td>
                      <td data-label={t('المبلغ', 'Amount')} className="money num end">
                        {r.direction === 'credit' ? '+' : '−'}
                        {money(r.amountMinorUnits, data.currency, locale)}
                      </td>
                      <td data-label={t('المتاح بعده', 'Available after')} className="money num end">
                        {money(r.availableAfter, data.currency, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data?.nextCursor ? (
            <div className="vm-more">
              <button type="button" className="btn btn--secondary btn--sm" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? t('جارٍ الجلب…', 'Loading…') : t('حمّل القيود التالية', 'Load more entries')}
              </button>
              <span className="vm-muted">
                {t('جُلب', 'Loaded')} <span className="num">{data.rows.length}</span>{' '}
                {t(
                  'قيداً — التصفية بالنوع على المجلوب، والتصدير يشمل المدة كلها',
                  `${data.rows.length === 1 ? 'entry' : 'entries'} — the type filter applies to what’s loaded; the export covers the whole period`,
                )}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
