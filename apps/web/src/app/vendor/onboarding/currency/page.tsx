'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui';
import { Icon } from '@/components/icons';
import { CURRENCIES, formatAmount, useOnboarding, type Onboarding } from '@/lib/vendor';
import { OnboardingError, OnboardingFrame, OnboardingHead, OnboardingLoading } from '../onboarding-chrome';

/**
 * VD-04 — عملة التسوية، الخطوة الثالثة: بعد بيانات المتجر وقبل المستندات.
 *
 * الاعتماد يثبّتها ولا تتغيّر بعده (ADR-013)، فالشاشة تعاملها كقرار: تحذير صريح،
 * ومثال يتغيّر مع الاختيار بخانات العملة نفسها، وإقرار، ثم نافذة تأكيد. لا نجعله
 * سهلاً — نجعله مفهوماً. الاختيار يبقى قابلاً للتغيير حتى الإرسال، والخادم يمنع
 * الإرسال بلا اختيار صريح: المقترحة من البلد اقتراح لا اختيار.
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
      <OnboardingFrame step={3}>
        <OnboardingLoading />
      </OnboardingFrame>
    );
  }
  if (error || !data) {
    return (
      <OnboardingFrame step={3}>
        <OnboardingError message={error ?? 'تعذّر تحميل حالة المتجر.'} onRetry={() => void reload()} />
      </OnboardingFrame>
    );
  }

  const selected = picked ?? data.settlementCurrency;
  const currency = CURRENCIES.find((c) => c.code === selected) ?? CURRENCIES[0]!;

  if (data.settlementCurrencyLocked) {
    // أُرسل الطلب أو اعتُمد: العملة لا تتغيّر من هنا — والوجهة التالية بحسب الحال
    const reviewing = data.status === 'in_review';
    const onward = reviewing
      ? { href: '/vendor/onboarding/status', label: 'تابع حالة طلبك' }
      : data.status === 'approved' || data.status === 'suspended'
        ? { href: '/vendor/store', label: 'جهّز ملف المتجر' }
        : { href: '/vendor/onboarding/documents', label: 'المستندات' };
    return (
      <OnboardingFrame step={reviewing ? 5 : 6} status={data.status}>
        <OnboardingHead title="عملة التسوية" />
        <Alert tone="info" title={`عملتك: ${currency.nameAr}`}>
          {reviewing
            ? 'طلبك قيد المراجعة، والعملة لا تتغيّر أثناءها. يثبّتها اعتماد متجرك.'
            : 'تُسعّر منتجاتك بها وتستلم مستحقاتك بها. تغييرها يتطلّب تسوية رصيدك الحالي — راسل الدعم عند الحاجة.'}
        </Alert>
        <div className="vo-actions">
          <Link className="btn btn--primary" href={onward.href}>
            {onward.label}
            <Icon name="next" size={16} mirror />
          </Link>
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
        // اختيار لا تثبيت: يتغيّر حتى الإرسال، والاعتماد يثبّته
        body: { currency: selected },
      });
      set(next);
      setConfirming(false);
      router.push('/vendor/onboarding/documents');
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'تعذّر حفظ العملة.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingFrame step={3} status={data.status}>
      <OnboardingHead
        title="اختر عملة التسوية"
        lead="العملة التي تُسعّر بها منتجاتك وتستلم بها مستحقاتك. يرى المشتري السعر محوَّلاً إلى عملته، وتبقى مستحقاتك بعملتك."
      />

      <div className="vo-callout vo-callout--warning" role="note">
        <Icon name="alert" size={19} />
        <div className="vo-callout__text">
          <p className="vo-callout__title">تُثبَّت العملة عند اعتماد متجرك — ولا تتغيّر بعده</p>
          <p className="vo-callout__body">
            اختر العملة التي تتعامل بها فعلياً مع بنكك. تستطيع تغييرها حتى ترسل طلبك للمراجعة، ما لم تسعّر بها منتجاً أو شحناً.
          </p>
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
            <span>فهمت أن العملة تُثبَّت عند اعتماد متجري ولا تتغيّر بعده.</span>
          </label>

          <button
            className="btn btn--primary btn--block"
            type="button"
            disabled={!acknowledged}
            onClick={() => setConfirming(true)}
          >
            اختر {currency.nameAr}
            <Icon name="next" size={16} mirror />
          </button>
          <p className="vo-commit__hint">
            {data.settlementCurrencyChosen
              ? `اخترت ${CURRENCIES.find((c) => c.code === data.settlementCurrency)?.nameAr ?? data.settlementCurrency} من قبل — تستطيع تغييرها حتى ترسل طلبك.`
              : acknowledged
                ? 'تُسأل مرة واحدة فقط قبل التأكيد.'
                : 'علّم «فهمت» لتتابع.'}
          </p>
          <Link className="btn btn--secondary btn--block" href="/vendor/register">
            <Icon name="back" size={16} mirror />
            رجوع إلى بيانات المتجر
          </Link>
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
            ستكون <strong>{currency.nameAr}</strong> عملة متجرك. تستطيع تغييرها حتى ترسل طلبك، ويثبّتها اعتماد المتجر
            فلا تتغيّر بعده.
          </p>
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
        </div>
        <div className="vo-dialog__foot">
          <button className="btn btn--secondary" type="button" onClick={() => setConfirming(false)}>
            رجوع
          </button>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? <Icon name="spinner" size={16} className="vo-spin" /> : null}
            {busy ? 'جارٍ الحفظ…' : 'نعم، وتابع إلى المستندات'}
          </button>
        </div>
      </dialog>
    </OnboardingFrame>
  );
}
