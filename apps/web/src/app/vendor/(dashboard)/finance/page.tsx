'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Card, Spinner, TextInput } from '@/components/ui';
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
  approved: { label: 'موافَق — قيد التحويل', tone: 'badge--review' },
  processing: { label: 'قيد التحويل', tone: 'badge--review' },
  paid: { label: 'حُوِّل', tone: 'badge--approved' },
  rejected: { label: 'مرفوض', tone: 'badge--rejected' },
};

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
      setNotice(`أُرسل طلب سحب ${money(minor, w.currency)}. يُخصم من المتاح الآن، ويعود إليه إن رُفض.`);
      setError(null);
      setAmount({ ...amount, [w.currency]: '' });
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!wallets) return error ? <Alert tone="danger">{error}</Alert> : <Spinner label="جارٍ فتح المحفظة…" />;

  return (
    <div className="stack stack--loose">
      <header className="row row--between">
        <h1>المحفظة</h1>
        <Link href="/vendor/finance/statement" className="btn btn--secondary btn--sm">
          كشف الحساب
        </Link>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {wallets.length === 0 ? (
        <Card>
          <p className="empty muted">لا رصيد بعد. أول طلب مدفوع يفتح محفظتك بعملة متجرك.</p>
        </Card>
      ) : null}

      {wallets.map((w) => {
        const negative = BigInt(w.availableMinorUnits) < 0n;
        return (
          <Card key={w.currency} title={`محفظة ${w.currency}`}>
            <div className="stack">
              <div className="stats">
                <div className="stat">
                  <span className="stat__label">معلّق</span>
                  <span className="stat__value money">{money(w.pendingMinorUnits, w.currency)}</span>
                  <span className="stat__note">{w.nextReleaseAt ? `أقرب تحرير ${when(w.nextReleaseAt)}` : 'يُحرَّر بعد فترة الإرجاع'}</span>
                </div>
                <div className="stat">
                  <span className="stat__label">متاح للسحب</span>
                  <span className="stat__value money">{money(w.availableMinorUnits, w.currency)}</span>
                  <span className="stat__note">{negative ? 'سالب بسبب استرداد بعد التحرير' : 'جاهز للتحويل'}</span>
                </div>
                <div className="stat">
                  <span className="stat__label">مسحوب</span>
                  <span className="stat__value money">{money(w.withdrawnMinorUnits, w.currency)}</span>
                  <span className="stat__note">مجموع السحوبات</span>
                </div>
              </div>

              {negative ? (
                <Alert tone="warning">
                  رصيدك المتاح سالب لأن مشترياً استرد مبلغاً بعد تحرير رصيد طلبه. يُغطّى تلقائياً من مبيعاتك القادمة، والسحب
                  موقوف حتى ذلك. التفاصيل في كشف الحساب.
                </Alert>
              ) : w.canWithdraw ? (
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <TextInput
                    label={`مبلغ السحب (${w.currency})`}
                    inputMode="decimal"
                    dir="ltr"
                    value={amount[w.currency] ?? ''}
                    onChange={(e) => setAmount({ ...amount, [w.currency]: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setAmount({
                        ...amount,
                        [w.currency]: (Number(w.availableMinorUnits) / 10 ** minorUnitDigits(w.currency)).toFixed(minorUnitDigits(w.currency)),
                      })
                    }
                  >
                    الكل
                  </button>
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void withdraw(w)}>
                    اطلب السحب
                  </button>
                </div>
              ) : null}
            </div>
          </Card>
        );
      })}

      <Card title="السحوبات">
        {payouts.length === 0 ? (
          <p className="empty muted">لا سحوبات بعد.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>إلى</th>
                  <th>الحالة</th>
                  <th>المرجع</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="small">{when(p.requestedAt)}</td>
                    <td className="money">{money(p.amountMinorUnits, p.currency)}</td>
                    <td className="small">
                      {p.bank.bankName} ••{p.bank.ibanLast4}
                    </td>
                    <td>
                      <span className={`badge ${PAYOUT_STATUS[p.status]?.tone ?? ''}`}>{PAYOUT_STATUS[p.status]?.label ?? p.status}</span>
                      {p.rejectReason ? <div className="small muted">«{p.rejectReason}»</div> : null}
                    </td>
                    <td className="num small">{p.transferReference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
