'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui';
import { Icon } from '@/components/icons';
import { CURRENCIES, formatAmount, useOnboarding, type Onboarding } from '@/lib/vendor';
import { OnboardingError, OnboardingFrame, OnboardingHead, OnboardingLoading } from '../onboarding-chrome';
import { useLocale, useT } from '@/components/locale';

/**
 * VD-04 — عملة التسوية، الخطوة الثالثة: بعد بيانات المتجر وقبل المستندات.
 *
 * الاعتماد يثبّتها ولا تتغيّر بعده (ADR-013)، فالشاشة تعاملها كقرار: تحذير صريح،
 * ومثال يتغيّر مع الاختيار بخانات العملة نفسها، وإقرار، ثم نافذة تأكيد. لا نجعله
 * سهلاً — نجعله مفهوماً. الاختيار يبقى قابلاً للتغيير حتى الإرسال، والخادم يمنع
 * الإرسال بلا اختيار صريح: المقترحة من البلد اقتراح لا اختيار.
 */
export default function CurrencyPage() {
  const t = useT();
  const locale = useLocale();
  const nameOf = (c: (typeof CURRENCIES)[number]): string => (locale === 'en' ? c.nameEn : c.nameAr);
  const symbolOf = (c: (typeof CURRENCIES)[number]): string => (locale === 'en' ? c.symbolEn : c.symbol);
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

  // التحويل إلى التسجيل في useOnboarding نفسه، بعد الرسم
  if (missing) return null;
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
        <OnboardingError message={error ?? t('تعذّر تحميل حالة المتجر.', "Couldn't load your shop status.")} onRetry={() => void reload()} />
      </OnboardingFrame>
    );
  }

  const selected = picked ?? data.settlementCurrency;
  const currency = CURRENCIES.find((c) => c.code === selected) ?? CURRENCIES[0]!;

  if (data.settlementCurrencyLocked) {
    // أُرسل الطلب أو اعتُمد: العملة لا تتغيّر من هنا — والوجهة التالية بحسب الحال
    const reviewing = data.status === 'in_review';
    const onward = reviewing
      ? { href: '/vendor/onboarding/status', label: t('تابع حالة طلبك', 'Track your application') }
      : data.status === 'approved' || data.status === 'suspended'
        ? { href: '/vendor/store', label: t('جهّز ملف المتجر', 'Set up your shop profile') }
        : { href: '/vendor/onboarding/documents', label: t('المستندات', 'Documents') };
    return (
      <OnboardingFrame step={reviewing ? 5 : 6} status={data.status}>
        <OnboardingHead title={t('عملة التسوية', 'Settlement currency')} />
        <Alert tone="info" title={t(`عملتك: ${currency.nameAr}`, `Your currency: ${currency.nameEn}`)}>
          {reviewing
            ? t(
                'طلبك قيد المراجعة، والعملة لا تتغيّر أثناءها. يثبّتها اعتماد متجرك.',
                "Your application is under review, and the currency can't change meanwhile. Approval of your shop locks it.",
              )
            : t(
                'تُسعّر منتجاتك بها وتستلم مستحقاتك بها. تغييرها يتطلّب تسوية رصيدك الحالي — راسل الدعم عند الحاجة.',
                'Your products are priced in it and your payouts are made in it. Changing it requires settling your current balance — contact support if needed.',
              )}
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
      setFailure(err instanceof Error ? err.message : t('تعذّر حفظ العملة.', "Couldn't save the currency."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingFrame step={3} status={data.status}>
      <OnboardingHead
        title={t('اختر عملة التسوية', 'Choose your settlement currency')}
        lead={t(
          'العملة التي تُسعّر بها منتجاتك وتستلم بها مستحقاتك. يرى المشتري السعر محوَّلاً إلى عملته، وتبقى مستحقاتك بعملتك.',
          'The currency you price your products in and receive your payouts in. Buyers see the price converted to their currency, and your payouts stay in yours.',
        )}
      />

      <div className="vo-callout vo-callout--warning" role="note">
        <Icon name="alert" size={19} />
        <div className="vo-callout__text">
          <p className="vo-callout__title">
            {t('تُثبَّت العملة عند اعتماد متجرك — ولا تتغيّر بعده', 'The currency is locked when your shop is approved — and never changes after that')}
          </p>
          <p className="vo-callout__body">
            {t(
              'اختر العملة التي تتعامل بها فعلياً مع بنكك. تستطيع تغييرها حتى ترسل طلبك للمراجعة، ما لم تسعّر بها منتجاً أو شحناً.',
              "Choose the currency you actually use with your bank. You can change it until you submit your application for review, as long as you haven't priced a product or shipping in it.",
            )}
          </p>
        </div>
      </div>

      <section aria-labelledby="currency-pick">
        <h2 className="visually-hidden" id="currency-pick">
          {t('اختر عملتك', 'Choose your currency')}
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
                <span className="vo-cur__name">{nameOf(c)}</span>
              </span>
              <span className="vo-cur__meta">
                <span className="vo-cur__code num">{c.code}</span>
                <span className="vo-cur__symbol">{symbolOf(c)}</span>
                <span className="vo-cur__dec">
                  {c.digits === 3 ? t('ثلاث خانات عشرية', '3 decimal places') : t('خانتان عشريتان', '2 decimal places')}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="vo-split vo-split--currency">
        <section className="card vo-example" aria-labelledby="currency-example">
          <h3 className="vo-side-title" id="currency-example">
            {t('مثال حيّ', 'Live example')}
          </h3>
          {/* «بـ» + اسم العملة يُنتج «بـ دينار كويتي». الاسم يُذكر مرة واحدة
              في صدر الجملة، والباقي إشارة إليه — فتستقيم مع كل عملة. */}
          <div className="vo-example__box">
            <span className="vo-example__row">
              <span className="vo-example__label">{t('سعرٌ تكتبه لمنتجك', 'A price you enter for your product')}</span>
              <span className="vo-example__amount money num">
                {formatAmount(79, currency.code, locale)} {symbolOf(currency)}
              </span>
            </span>
            <span className="vo-example__row vo-example__row--total">
              <span className="vo-example__label">{t('مستحقاتك تُحوَّل بعملة', 'Your payouts are made in')}</span>
              <span className="vo-example__payout">{nameOf(currency)}</span>
            </span>
          </div>
          <p className="vo-example__note">
            {t(
              'يراه المشتري في بلده محوَّلاً إلى عملته، وتبقى مستحقاتك بالعملة نفسها. الخانات العشرية تتبع العملة:',
              'Buyers in their own country see it converted to their currency, and your payouts stay in the same currency. Decimal places follow the currency:',
            )}{' '}
            <span className="num">{currency.code}</span> {t('يُعرض بـ', 'is shown as')}{' '}
            <span className="num">{formatAmount(79, currency.code, locale)}</span>.
          </p>
        </section>

        <section className="card vo-commit" aria-label={t('التثبيت', 'Confirmation')}>
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
            <span>
              {t(
                'فهمت أن العملة تُثبَّت عند اعتماد متجري ولا تتغيّر بعده.',
                "I understand the currency is locked when my shop is approved and can't change after that.",
              )}
            </span>
          </label>

          <button
            className="btn btn--primary btn--block"
            type="button"
            disabled={!acknowledged}
            onClick={() => setConfirming(true)}
          >
            {t('اختر', 'Choose')} {nameOf(currency)}
            <Icon name="next" size={16} mirror />
          </button>
          <p className="vo-commit__hint">
            {/* الزرّ معطّل بلا «فهمت» لمن اختار من قبل أيضاً — فالتلميح يقول لماذا أولاً */}
            {!acknowledged
              ? t('علّم «فهمت» لتتابع.', 'Tick “I understand” to continue.')
              : data.settlementCurrencyChosen
                ? t(
                    `اخترت ${CURRENCIES.find((c) => c.code === data.settlementCurrency)?.nameAr ?? data.settlementCurrency} من قبل — تستطيع تغييرها حتى ترسل طلبك.`,
                    `You chose ${CURRENCIES.find((c) => c.code === data.settlementCurrency)?.nameEn ?? data.settlementCurrency} earlier — you can change it until you submit your application.`,
                  )
                : t('تُسأل مرة واحدة فقط قبل التأكيد.', "You'll be asked only once before confirming.")}
          </p>
          <Link className="btn btn--secondary btn--block" href="/vendor/register">
            <Icon name="back" size={16} mirror />
            {t('رجوع إلى بيانات المتجر', 'Back to shop details')}
          </Link>
          {/* المسوّدة أيضاً تصل صفحة حالتها من هنا — كان «تابع حالة طلبك» بعد الإرسال وحده (VON-041) */}
          <p className="vo-commit__track">
            <Link href="/vendor/onboarding/status">{t('تابع حالة طلبك', 'Track your application')}</Link>
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
            {t('تأكيد أخير', 'Final confirmation')}
          </h2>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label={t('إغلاق', 'Close')}
            onClick={() => setConfirming(false)}
          >
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="vo-dialog__body">
          <span className="badge badge--money vo-dialog__pill">
            <Icon name="wallet" size={15} />
            {nameOf(currency)} · {symbolOf(currency)}
          </span>
          <p>
            {t('ستكون', 'Your shop currency will be')} <strong>{nameOf(currency)}</strong>{' '}
            {t(
              'عملة متجرك. تستطيع تغييرها حتى ترسل طلبك، ويثبّتها اعتماد المتجر فلا تتغيّر بعده.',
              "— you can change it until you submit your application. Approval of your shop locks it, and it can't change after that.",
            )}
          </p>
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
        </div>
        <div className="vo-dialog__foot">
          <button className="btn btn--secondary" type="button" onClick={() => setConfirming(false)}>
            {t('رجوع', 'Back')}
          </button>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? <Icon name="spinner" size={16} className="vo-spin" /> : null}
            {busy ? t('جارٍ الحفظ…', 'Saving…') : t('نعم، وتابع إلى المستندات', 'Yes, continue to documents')}
          </button>
        </div>
      </dialog>
    </OnboardingFrame>
  );
}
