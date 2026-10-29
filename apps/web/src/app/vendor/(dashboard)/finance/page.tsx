'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, ClearableInput, EmptyState, Field, PageHead } from '@/components/ui';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { minorUnitDigits } from '@/lib/money';
import { money, when } from '@/lib/orders';

interface WalletView {
  currency: string;
  pendingMinorUnits: string;
  availableMinorUnits: string;
  withdrawnMinorUnits: string;
  nextReleaseAt: string | null;
  canWithdraw: boolean;
  /** حدّ السحب الأدنى بعملة المحفظة — ما تحته يتراكم حتى يتجاوزه */
  minPayoutMinorUnits: string;
}

interface Payout {
  id: string;
  currency: string;
  amountMinorUnits: string;
  status: string;
  requestedAt: string;
  paidAt: string | null;
  transferReference: string | null;
  rejectReason: string | null;
  bank: { bankName: string; ibanLast4: string };
}

const PAYOUT_STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: 'بانتظار المراجعة', tone: 'badge--warning' },
  approved: { label: 'موافَق — قيد التحويل', tone: 'badge--warning' },
  processing: { label: 'قيد التحويل', tone: 'badge--warning' },
  paid: { label: 'حُوِّل', tone: 'badge--approved' },
  rejected: { label: 'مرفوض', tone: 'badge--rejected' },
};

/**
 * خطوات السحب الجاري — VD-18. تُرسم للطلب الذي لم يُحسم بعد وحده: المحوَّل
 * والمرفوض تكفيهما الشارة والملاحظة. والخطوة الأخيرة «تمّ التحويل» لا «حُوِّل»
 * كي لا تتكرّر كلمة الشارة في الصفحة.
 */
const STEPS: { key: string; label: string }[] = [
  { key: 'requested', label: 'طُلب' },
  { key: 'approved', label: 'وُوفق' },
  { key: 'processing', label: 'قيد التحويل' },
  { key: 'paid', label: 'تمّ التحويل' },
];

/** «12.5» ← 12500 بخانات العملة، بلا عدد عشري في الطريق (ADR-001) */
function toMinor(input: string, currency: string): string | null {
  const digits = minorUnitDigits(currency);
  const m = input.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).match(/^(\d+)(?:[.,](\d+))?$/);
  if (!m) return null;
  const frac = (m[2] ?? '').slice(0, digits).padEnd(digits, '0');
  if ((m[2] ?? '').length > digits) return null;
  const v = BigInt(m[1]!) * 10n ** BigInt(digits) + BigInt(frac || '0');
  return v > 0n ? v.toString() : null;
}

/**
 * VD-18 المحفظة · VD-20 طلب السحب · VD-21 سجل السحوبات.
 *
 * ثلاثة جيوب لكل عملة، ولا تُجمع عملتان في رقم واحد (ADR-013). «المعلّق»
 * ليس مالاً ضائعاً: يُحرَّر بعد فترة الإرجاع من التسليم، وأقرب موعد ظاهر.
 */
