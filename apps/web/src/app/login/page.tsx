'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type RefObject, Suspense, useRef, useState } from 'react';
import { api, ApiError, session, type Tokens } from '@/lib/api';
import { syncAccountCurrency } from '@/lib/currency';
import { digitsOnly } from '@/lib/digits';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';
import { Field, TextInput } from '@/components/ui';
import { homeFor, internalPath, withNext } from '@/lib/safe-path';

interface LoginResponse {
  tokens: Tokens;
  requiresTotpSetup: boolean;
}

/**
 * ✕ يمحو المكتوب ويُبقي المؤشّر في الخانة — البريد وكلمة المرور (27 أكتوبر 2026، بطلب صاحبة المشروع).
 * لا يظهر والخانة فارغة؛ والضغط عليه لا يسرق التركيز من الخانة.
 */
function ClearButton({
  label,
  input,
  onClear,
}: {
  label: string;
  input: RefObject<HTMLInputElement | null>;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      className="ac-clear"
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClear();
        input.current?.focus();
      }}
    >
      <Icon name="x" size={15} />
    </button>
  );
}

/** حقل البريد و✕ في نهايته. اسم الزرّ لا يحوي «البريد الإلكتروني»: البحث بالتسمية يجد الحقل وحده */
function EmailField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Field label={t('البريد الإلكتروني', 'Email')}>
      {(props) => (
        <span className="ac-clearable">
          <input
            ref={input}
            className="field__control"
            type="email"
            autoComplete="email"
            inputMode="email"
            dir="ltr"
            required
            value={value}
            onChange={(e) => onChange(e.target.value)}
            {...props}
          />
          {value ? <ClearButton label={t('امسح البريد', 'Clear email')} input={input} onClear={() => onChange('')} /> : null}
        </span>
      )}
    </Field>
  );
}

/**
 * حقل كلمة المرور بزرّ إظهار في طرفه (التصميم)، و✕ يمحو المكتوب في طرفه الآخر.
 * اسما الزرّين لا يحويان «كلمة المرور» عمداً: البحث بالتسمية «كلمة المرور» يجب أن يجد الحقل وحده.
 */
function PasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Field label={t('كلمة المرور', 'Password')}>
      {(props) => (
        <span className="ac-pw">
          <input
            ref={input}
            className="field__control"
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            dir="ltr"
            required
            value={value}
            onChange={(e) => onChange(e.target.value)}
            {...props}
          />
          <button
            type="button"
            className="ac-pw__toggle"
            aria-label={t('إظهار الحروف', 'Show characters')}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
          >
            <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
          </button>
          {value ? <ClearButton label={t('امسح الحروف', 'Clear characters')} input={input} onClear={() => onChange('')} /> : null}
        </span>
      )}
    </Field>
  );
}

/**
 * SH-01 — الدخول، ويخدم دخول الإدارة AD-01 حين يكون `next` تحت /admin.
 *
 * الإدارة خطوتان كما في التصميم: البيانات، ثم رمز التحقق حين يطلبه الخادم.
 * في الخطوة الثانية يختفي البريد وكلمة المرور من العرض لا من الحالة — الطلب
 * الثاني يرسل الثلاثة معاً كما كان.
 */
