'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, MoreButton, SearchBox, SortButton, Tabs } from '@/components/admin';
import type { SortOrder } from '@/components/ui';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { useAction, useAdminList } from '@/lib/admin';
import { minorUnitDigits } from '@/lib/money';
import { money, when } from '@/lib/orders';
import { ClearableInput } from '@/components/ui';
import { useLocale, useT } from '@/components/locale';
import { translator, type Locale } from '@/lib/i18n';

interface Waiting {
  orderNumber: string;
  placedAt: string;
  expiresAt: string | null;
  expired: boolean;
  amountMinorUnits: string;
  currency: string;
  storeCount: number;
  buyer: { name: string | null; email: string | null; phone: string | null };
}

interface Confirmed {
  orderNumber: string;
  buyerName: string | null;
  amountMinorUnits: string;
  currency: string;
  reference: string | null;
  note: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

interface RefundRow {
  id: string;
  amountMinorUnits: string;
  currency: string;
  reason: string;
  createdAt: string;
  orderNumber: string;
  subOrderNumber: string;
  store: string;
  buyer: { name: string | null; email: string | null; phone: string | null };
  paidWith: { reference: string | null; note: string | null };
}

const TABS = [
  { key: 'incoming', label: 'واردة — بانتظار التأكيد', en: 'Incoming — awaiting confirmation' },
  { key: 'refunds', label: 'ردود — للتحويل', en: 'Refunds — to transfer' },
  { key: 'confirmed', label: 'أُكّدت', en: 'Confirmed' },
];

/**
 * ما كتبه المدير كما في كشف البنك («25.5» أو «25.500») بالوحدات الصغرى للعملة — أو null
 * إن لم يكن مبلغاً. الخادم يطابقه بمبلغ الطلب، فلا يُؤكَّد طلب بتحويل غيره.
 */
function toMinor(text: string, currency: string): string | null {
  const digits = minorUnitDigits(currency);
  const t = text.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.');
  const m = new RegExp(`^(\\d{1,12})(?:\\.(\\d{0,${digits}}))?$`).exec(t);
  if (!m) return null;
  return (BigInt(m[1]!) * 10n ** BigInt(digits) + BigInt((m[2] ?? '').padEnd(digits, '0') || '0')).toString();
}

/** الوقت الباقي على المهلة بكلمات — «بقيت 5 ساعات» يُقرأ أسرع من تاريخ */
function left(expiresAt: string | null, locale: Locale = 'ar'): string {
  if (!expiresAt) return '—';
  const t = translator(locale);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return t('انتهت المهلة', 'Deadline passed');
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return t(`بقي ${Math.floor(h / 24)} يوم و${h % 24} ساعة`, `${plural(Math.floor(h / 24), 'day', 'days')} and ${plural(h % 24, 'hour', 'hours')} left`);
  if (h >= 1) return t(`بقيت ${h} ساعة`, `${plural(h, 'hour', 'hours')} left`);
  const m = Math.max(1, Math.floor(ms / 60_000));
  return t(`بقيت ${m} دقيقة`, `${plural(m, 'minute', 'minutes')} left`);
}

/**
 * الدفع بتحويل يدوي — الإدارة تطابق كشف البنك بالطلبات.
 *
 *   · واردة: المشتري حوّل وكتب رقم الطلب في الملاحظة. التأكيد بمرجع التحويل والمبلغ الذي
 *     وصل — وعندها فقط يُقسَّم الطلب ويصل المتاجر ويُقيَّد للبائعين.
 *   · ردود: ما أُلغي أو أُرجع بعد الدفع. حوّله للمشتري ثم سجّل مرجعك — قبل ذلك لا يُقال له
 *     «رُدّ المبلغ».
 */
export default function AdminTransfersPage() {
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState('incoming');
  // بحث واحد بالرقم أو الاسم أو المرجع — يصفّي القوائم الثلاث، وكلٌّ خمسين خمسين
  const [search, setSearch] = useState('');
  // لكل تبويب ترتيبه: الطابوران بالأقدم أولاً (ما ينتظر أطول قبل غيره)، والمؤكَّد بالأحدث
  const [sorts, setSorts] = useState<Record<string, SortOrder>>({ incoming: 'oldest', refunds: 'oldest', confirmed: 'newest' });
  const query = (key: string) => `?${new URLSearchParams({ sort: sorts[key] ?? 'newest', ...(search.trim() ? { search: search.trim() } : {}) })}`;
  const incoming = useAdminList<Waiting>(`/admin/payments/transfers${query('incoming')}`, (w) => w.orderNumber);
  const refunds = useAdminList<RefundRow>(`/admin/refunds/awaiting-transfer${query('refunds')}`, (r) => r.id);
  const confirmed = useAdminList<Confirmed>(tab === 'confirmed' ? `/admin/payments/transfers/confirmed${query('confirmed')}` : null, (c) => c.orderNumber);
  const searching = Boolean(search.trim());
  const clear = (
    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSearch('')}>
      {t('أزل التصفية', 'Clear filters')}
    </button>
  );
  const act = useAction();
  const ask = useConfirm();
  const [draft, setDraft] = useState<Record<string, { reference: string; amount: string; note: string }>>({});
  const [refundRefs, setRefundRefs] = useState<Record<string, string>>({});