export default function FinancePage() {
  const [wallets, setWallets] = useState<WalletView[] | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [w, p] = await Promise.all([api<WalletView[]>('/vendor/finance/wallets'), api<Payout[]>('/vendor/finance/payouts')]);
        if (alive) {
          setWallets(w);
          setPayouts(p);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [version]);

  const withdraw = async (w: WalletView) => {
    const minor = toMinor(amount[w.currency] ?? '', w.currency);
    if (!minor) {
      setError('اكتب مبلغاً صحيحاً.');
      return;
    }
    setBusy(true);
    try {
      await api('/vendor/finance/payouts', { method: 'POST', body: { currency: w.currency, amountMinorUnits: minor } });
      // «ر.س.» و«د.أ.» تنتهيان بنقطتهما (وبعدها علامة اتجاه): نقطة الجملة بعدها كانت «ر.س..» (VOPS-079)
      const asked = money(minor, w.currency);
      const stop = /\.[\u200e\u200f\u061c]*$/.test(asked) ? '' : '.';
      setNotice(`أُرسل طلب سحب ${asked}${stop} يُخصم من المتاح الآن، ويعود إليه إن رُفض.`);
      setError(null);
      setAmount({ ...amount, [w.currency]: '' });
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!wallets) {
    return error ? (
      <div className="vm-page">
        <PageHead title="المحفظة" />
        <div className="empty">
          <span className="empty__icon vm-error-icon" aria-hidden>
            <Icon name="alert" size={26} />
          </span>
          <p className="empty__title">تعذّر فتح المحفظة</p>
          <Alert tone="danger">{error}</Alert>
        </div>
      </div>
    ) : (
      <div className="vm-loading vm-loading--page" role="status">
        <span className="visually-hidden">جارٍ فتح المحفظة…</span>
        <span className="skeleton vm-loading__title" />
        <span className="skeleton vm-loading__block" />
        <span className="skeleton vm-loading__panel" />
      </div>
    );
  }

  const multi = wallets.length > 1;
  const withdrawable = wallets.filter((w) => BigInt(w.availableMinorUnits) >= 0n && w.canWithdraw);

  return (
    <div className="vm-page">
      <PageHead
        title="المحفظة"
        meta={wallets.length ? `عملة التسوية: ${wallets.map((w) => w.currency).join(' · ')}` : undefined}
        actions={
          <Link href="/vendor/finance/statement" className="btn btn--secondary btn--sm">
            <Icon name="file" size={15} />
            كشف الحساب
          </Link>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {wallets.length === 0 ? (
        <EmptyState icon="wallet" title="لا رصيد بعد">
          أول طلب مدفوع يفتح محفظتك بعملة متجرك، وتظهر أرباحك هنا بعد أول بيع.
        </EmptyState>
      ) : null}

      {wallets.map((w) => {
        const negative = BigInt(w.availableMinorUnits) < 0n;
        return (
          <section key={w.currency} className="vm-wallet" aria-label={`محفظة ${w.currency}`}>
            {multi ? <h2 className="vm-wallet__title">محفظة {w.currency}</h2> : null}

            {negative ? (
              <div className="vm-neg" role="status">
                <span className="vm-neg__icon" aria-hidden>
                  <Icon name="alert" size={18} />
                </span>
                <div className="vm-neg__text">
                  <p className="vm-neg__title">رصيدك المتاح سالب بسبب ردّ مبلغ بعد التحرير</p>
                  <p className="vm-neg__body">
                    استردّ مشترٍ مبلغاً بعد تحرير رصيد طلبه. يُغطّى تلقائياً من مبيعاتك القادمة، والسحب موقوف حتى ذلك.
                    التفاصيل في <Link href="/vendor/finance/statement">كشف الحساب</Link>.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="vm-balances">
              <div className="stat stat--money">
                <span className="stat__label">
                  <Icon name="clock" size={15} />
                  قيد التحرير
                </span>
                <span className="stat__value money">{money(w.pendingMinorUnits, w.currency)}</span>
                <span className="stat__note">{w.nextReleaseAt ? `أقرب تحرير ${when(w.nextReleaseAt)}` : 'يُحرَّر بعد فترة الإرجاع من التسليم'}</span>
              </div>
              <div className="stat stat--money vm-balances__main">
                <span className="stat__label">
                  <Icon name="wallet" size={15} />
                  متاح للسحب
                </span>
                <span className="stat__value money vm-big">{money(w.availableMinorUnits, w.currency)}</span>
                <span className="stat__note">{negative ? 'سالب بسبب استرداد بعد التحرير' : 'جاهز للتحويل'}</span>
              </div>
              <div className="stat stat--money">
                <span className="stat__label">
                  <Icon name="check-circle" size={15} />
                  مسحوب
                </span>
                <span className="stat__value money">{money(w.withdrawnMinorUnits, w.currency)}</span>
                <span className="stat__note">مجموع السحوبات</span>
              </div>
            </div>
          </section>
        );
      })}

      {wallets.length > 0 ? (
        <div className={`vm-split${withdrawable.length ? '' : ' vm-split--single'}`}>
          {withdrawable.length ? (
            <div className="vm-split__col">
              {withdrawable.map((w) => {
                const digits = minorUnitDigits(w.currency);
                // الحدّ الأدنى ظاهر قبل الطلب: المتاح تحته لا يُطلب، والمكتوب تحته يُقال بجانبه
                const minimum = BigInt(w.minPayoutMinorUnits);
                const asked = toMinor(amount[w.currency] ?? '', w.currency);
                const short = BigInt(w.availableMinorUnits) < minimum;
                const below = asked !== null && BigInt(asked) < minimum;
                return (
                  <section key={w.currency} className="card vm-withdraw">
                    <h2 className="vm-card-title">طلب سحب{multi ? ` — ${w.currency}` : ''}</h2>
                    <div className="vm-withdraw__avail">
                      <span className="vm-withdraw__avail-label">المتاح الآن</span>
                      <span className="money num vm-withdraw__avail-value">{money(w.availableMinorUnits, w.currency)}</span>
                    </div>
                    <Field
                      label={`المبلغ المطلوب (${w.currency})`}
                      hint={`الحد الأدنى للسحب ${money(w.minPayoutMinorUnits, w.currency)}`}
                      error={below ? `أقل من الحد الأدنى للسحب ${money(w.minPayoutMinorUnits, w.currency)}` : null}
                    >
                      {(props) => (
                        <span className="vm-amount">
                          <ClearableInput
                            {...props}
                            className="vm-amount__input"
                            inputMode="decimal"
                            dir="ltr"
                            placeholder={(0).toFixed(digits)}
                            value={amount[w.currency] ?? ''}
                            onChange={(e) => setAmount({ ...amount, [w.currency]: e.target.value })}
                          />
                          <span className="vm-amount__unit num" aria-hidden>
                            {w.currency}
                          </span>
                          <button
                            type="button"
                            className="vm-amount__all"
                            onClick={() =>
                              setAmount({
                                ...amount,
                                [w.currency]: (Number(w.availableMinorUnits) / 10 ** digits).toFixed(digits),
                              })
                            }
                          >
                            الكل
                          </button>
                        </span>
                      )}
                    </Field>
                    {short ? (
                      <p className="vm-hint" role="status">
                        متاحك أقل من الحد الأدنى للسحب. يتراكم حتى يتجاوزه، ولا يضيع منه شيء.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--primary btn--block vm-withdraw__submit"
                      disabled={busy || short || below}
                      onClick={() => void withdraw(w)}
                    >
                      اطلب السحب
                    </button>
                    <p className="vm-hint">تُراجع الإدارة الطلب ثم يُحوَّل إلى حسابك البنكي. يُخصم المبلغ من المتاح فور الطلب، ويعود إليه إن رُفض.</p>
                  </section>
                );
              })}
            </div>
          ) : null}

          <section className="card card--flush">
            <header className="card__head">
              <h2>سجلّ السحوبات</h2>
              {payouts.length ? <span className="num vm-count">{payouts.length}</span> : null}
            </header>
            {payouts.length === 0 ? (
              <p className="vm-list-empty">لا سحوبات بعد. طلبات السحب تظهر هنا بحالتها ومرجع تحويلها.</p>
            ) : (
              <ul className="vm-payouts">
                {payouts.map((p) => {
                  const st = PAYOUT_STATUS[p.status];
                  const step = STEPS.findIndex((s) => s.key === p.status);
                  const inFlight = p.status === 'requested' || p.status === 'approved' || p.status === 'processing';
                  return (
                    <li key={p.id} className="vm-payout">
                      <div className="vm-payout__top">
                        <span className="money num vm-payout__amount">{money(p.amountMinorUnits, p.currency)}</span>
                        <span className={`badge ${st?.tone ?? ''}`}>{st?.label ?? p.status}</span>
                        <span className="vm-payout__date">{when(p.requestedAt)}</span>
                      </div>
                      <span className="vm-payout__bank">
                        إلى {p.bank.bankName} <span className="num">••{p.bank.ibanLast4}</span>
                      </span>
                      {inFlight ? (
                        <ol className="vm-steps" aria-label="مراحل السحب">
                          {STEPS.map((s, i) => (
                            <li key={s.key} className="vm-step" data-done={i <= step}>
                              <span className="vm-step__dot" aria-hidden>
                                <Icon name={i <= step ? 'check' : 'minus'} size={11} />
                              </span>
                              <span className="vm-step__label">{s.label}</span>
                              {i < STEPS.length - 1 ? <span className="vm-step__line" data-done={i < step} aria-hidden /> : null}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {p.rejectReason ? (
                        <p className="vm-payout__note vm-payout__note--danger">
                          <Icon name="alert" size={13} />
                          <span>«{p.rejectReason}»</span>
                        </p>
                      ) : null}
                      {p.transferReference ? (
                        <p className="vm-payout__note">
                          <Icon name="info" size={13} />
                          <span>
                            مرجع التحويل <span className="num">{p.transferReference}</span>
                          </span>
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
