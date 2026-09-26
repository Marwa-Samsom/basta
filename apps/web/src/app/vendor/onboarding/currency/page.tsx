'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui';
import { Icon } from '@/components/icons';
import { CURRENCIES, formatAmount, useOnboarding, type Onboarding } from '@/lib/vendor';
import { OnboardingError, OnboardingFrame, OnboardingHead, OnboardingLoading } from '../onboarding-chrome';

/**
 * VD-04 — عملة التسوية.
 *
 * قرار لا رجعة فيه (ADR-013)، فالشاشة تعامله كذلك: تحذير صريح، ومثال يتغيّر
 * مع الاختيار بخانات العملة نفسها، وإقرار قبل التفعيل، ثم نافذة تأكيد.
 * لا نجعله سهلاً — نجعله مفهوماً.
 */
export default function CurrencyPage() {
  const router = useRouter();
  const { data, loading, missing, error, set, reload } = useOnboarding();
  const [picked, setPicked] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  /**
   * نافذة التأكيد `<dialog>` أصلية: `showModal` يحبس التركيز داخلها ويغلقها
   * Esc ويعطّل ما خلفها — ثلاثة أشياء لا نعيد كتابتها بأيدينا.
   */
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (confirming && !el.open) el.showModal();
    if (!confirming && el.open) el.close();
  }, [confirming]);

  if (missing) {
    router.replace('/vendor/register');
    return null;
  }
  if (loading && !data) {
    return (
      <OnboardingFrame step={5}>
        <OnboardingLoading />
      </OnboardingFrame>
    );
  }
  if (error || !data) {
    return (
      <OnboardingFrame step={5}>
        <OnboardingError message={error ?? 'تعذّر تحميل حالة المتجر.'} onRetry={() => void reload()} />
      </OnboardingFrame>
    );
  }

  const selected = picked ?? data.settlementCurrency;
  const currency = CURRENCIES.find((c) => c.code === selected) ?? CURRENCIES[0]!;

  if (data.settlementCurrencyLocked) {
    return (
      <OnboardingFrame step={6} status={data.status}>
        <OnboardingHead title="عملة التسوية" />
        <Alert tone="info" title={`عملتك مثبَّتة: ${currency.nameAr}`}>
          تُسعّر منتجاتك بها وتستلم مستحقاتك بها. تغييرها يتطلّب تسوية رصيدك الحالي — راسل الدعم عند الحاجة.
        </Alert>
        <div className="vo-actions">
          <a className="btn btn--primary" href="/vendor/store">
            جهّز ملف المتجر
            <Icon name="next" size={16} mirror />
          </a>
        </div>
      </OnboardingFrame>
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
    <OnboardingFrame step={5} status={data.status}>
      <OnboardingHead
        title="اختر عملة التسوية"
        lead="العملة التي تُسعّر بها منتجاتك وتستلم بها مستحقاتك. يرى المشتري السعر محوَّلاً إلى عملته، وتبقى مستحقاتك بعملتك."
      />

      <div className="vo-callout vo-callout--warning" role="note">
        <Icon name="alert" size={19} />
        <div className="vo-callout__text">
          <p className="vo-callout__title">لا يمكن تغيير العملة بعد أول عملية بيع</p>
          <p className="vo-callout__body">اختر العملة التي تتعامل بها فعلياً مع بنكك.</p>
        </div>
      </div>

      <section aria-labelledby="currency-pick">
        <h2 className="visually-hidden" id="currency-pick">
          اختر عملتك
        </h2>
        <div className="vo-currs">
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              type="button"
              className="vo-cur"
              aria-pressed={selected === c.code}
              onClick={() => setPicked(c.code)}
            >
              <span className="vo-cur__head">
                <span className="vo-cur__dot" aria-hidden />
                <span className="vo-cur__name">{c.nameAr}</span>
              </span>
              <span className="vo-cur__meta">
                <span className="vo-cur__code num">{c.code}</span>
                <span className="vo-cur__symbol">{c.symbol}</span>
                <span className="vo-cur__dec">{c.digits === 3 ? 'ثلاث خانات عشرية' : 'خانتان عشريتان'}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="vo-split vo-split--currency">
        <section className="card vo-example" aria-labelledby="currency-example">
          <h3 className="vo-side-title" id="currency-example">
            مثال حيّ
          </h3>
          {/* «بـ» + اسم العملة يُنتج «بـ دينار كويتي». الاسم يُذكر مرة واحدة
              في صدر الجملة، والباقي إشارة إليه — فتستقيم مع كل عملة. */}
          <div className="vo-example__box">
            <span className="vo-example__row">
              <span className="vo-example__label">سعرٌ تكتبه لمنتجك</span>
              <span className="vo-example__amount money num">
                {formatAmount(79, currency.code)} {currency.symbol}
              </span>
            </span>
            <span className="vo-example__row vo-example__row--total">
              <span className="vo-example__label">مستحقاتك تُحوَّل بعملة</span>
              <span className="vo-example__payout">{currency.nameAr}</span>
            </span>
          </div>
          <p className="vo-example__note">
            يراه المشتري في بلده محوَّلاً إلى عملته، وتبقى مستحقاتك بالعملة نفسها. الخانات العشرية تتبع
            العملة: <span className="num">{currency.code}</span> يُعرض بـ{' '}
            <span className="num">{formatAmount(79, currency.code)}</span>.
          </p>
        </section>

        <section className="card vo-commit" aria-label="التثبيت">
          <label className="vo-ack" htmlFor="ack">
            <input
              id="ack"
              type="checkbox"
              className="vo-ack__input"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span className="vo-ack__box" aria-hidden>
              <Icon name="check" size={14} />
            </span>
            <span>فهمت أن العملة لا تتغيّر بعد أول عملية بيع.</span>
          </label>

          <button
            className="btn btn--primary btn--block"
            type="button"
            disabled={!acknowledged}
            onClick={() => setConfirming(true)}
          >
            ثبّت {currency.nameAr}
            <Icon name="next" size={16} mirror />
          </button>
          <p className="vo-commit__hint">
            {acknowledged ? 'تُسأل مرة واحدة فقط قبل التأكيد.' : 'علّم «فهمت» لتتابع.'}
          </p>
        </section>
      </div>

      <dialog
        ref={dialog}
        className="vo-dialog"
        aria-labelledby="confirm-title"
        onClose={() => setConfirming(false)}
      >
        <div className="vo-dialog__head">
          <h2 className="vo-dialog__title" id="confirm-title">
            تأكيد أخير
          </h2>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label="إغلاق"
            onClick={() => setConfirming(false)}
          >
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="vo-dialog__body">
          <span className="badge badge--money vo-dialog__pill">
            <Icon name="wallet" size={15} />
            {currency.nameAr} · {currency.symbol}
          </span>
          <p>
            سنثبّت <strong>{currency.nameAr}</strong> عملةً لمتجرك. لا يمكن التراجع عن هذا لاحقاً.
          </p>
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
        </div>
        <div className="vo-dialog__foot">
          <button className="btn btn--secondary" type="button" onClick={() => setConfirming(false)}>
            رجوع
          </button>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? <Icon name="spinner" size={16} className="vo-spin" /> : null}
            {busy ? 'جارٍ التثبيت…' : 'نعم، ثبّتها'}
          </button>
        </div>
      </dialog>
    </OnboardingFrame>
  );
}
