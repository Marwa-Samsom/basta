'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminHeader, Empty, Feedback, Loading, Tabs } from '@/components/admin';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { useAction, useAdminData } from '@/lib/admin';
import { minorUnitDigits } from '@/lib/money';
import { money, when } from '@/lib/orders';

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
  { key: 'incoming', label: 'واردة — بانتظار التأكيد' },
  { key: 'refunds', label: 'ردود — للتحويل' },
  { key: 'confirmed', label: 'أُكّدت مؤخراً' },
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
function left(expiresAt: string | null): string {
  if (!expiresAt) return '—';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'انتهت المهلة';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `بقي ${Math.floor(h / 24)} يوم و${h % 24} ساعة`;
  if (h >= 1) return `بقيت ${h} ساعة`;
  return `بقيت ${Math.max(1, Math.floor(ms / 60_000))} دقيقة`;
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
  const [tab, setTab] = useState('incoming');
  const incoming = useAdminData<{ waiting: Waiting[]; confirmed: Confirmed[] }>('/admin/payments/transfers');
  const refunds = useAdminData<{ items: RefundRow[] }>('/admin/refunds/awaiting-transfer');
  const act = useAction();
  const [draft, setDraft] = useState<Record<string, { reference: string; amount: string; note: string }>>({});
  const [refundRefs, setRefundRefs] = useState<Record<string, string>>({});

  const counts = {
    incoming: incoming.data?.waiting.length,
    refunds: refunds.data?.items.length,
  };

  const edit = (n: string, patch: Partial<{ reference: string; amount: string; note: string }>) =>
    setDraft((d) => ({ ...d, [n]: { reference: '', amount: '', note: '', ...d[n], ...patch } }));

  return (
    <div className="ao-page">
      <AdminHeader
        title="التحويلات"
        count={counts.incoming !== undefined ? `${counts.incoming} بانتظار التأكيد` : undefined}
        hint="تحتاج صلاحية payouts.approve — التأكيد ينشئ رصيداً للبائعين، والردّ يُبلغ المشتري بأن ماله خرج."
      />
      <Feedback error={act.error} notice={act.notice} />
      <Tabs
        value={tab}
        onChange={setTab}
        label="نوع التحويل"
        options={TABS.map((t) => ({
          key: t.key,
          label: t.key in counts && counts[t.key as keyof typeof counts] ? `${t.label} (${counts[t.key as keyof typeof counts]})` : t.label,
        }))}
      />

      {tab === 'incoming' ? (
        !incoming.data ? (
          <Loading error={incoming.error} forbidden={incoming.forbidden} onRetry={incoming.reload} />
        ) : incoming.data.waiting.length === 0 ? (
          <Empty icon="wallet" title="لا تحويلات تنتظر التأكيد">
            حين يؤكّد مشترٍ طلبه يظهر هنا بمبلغه ورقمه حتى يصل تحويله أو تنقضي مهلته.
          </Empty>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="تحويلات بانتظار التأكيد">
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>المشتري</th>
                  <th className="end">المبلغ</th>
                  <th>المهلة</th>
                  <th>
                    <span className="visually-hidden">التأكيد</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {incoming.data.waiting.map((w) => {
                  const d = draft[w.orderNumber] ?? { reference: '', amount: '', note: '' };
                  const received = toMinor(d.amount, w.currency);
                  const mismatch = d.amount.trim() !== '' && received !== w.amountMinorUnits;
                  return (
                    <tr key={w.orderNumber} data-late={w.expired || undefined}>
                      <td>
                        <span className="ao-stack">
                          <span className="num ao-strong">{w.orderNumber}</span>
                          <span className="ao-stack__sub">
                            {when(w.placedAt)} · {w.storeCount === 1 ? 'متجر واحد' : `${w.storeCount} متاجر`}
                          </span>
                        </span>
                      </td>
                      <td data-label="المشتري">
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
                      <td data-label="المبلغ" className="end">
                        <span className="money num ao-amount">{money(w.amountMinorUnits, w.currency)}</span>
                      </td>
                      <td data-label="المهلة">
                        <span className={`badge ${w.expired ? 'badge--rejected' : 'badge--warning'}`}>{left(w.expiresAt)}</span>
                      </td>
                      <td data-label="">
                        {w.expired ? (
                          <span className="ao-rownote">
                            <Icon name="alert" size={13} />
                            <span>يُلغى خلال دقائق. إن وصل تحويله فردّه له من البنك.</span>
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
                              }, `أُكّد تحويل ${w.orderNumber} — وصل الطلب إلى المتاجر.`);
                            }}
                          >
                            <input
                              className="field__control"
                              placeholder="مرجع التحويل"
                              dir="ltr"
                              value={d.reference}
                              onChange={(e) => edit(w.orderNumber, { reference: e.target.value })}
                              aria-label={`مرجع التحويل للطلب ${w.orderNumber}`}
                            />
                            <input
                              className="field__control num"
                              placeholder="المبلغ الواصل"
                              dir="ltr"
                              inputMode="decimal"
                              value={d.amount}
                              onChange={(e) => edit(w.orderNumber, { amount: e.target.value })}
                              aria-label={`المبلغ الذي وصل للطلب ${w.orderNumber}`}
                              aria-invalid={mismatch || undefined}
                            />
                            <input
                              className="field__control"
                              placeholder="اسم المحوِّل أو حسابه (اختياري)"
                              value={d.note}
                              onChange={(e) => edit(w.orderNumber, { note: e.target.value })}
                              aria-label={`من حوّل للطلب ${w.orderNumber}`}
                            />
                            <button
                              type="submit"
                              className="btn btn--primary btn--sm"
                              disabled={act.busy || d.reference.trim().length < 3 || !received || mismatch}
                            >
                              <Icon name="check" size={14} />
                              وصل — أكّد
                            </button>
                            {mismatch ? (
                              <span className="ao-rownote" role="alert">
                                <Icon name="alert" size={13} />
                                <span>لا يطابق مبلغ الطلب — لا تؤكّد تحويلاً ناقصاً أو لطلب آخر.</span>
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

      {tab === 'refunds' ? (
        !refunds.data ? (
          <Loading error={refunds.error} forbidden={refunds.forbidden} onRetry={refunds.reload} />
        ) : refunds.data.items.length === 0 ? (
          <Empty icon="return" title="لا ردود تنتظر التحويل">
            حين يُلغى أو يُرجع شيء من طلب مدفوع بتحويل يظهر هنا مبلغه حتى تحوّله وتسجّل مرجعك.
          </Empty>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="ردود بانتظار التحويل">
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>المشتري — حوّل إليه</th>
                  <th className="end">المبلغ</th>
                  <th>السبب</th>
                  <th>
                    <span className="visually-hidden">التسجيل</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {refunds.data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="ao-stack">
                        <span className="num ao-strong">{r.subOrderNumber}</span>
                        <span className="ao-stack__sub">
                          {r.store} · {when(r.createdAt)}
                        </span>
                      </span>
                    </td>
                    <td data-label="المشتري">
                      <span className="ao-stack">
                        <span>{r.buyer.name ?? '—'}</span>
                        {r.paidWith.note ? <span className="ao-stack__sub">دفع من: {r.paidWith.note}</span> : null}
                        {r.paidWith.reference ? (
                          <span className="ao-stack__sub">
                            مرجع دفعه <bdi className="num" dir="ltr">{r.paidWith.reference}</bdi>
                          </span>
                        ) : null}
                        {r.buyer.phone ? (
                          <bdi className="ao-stack__sub num" dir="ltr">
                            {r.buyer.phone}
                          </bdi>
                        ) : null}
                      </span>
                    </td>
                    <td data-label="المبلغ" className="end">
                      <span className="money num ao-amount">{money(r.amountMinorUnits, r.currency)}</span>
                    </td>
                    <td data-label="السبب" className="wrap">
                      {r.reason}
                    </td>
                    <td data-label="">
                      <div className="ao-actions">
                        <input
                          className="field__control ao-ref"
                          placeholder="مرجع تحويلك"
                          dir="ltr"
                          value={refundRefs[r.id] ?? ''}
                          onChange={(e) => setRefundRefs({ ...refundRefs, [r.id]: e.target.value })}
                          aria-label={`مرجع تحويل الردّ ${r.subOrderNumber}`}
                        />
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={act.busy || (refundRefs[r.id]?.trim().length ?? 0) < 3}
                          onClick={() =>
                            void act.run(async () => {
                              await api(`/admin/refunds/${r.id}/transfer`, { method: 'POST', body: { reference: refundRefs[r.id] } });
                              refunds.reload();
                            }, 'سُجّل الردّ وأُبلغ المشتري بمرجعه.')
                          }
                        >
                          حوّلته — سجّل
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

      {tab === 'confirmed' ? (
        !incoming.data ? (
          <Loading error={incoming.error} forbidden={incoming.forbidden} onRetry={incoming.reload} />
        ) : incoming.data.confirmed.length === 0 ? (
          <Empty icon="check-circle" title="لم يُؤكَّد تحويل بعد">
            آخر عشرين تحويلاً مؤكَّداً تظهر هنا بمرجعها ومن أكّدها.
          </Empty>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="تحويلات مؤكَّدة">
            <table className="table ao-table">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th className="end">المبلغ</th>
                  <th>المرجع</th>
                  <th>أكّده</th>
                </tr>
              </thead>
              <tbody>
                {incoming.data.confirmed.map((c) => (
                  <tr key={c.orderNumber}>
                    <td>
                      <span className="ao-stack">
                        <span className="num ao-strong">{c.orderNumber}</span>
                        <span className="ao-stack__sub">{c.buyerName ?? '—'}</span>
                      </span>
                    </td>
                    <td data-label="المبلغ" className="end">
                      <span className="money num">{money(c.amountMinorUnits, c.currency)}</span>
                    </td>
                    <td data-label="المرجع">
                      <span className="ao-stack">
                        <bdi className="num" dir="ltr">
                          {c.reference}
                        </bdi>
                        {c.note ? <span className="ao-stack__sub">{c.note}</span> : null}
                      </span>
                    </td>
                    <td data-label="أكّده">
                      <span className="ao-stack">
                        <span>{c.confirmedBy ?? '—'}</span>
                        <span className="ao-stack__sub">{when(c.confirmedAt)}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      <p className="ao-foot-note">
        بيانات الحساب التي يراها المشتري ومهلة التحويل من <Link href="/admin/settings">الإعدادات</Link>.
      </p>
    </div>
  );
}