  const counts = {
    incoming: incoming.data?.total,
    refunds: refunds.data?.total,
  };

  const edit = (n: string, patch: Partial<{ reference: string; amount: string; note: string }>) =>
    setDraft((d) => ({ ...d, [n]: { reference: '', amount: '', note: '', ...d[n], ...patch } }));

  /**
   * التسجيل يُبلغ المشتري أن ماله خرج، ولا يُتراجع عنه — والطوابير كانت تبدأ بالأقدم بلا بحث، فيُكتب
   * المرجع في صفّ غير المقصود. سُجّل ردّ طلب تجريبي بمرجع ردّ آخر هكذا (J-07، 20 أكتوبر 2026):
   * السؤال يعيد الطلب والمشتري والمبلغ قبل أن يُبلَّغ أحد.
   */
  const recordRefund = async (r: RefundRow) => {
    const reference = (refundRefs[r.id] ?? '').trim();
    const sure = await ask({
      title: t(
        `حوّلت ${money(r.amountMinorUnits, r.currency, locale)} إلى ${r.buyer.name ?? 'المشتري'}؟`,
        `Did you transfer ${money(r.amountMinorUnits, r.currency, locale)} to ${r.buyer.name ?? 'the buyer'}?`,
      ),
      body: (
        <>
          <p>
            {t('ردّ', 'Refund')} <bdi className="num">{r.subOrderNumber}</bdi> · {r.store} — {t('بمرجع', 'reference')}{' '}
            <bdi className="num" dir="ltr">
              {reference}
            </bdi>
          </p>
          <p>
            {t(
              'يُبلَّغ المشتري الآن أن المبلغ خرج إليه، ولا يُلغى التسجيل بعده.',
              'The buyer will be told now that the amount has been sent to them, and the record cannot be undone afterwards.',
            )}
          </p>
        </>
      ),
      confirmLabel: t('سجّل التحويل', 'Record transfer'),
    });
    if (!sure) return;
    void act.run(async () => {
      await api(`/admin/refunds/${r.id}/transfer`, { method: 'POST', body: { reference } });
      refunds.reload();
    }, t('سُجّل الردّ وأُبلغ المشتري بمرجعه.', 'Refund recorded and the buyer notified with its reference.'));
  };

