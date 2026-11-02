'use client';

// أنماط التأهيل تُستورد مع إطاره: صفحاته خارج قشرة اللوحة
import '@/styles/screens/vendor-onboarding.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { StatusBadge } from '@/components/ui';
import { useLocale, useT } from '@/components/locale';
import { pick, type Bilingual } from '@/lib/i18n';

/**
 * إطار شاشات التأهيل VD-01 → VD-04 كما في ملف التصميم: شريط بالعلامة،
 * ثم شريط الخطوات الستّ، ثم المحتوى. ليس داخل قشرة اللوحة — البائع لم
 * يصل إليها بعد، واللوحة تعيده إلى هنا حتى يُعتمد.
 *
 * الخطوات ستّ لا أربع: عملة التسوية وملف المتجر جزء من الطريق إلى أول
 * بيع، وإخفاؤهما يوهم البائع أن الاعتماد نهاية الرحلة.
 *
 * والعملة قبل المستندات لا بعد المراجعة: الاعتماد يثبّتها، فكانت خطوتها تأتي
 * بعد أن ثُبّتت بعملة اقتُرحت من البلد ولم يرها صاحبها.
 */
const STEPS: readonly Bilingual[] = [
  { ar: 'الحساب', en: 'Account' },
  { ar: 'المتجر', en: 'Shop' },
  { ar: 'عملة التسوية', en: 'Settlement currency' },
  { ar: 'المستندات', en: 'Documents' },
  { ar: 'المراجعة', en: 'Review' },
  { ar: 'ملف المتجر', en: 'Shop profile' },
];

export function OnboardingFrame({
  step,
  status,
  children,
}: {
  /** رقم الخطوة الحالية من 1 إلى 6 */
  step: number;
  status?: string | undefined;
  children: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="vo" data-density="compact">
      <header className="vo-top">
        <Link href="/" className="vo-top__mark">
          {t('بسطة', 'Basta')}
        </Link>
        <span className="vo-top__sep" aria-hidden />
        <span className="vo-top__title">{t('كن بائعاً — تهيئة المتجر', 'Become a seller — shop setup')}</span>
        {status ? (
          <span className="vo-top__end">
            <StatusBadge status={status} />
          </span>
        ) : null}
      </header>

      <div className="vo-steps-bar">
        <ol className="vo-steps" aria-label={t('خطوات التسجيل', 'Registration steps')}>
          {STEPS.map((label, i) => {
            const pos = i + 1;
            const state = pos < step ? 'done' : pos === step ? 'current' : 'todo';
            return (
              <li
                key={label.ar}
                className="vo-steps__item"
                data-state={state}
                {...(pos === step ? { 'aria-current': 'step' as const } : {})}
              >
                <span className="vo-steps__node">
                  <span className="vo-steps__dot" aria-hidden>
                    {state === 'done' ? <Icon name="check" size={15} /> : <span className="num">{pos}</span>}
                  </span>
                  <span className="vo-steps__label">
                    {pick(locale, label)}
                    {state === 'done' ? <span className="visually-hidden">{t(' — مكتملة', ' — complete')}</span> : null}
                  </span>
                </span>
                {pos < STEPS.length ? <span className="vo-steps__line" aria-hidden /> : null}
              </li>
            );
          })}
        </ol>
      </div>

      <main className="vo-main">{children}</main>
    </div>
  );
}

/** عنوان الشاشة ووصفها القصير — h1 بخط العناوين ثم سطر يقول ما المطلوب */
export function OnboardingHead({
  title,
  lead,
  aside,
}: {
  title: ReactNode;
  lead?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="vo-head">
      <div className="vo-head__row">
        <h1>{title}</h1>
        {aside}
      </div>
      {lead ? <p className="vo-head__lead">{lead}</p> : null}
    </div>
  );
}

/** هيكل التحميل — شكل الصفحة قبل بياناتها، لا دوّار في فراغ */
export function OnboardingLoading({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="vo-loading" aria-busy="true">
      <span className="visually-hidden" role="status">
        {label ?? t('جارٍ تحميل حالة متجرك…', 'Loading your shop status…')}
      </span>
      <span className="skeleton vo-loading__title" />
      <span className="skeleton vo-loading__block" />
      <span className="skeleton vo-loading__block" />
    </div>
  );
}

/** تعذّر التحميل — ما حدث، وطريق واحد للمحاولة من جديد */
export function OnboardingError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <div className="vo-error" role="alert">
      <span className="vo-error__icon" aria-hidden>
        <Icon name="alert" size={26} />
      </span>
      <p className="vo-error__title">{t('تعذّر تحميل حالة متجرك', "Couldn't load your shop status")}</p>
      <p className="vo-error__text">{message}</p>
      {onRetry ? (
        <button className="btn btn--primary" type="button" onClick={onRetry}>
          <Icon name="refresh" size={16} />
          {t('أعد المحاولة', 'Try again')}
        </button>
      ) : null}
    </div>
  );
}