function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  // الوجهة من الرابط: مسار داخلي وإلا فلا — لا `?next=https://…` يخرج بالمستخدم بعد الدخول.
  // بلا وجهة يقرّرها الدور بعد الدخول (homeFor)، لا وجهة ثابتة واحدة للجميع
  const next = internalPath(params.get('next'));
  const isAdmin = next?.startsWith('/admin') ?? false;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password, ...(totp ? { totp } : {}) },
      });
      session.write(res.tokens);
      // عملة الحساب تتبعه إلى هذا الجهاز قبل أن تُصيَّر أول صفحة
      await syncAccountCurrency();
      router.push(res.requiresTotpSetup ? '/account/2fa' : (next ?? homeFor(session.roles())));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('تعذّر تسجيل الدخول.', "Couldn't sign in.");
      // الخادم يطلب رمز التحقق الثنائي ممّن فعّله — الحقل يظهر عندها لا قبلها.
      // أول طلب للرمز ليس خطأً بل خطوة: يشرحها شريط المعلومات لا تنبيه أحمر.
      // الرمز أولاً — النصّ بلغة الصفحة؛ والنصّ العربي لخادم أقدم لا يرسل الرمز
      if (err instanceof ApiError && (err.code === 'TOTP_REQUIRED' || /التحقق|رمز/.test(message))) {
        const firstAsk = !needsTotp;
        setNeedsTotp(true);
        setError(firstAsk ? null : message);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  function back(): void {
    setNeedsTotp(false);
    setUseRecovery(false);
    setTotp('');
    setError(null);
  }

  const sub = isAdmin
    ? needsTotp
      ? t('اكتب الرمز من تطبيق المصادقة.', 'Enter the code from your authenticator app.')
      : t('خطوتان: بياناتك ثم رمز التحقّق.', 'Two steps: your details, then the verification code.')
    : t('تابع طلباتك من أي جهاز.', 'Track your orders from any device.');

  return (
    <main className="ac-auth">
      <div className="ac-auth__box">
        <header className="ac-auth__head">
          {isAdmin ? (
            <Link href="/" className="ac-mark" aria-label={t('بسطة — الرئيسية', 'Basta — Home')}>
              {t('ب', 'B')}
            </Link>
          ) : (
            <Link href="/" className="ac-wordmark">
              {t('بسطة', 'Basta')}
            </Link>
          )}
          <h1 className="ac-auth__title">
            {isAdmin ? t('دخول لوحة الإدارة', 'Admin sign in') : t('ادخل إلى حسابك', 'Sign in to your account')}
          </h1>
          <p className="ac-auth__sub">{sub}</p>
        </header>

        <form className="ac-auth__card" onSubmit={submit} noValidate>
          {error ? (
            <div className="alert alert--danger ac-note" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          {needsTotp ? (
            <>
              <div className="alert alert--info ac-note" role="status">
                <Icon name="shield" size={16} />
                <span>
                  {isAdmin
                    ? t('رمز التحقّق بخطوتين إلزامي لحسابات الإدارة', 'Two-step verification is required for admin accounts')
                    : t('حسابك محمي بالتحقّق بخطوتين', 'Your account is protected by two-step verification')}
                </span>
              </div>
              {useRecovery ? (
                <TextInput
                  label={t('رمز الاستعادة', 'Recovery code')}
                  hint={t(
                    'أحد الرموز العشرة التي حفظتها عند التفعيل — كلٌّ يُستعمل مرة واحدة.',
                    'One of the ten codes you saved when you turned it on — each works only once.',
                  )}
                  className="field__control ac-otp"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  dir="ltr"
                  placeholder="XXXXX-XXXXX"
                  maxLength={11}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.trim())}
                />
              ) : (
                <TextInput
                  label={t('رمز التحقق الثنائي', 'Two-step verification code')}
                  hint={t('ستة أرقام من تطبيق المصادقة.', 'Six digits from your authenticator app.')}
                  className="field__control ac-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  placeholder="000000"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(digitsOnly(e.target.value))}
                />
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm ac-fit"
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setTotp('');
                  setError(null);
                }}
              >
                {useRecovery
                  ? t('استعمل رمز التطبيق', 'Use the app code')
                  : t('أضعت هاتفك؟ استعمل رمز استعادة', 'Lost your phone? Use a recovery code')}
              </button>
            </>
          ) : (
            <>
              <EmailField value={email} onChange={setEmail} />
              <PasswordField value={password} onChange={setPassword} />
              {/* رابط لا تسمية: البحث بالتسمية «كلمة المرور» يبقى يجد الحقل وحده */}
              <Link href={withNext('/forgot', next)} className="id-forgot">
                {t('نسيت كلمة المرور؟', 'Forgot your password?')}
              </Link>
            </>
          )}

          <button className="btn btn--primary btn--block ac-auth__cta" type="submit" disabled={busy}>
            {busy ? t('جارٍ الدخول…', 'Signing in…') : t('دخول', 'Sign in')}
          </button>

          {needsTotp ? (
            <button type="button" className="ac-link-btn" onClick={back}>
              {t('رجوع', 'Back')}
            </button>
          ) : null}
        </form>

        {isAdmin ? null : (
          <p className="ac-auth__foot">
            <span>{t('ليس لديك حساب؟', "Don't have an account?")}</span>
            <Link href={withNext('/register', next)}>{t('أنشئ حساباً', 'Create an account')}</Link>
          </p>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="ac-auth" />}>
      <LoginForm />
    </Suspense>
  );
}