  return (
    <div className="ao-page">
      <AdminHeader
        title={t('التحويلات', 'Transfers')}
        count={counts.incoming !== undefined && !searching ? t(`${counts.incoming} بانتظار التأكيد`, `${counts.incoming} awaiting confirmation`) : undefined}
        hint={t(
          'تحتاج صلاحية payouts.approve — التأكيد ينشئ رصيداً للبائعين، والردّ يُبلغ المشتري بأن ماله خرج.',
          'Requires the payouts.approve permission — confirming creates a balance for the sellers, and a refund tells the buyer their money has been sent.',
        )}
      />
      <Feedback error={act.error} notice={act.notice} />
      <div className="toolbar">
        <Tabs
          value={tab}
          onChange={setTab}
          label={t('نوع التحويل', 'Transfer type')}
          options={TABS.map((x) => ({
            key: x.key,
            label: x.key in counts && counts[x.key as keyof typeof counts] ? `${t(x.label, x.en)} (${counts[x.key as keyof typeof counts]})` : t(x.label, x.en),
          }))}
        />
        <div className="toolbar__end">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={t('رقم الطلب أو اسم المشتري أو المرجع', 'Order number, buyer name, or reference')}
            label={t('بحث في التحويلات', 'Search transfers')}
          />
          <SortButton value={sorts[tab] ?? 'newest'} onChange={(v) => setSorts((s) => ({ ...s, [tab]: v }))} />
        </div>
      </div>

      {tab === 'incoming' ? (
        !incoming.data ? (
          <Loading error={incoming.error} forbidden={incoming.forbidden} onRetry={incoming.reload} />
        ) : incoming.items.length === 0 ? (
          searching ? (
            <Empty icon="search" title={t('لا تحويل ينتظر بهذا البحث', 'No waiting transfer matches this search')} actions={clear} />
          ) : (
            <Empty icon="wallet" title={t('لا تحويلات تنتظر التأكيد', 'No transfers awaiting confirmation')}>
              {t(
                'حين يؤكّد مشترٍ طلبه يظهر هنا بمبلغه ورقمه حتى يصل تحويله أو تنقضي مهلته.',
                'When a buyer confirms their order, it appears here with its amount and number until their transfer arrives or the deadline passes.',
              )}
            </Empty>
          )
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t('تحويلات بانتظار التأكيد', 'Transfers awaiting confirmation')}>
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>{t('الطلب', 'Order')}</th>
                  <th>{t('المشتري', 'Buyer')}</th>
                  <th className="end">{t('المبلغ', 'Amount')}</th>
                  <th>{t('المهلة', 'Deadline')}</th>
                  <th>
                    <span className="visually-hidden">{t('التأكيد', 'Confirmation')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {incoming.items.map((w) => {
                  const d = draft[w.orderNumber] ?? { reference: '', amount: '', note: '' };
                  const received = toMinor(d.amount, w.currency);
                  const mismatch = d.amount.trim() !== '' && received !== w.amountMinorUnits;
                  return (
                    <tr key={w.orderNumber} data-late={w.expired || undefined}>
                      <td>
                        <span className="ao-stack">
                          <span className="num ao-strong">{w.orderNumber}</span>
                          <span className="ao-stack__sub">
                            {when(w.placedAt, locale)} · {w.storeCount === 1 ? t('متجر واحد', '1 shop') : t(`${w.storeCount} متاجر`, `${w.storeCount} shops`)}
                          </span>
                        </span>
                      </td>
                      <td data-label={t('المشتري', 'Buyer')}>
                        <span className="ao-stack">
                          <span>{w.buyer.name ?? '—'}</span>
                          {w.buyer.phone ? (
                            <bdi className="ao-stack__sub num" dir="ltr">
                              {w.buyer.phone}
                            </bdi>
                          ) : null}
                          {w.buyer.email ? <span className="ao-stack__sub">{w.buyer.email}</span> : null}
                        </span>
                      </td>
                      <td data-label={t('المبلغ', 'Amount')} className="end">
                        <span className="money num ao-amount">{money(w.amountMinorUnits, w.currency, locale)}</span>
                      </td>
                      <td data-label={t('المهلة', 'Deadline')}>
                        <span className={`badge ${w.expired ? 'badge--rejected' : 'badge--warning'}`}>{left(w.expiresAt, locale)}</span>
                      </td>
                      <td data-label="">
                        {w.expired ? (
                          <span className="ao-rownote">
                            <Icon name="alert" size={13} />
                            <span>{t('يُلغى خلال دقائق. إن وصل تحويله فردّه له من البنك.', 'It will be canceled within minutes. If their transfer arrives, return it to them from the bank.')}</span>
                          </span>
                        ) : (
                          <form
                            className="ao-transfer-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!received || mismatch) return;
                              void act.run(async () => {
                                await api(`/admin/payments/transfers/${encodeURIComponent(w.orderNumber)}/confirm`, {
                                  method: 'POST',
                                  body: { reference: d.reference, receivedMinorUnits: received, ...(d.note.trim() ? { note: d.note } : {}) },
                                });
                                incoming.reload();
                              }, t(`أُكّد تحويل ${w.orderNumber} — وصل الطلب إلى المتاجر.`, `Transfer for ${w.orderNumber} confirmed — the order has reached the shops.`));
                            }}
                          >
                            <ClearableInput
                              className="field__control"
                              placeholder={t('مرجع التحويل', 'Transfer reference')}
                              dir="ltr"
                              value={d.reference}
                              onChange={(e) => edit(w.orderNumber, { reference: e.target.value })}
                              aria-label={t(`مرجع التحويل للطلب ${w.orderNumber}`, `Transfer reference for order ${w.orderNumber}`)}
                            />
                            <ClearableInput
                              className="field__control num"
                              placeholder={t('المبلغ الواصل', 'Amount received')}
                              dir="ltr"
                              inputMode="decimal"
                              value={d.amount}
                              onChange={(e) => edit(w.orderNumber, { amount: e.target.value })}
                              aria-label={t(`المبلغ الذي وصل للطلب ${w.orderNumber}`, `Amount received for order ${w.orderNumber}`)}
                              aria-invalid={mismatch || undefined}
                            />
                            <ClearableInput
                              className="field__control"
                              placeholder={t('اسم المحوِّل أو حسابه (اختياري)', "Sender's name or account (optional)")}
                              value={d.note}
                              onChange={(e) => edit(w.orderNumber, { note: e.target.value })}
                              aria-label={t(`من حوّل للطلب ${w.orderNumber}`, `Who transferred for order ${w.orderNumber}`)}
                            />
                            <button
                              type="submit"
                              className="btn btn--primary btn--sm"
                              disabled={act.busy || d.reference.trim().length < 3 || !received || mismatch}
                            >
                              <Icon name="check" size={14} />
                              {t('وصل — أكّد', 'Received — confirm')}
                            </button>
                            {mismatch ? (
                              <span className="ao-rownote" role="alert">
                                <Icon name="alert" size={13} />
                                <span>{t('لا يطابق مبلغ الطلب — لا تؤكّد تحويلاً ناقصاً أو لطلب آخر.', 'Does not match the order amount — do not confirm a short transfer or one for another order.')}</span>
                              </span>
                            ) : null}
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      {tab === 'incoming' ? <MoreButton list={incoming} /> : null}

      {tab === 'refunds' ? (
        !refunds.data ? (
          <Loading error={refunds.error} forbidden={refunds.forbidden} onRetry={refunds.reload} />
        ) : refunds.items.length === 0 ? (
          searching ? (
            <Empty icon="search" title={t('لا ردّ ينتظر بهذا البحث', 'No waiting refund matches this search')} actions={clear} />
          ) : (
            <Empty icon="return" title={t('لا ردود تنتظر التحويل', 'No refunds awaiting transfer')}>
              {t(
                'حين يُلغى أو يُرجع شيء من طلب مدفوع بتحويل يظهر هنا مبلغه حتى تحوّله وتسجّل مرجعك.',
                'When something from an order paid by transfer is canceled or returned, its amount appears here until you transfer it and record your reference.',
              )}
            </Empty>
          )
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t('ردود بانتظار التحويل', 'Refunds awaiting transfer')}>
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>{t('الطلب', 'Order')}</th>
                  <th>{t('المشتري — حوّل إليه', 'Buyer — transfer to')}</th>
                  <th className="end">{t('المبلغ', 'Amount')}</th>
                  <th>{t('السبب', 'Reason')}</th>
                  <th>
                    <span className="visually-hidden">{t('التسجيل', 'Record')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {refunds.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="ao-stack">
                        <span className="num ao-strong">{r.subOrderNumber}</span>
                        <span className="ao-stack__sub">
                          {r.store} · {when(r.createdAt, locale)}
                        </span>
                      </span>
                    </td>
                    <td data-label={t('المشتري', 'Buyer')}>
                      <span className="ao-stack">
                        <span>{r.buyer.name ?? '—'}</span>
                        {r.paidWith.note ? (
                          <span className="ao-stack__sub">
                            {t('دفع من:', 'Paid from:')} {r.paidWith.note}
                          </span>
                        ) : null}
                        {r.paidWith.reference ? (
                          <span className="ao-stack__sub">
                            {t('مرجع دفعه', 'Their payment reference')} <bdi className="num" dir="ltr">{r.paidWith.reference}</bdi>
                          </span>
                        ) : null}
                        {r.buyer.phone ? (
                          <bdi className="ao-stack__sub num" dir="ltr">
                            {r.buyer.phone}
                          </bdi>
                        ) : null}
                      </span>
                    </td>
                    <td data-label={t('المبلغ', 'Amount')} className="end">
                      <span className="money num ao-amount">{money(r.amountMinorUnits, r.currency, locale)}</span>
                    </td>
                    <td data-label={t('السبب', 'Reason')} className="wrap">
                      {r.reason}
                    </td>
                    <td data-label="">
                      <div className="ao-actions">
                        <ClearableInput
                          className="field__control ao-ref"
                          placeholder={t('مرجع تحويلك', 'Your transfer reference')}
                          dir="ltr"
                          value={refundRefs[r.id] ?? ''}
                          onChange={(e) => setRefundRefs({ ...refundRefs, [r.id]: e.target.value })}
                          aria-label={t(`مرجع تحويل الردّ ${r.subOrderNumber}`, `Refund transfer reference ${r.subOrderNumber}`)}
                        />
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={act.busy || (refundRefs[r.id]?.trim().length ?? 0) < 3}
                          onClick={() => void recordRefund(r)}
                        >
                          {t('حوّلته — سجّل', 'Transferred — record')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      {tab === 'refunds' ? <MoreButton list={refunds} /> : null}

      {tab === 'confirmed' ? (
        !confirmed.data ? (
          <Loading error={confirmed.error} forbidden={confirmed.forbidden} onRetry={confirmed.reload} />
        ) : confirmed.items.length === 0 ? (
          searching ? (
            <Empty icon="search" title={t('لا تحويل مؤكَّد بهذا البحث', 'No confirmed transfer matches this search')} actions={clear} />
          ) : (
            <Empty icon="check-circle" title={t('لم يُؤكَّد تحويل بعد', 'No transfer confirmed yet')}>
              {t('التحويلات المؤكَّدة تظهر هنا بمرجعها ومن أكّدها، الأحدث أولاً.', 'Confirmed transfers appear here with their reference and who confirmed them, newest first.')}
            </Empty>
          )
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t('تحويلات مؤكَّدة', 'Confirmed transfers')}>
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>{t('الطلب', 'Order')}</th>
                  <th className="end">{t('المبلغ', 'Amount')}</th>
                  <th>{t('المرجع', 'Reference')}</th>
                  <th>{t('أكّده', 'Confirmed by')}</th>
                </tr>
              </thead>
              <tbody>
                {confirmed.items.map((c) => (
                  <tr key={c.orderNumber}>
                    <td>
                      <span className="ao-stack">
                        <span className="num ao-strong">{c.orderNumber}</span>
                        <span className="ao-stack__sub">{c.buyerName ?? '—'}</span>
                      </span>
                    </td>
                    <td data-label={t('المبلغ', 'Amount')} className="end">
                      <span className="money num">{money(c.amountMinorUnits, c.currency, locale)}</span>
                    </td>
                    <td data-label={t('المرجع', 'Reference')}>
                      <span className="ao-stack">
                        <bdi className="num" dir="ltr">
                          {c.reference}
                        </bdi>
                        {c.note ? <span className="ao-stack__sub">{c.note}</span> : null}
                      </span>
                    </td>
                    <td data-label={t('أكّده', 'Confirmed by')}>
                      <span className="ao-stack">
                        <span>{c.confirmedBy ?? '—'}</span>
                        <span className="ao-stack__sub">{when(c.confirmedAt, locale)}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      {tab === 'confirmed' ? <MoreButton list={confirmed} /> : null}

      <p className="ao-foot-note">
        {t('بيانات الحساب التي يراها المشتري ومهلة التحويل من', 'The account details the buyer sees and the transfer deadline are set in')}{' '}
        <Link href="/admin/settings">{t('الإعدادات', 'Settings')}</Link>.
      </p>
    </div>
  );
}
