'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Card, Spinner } from '@/components/ui';
import { CURRENCIES, formatAmount, useOnboarding, type Onboarding } from '@/lib/vendor';

/**
 * VD-04 — عملة التسوية.
 *
 * قرار لا رجعة فيه (ADR-013)، فالشاشة تعامله كذلك: تحذير صريح، ومثال يتغيّر
 * مع الاختيار بخانات العملة نفسها، وإقرار قبل التفعيل، ثم نافذة تأكيد.
 * لا نجعله سهلاً — نجعله مفهوماً.
 */
export default function CurrencyPage() {
  const router = useRouter();
  const { data, loading, missing, error, set } = useOnboarding();
  const [picked, setPicked] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (missing) {
    router.replace('/vendor/register');
    return null;
  }
  if (loading && !data) {
    return (
      <main className="shell">
        <Spinner />
      </main>
    );
  }
  if (error || !data) {
    return (
      <main className="shell">
        <Alert tone="danger">{error ?? 'تعذّر تحميل حالة المتجر.'}</Alert>
      </main>
    );
  }

  const selected = picked ?? data.settlementCurrency;
  const currency = CURRENCIES.find((c) => c.code === selected) ?? CURRENCIES[0]!;

  if (data.settlementCurrencyLocked) {
    return (
      <main className="shell">
        <h1>عملة التسوية</h1>
        <Alert tone="info" title={`عملتك مثبَّتة: ${currency.nameAr}`}>
          تُسعّر منتجاتك بها وتستلم مستحقاتك بها. تغييرها يتطلّب تسوية رصيدك الحالي — راسل الدعم عند الحاجة.
        </Alert>
        <a className="btn btn--primary" href="/vendor/store">
          جهّز ملف المتجر
        </a>
      </main>
    );
  }

  async function confirm(): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      const next = await api<Onboarding>('/vendor/onboarding/settlement-currency', {
        method: 'PUT',
        body: { currency: selected, lock: true },
      });
      set(next);
      setConfirming(false);
      router.push('/vendor/store');
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'تعذّر تثبيت العملة.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="stack stack--tight">
        <h1>عملة التسوية</h1>
        <p className="muted">العملة التي تُسعّر بها منتجاتك وتستلم بها مستحقاتك.</p>
      </header>

      <Alert tone="warning" title="لا يمكن تغيير العملة بعد أول عملية بيع">
        اختر العملة التي تتعامل بها فعلياً مع بنكك.
      </Alert>

      <Card title="اختر عملتك">
        <div className="stack">
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              type="button"
              className="choice"
              aria-pressed={selected === c.code}
              onClick={() => setPicked(c.code)}
            >
              <span className="grow stack stack--tight">
                <span className="choice__title">
                  {c.nameAr} <span className="num">{c.code}</span>
                </span>
                <span className="small muted">
                  الرمز {c.symbol} · {c.digits === 3 ? 'ثلاث خانات عشرية' : 'خانتان عشريتان'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="مثال حيّ">
        {/* «بـ» + اسم العملة يُنتج «بـ دينار كويتي». الاسم يُذكر مرة واحدة
            في صدر الجملة، والباقي إشارة إليه — فتستقيم مع كل عملة. */}
        <p>
          سعرٌ تكتبه <span className="money num">{formatAmount(79, currency.code)}</span>{' '}
          {currency.nameAr} يراه المشتري في بلده محوَّلاً إلى عملته، وتبقى مستحقاتك بالعملة نفسها.
        </p>
        <p className="small muted">
          الخانات العشرية تتبع العملة: {currency.code} يُعرض بـ{' '}
          <span className="num">{formatAmount(79, currency.code)}</span>.
        </p>
      </Card>

      <label className="choice" htmlFor="ack">
        <input
          id="ack"
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span className="grow">
          <span className="choice__title">فهمت أن العملة لا تتغيّر بعد أول عملية بيع.</span>
        </span>
      </label>

      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      <button
        className="btn btn--primary btn--block"
        type="button"
        disabled={!acknowledged}
        onClick={() => setConfirming(true)}
      >
        ثبّت {currency.nameAr}
      </button>

      {confirming ? (
        <Card title="تأكيد أخير">
          <p>
            سنثبّت <strong>{currency.nameAr}</strong> عملةً لمتجرك. لا يمكن التراجع عن هذا لاحقاً.
          </p>
          <div className="row">
            <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'جارٍ التثبيت…' : 'نعم، ثبّتها'}
            </button>
            <button className="btn btn--secondary" type="button" onClick={() => setConfirming(false)}>
              رجوع
            </button>
          </div>
        </Card>
      ) : null}
    </main>
  );
}
