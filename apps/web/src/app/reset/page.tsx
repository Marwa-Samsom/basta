'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';
import { digitsOnly } from '@/lib/digits';
import { TextInput } from '@/components/ui';
import { api, session, type Tokens } from '@/lib/api';
import { syncAccountCurrency } from '@/lib/currency';
import { homeFor, internalPath, withNext } from '@/lib/safe-path';
import { MIN_PASSWORD, NewPasswordField, RESET_EMAIL_KEY } from './new-password-field';

/**
 * SH-04 (2) — كلمة مرور جديدة بالرمز الذي وصل البريد.
 *
 * النجاح يُنهي كل جلسات الحساب في الخادم، ثم تدخل الصفحة بالكلمة الجديدة
 * مباشرةً («احفظ وادخل»). حساب إداري يحتاج رمز تطبيقه للدخول، فيُحال إلى
 * صفحة الدخول بدل ذلك.
 */
const noSubscribe = () => () => {};
function savedEmail(): string {
  try {
    return window.sessionStorage.getItem(RESET_EMAIL_KEY) ?? '';
  } catch {
    // ذاكرة الجلسة محجوبة: يكتبه المستخدم
    return '';
  }
}

function ResetForm() {
  const t = useT();
  const router = useRouter();
  const next = internalPath(useSearchParams().get('next'));
  // البريد من خطوة «نسيت» إن وُجد — الخادم يصيّر فارغاً والمتصفّح يقرؤه بلا تعارض
  const saved = useSyncExternalStore(noSubscribe, savedEmail, () => '');
  const [typed, setEmail] = useState<string | null>(null);
  const email = typed ?? saved;
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = confirm !== '' && confirm !== password;
  const ready = /.+@.+\..+/.test(email) && /^\d{6}$/.test(code) && password.length >= MIN_PASSWORD && confirm === password;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!ready) {
      setError(
        password.length < MIN_PASSWORD
          ? t('كلمة المرور ثمانية أحرف على الأقل.', 'The password must be at least eight characters.')
          : mismatch
            ? t('الكلمتان غير متطابقتين.', "The passwords don't match.")
            : t('اكتب البريد والرمز المكوّن من ستة أرقام.', 'Enter your email and the six-digit code.'),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', auth: false, body: { email: email.trim(), code, newPassword: password } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('تعذّر تعيين كلمة المرور.', "Couldn't set the password."));
      setBusy(false);
      return;
    }
    try {
      window.sessionStorage.removeItem(RESET_EMAIL_KEY);
    } catch {
      // لا شيء يُمسح
    }
    session.clear();
    try {
      const login = await api<{ tokens: Tokens; requiresTotpSetup: boolean }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email: email.trim(), password },
      });
      session.write(login.tokens);
      await syncAccountCurrency();
      // ما جاء من أجله، وإلا بيته بحسب دوره — البائع لوحته لا صفحة المشتري
      router.push(login.requiresTotpSetup ? '/account/2fa' : (next ?? homeFor(session.roles())));
    } catch {
      // من فعّل التحقق بخطوتين يحتاج رمزه ليدخل — الكلمة حُدّثت، والدخول من صفحته.
      // الاستعادة لا تتخطّى التحقق الثنائي: كلمة المرور وحدها لا تكفي بعدها أيضاً.
      setDone(true);
      setBusy(false);
    }
  }

  return (
    <main className="ac-auth">
      <div className="ac-auth__box">
        <header className="ac-auth__head">
          <Link href="/" className="ac-wordmark">
            {t('بسطة', 'Basta')}
          </Link>
          <h1 className="ac-auth__title">{t('كلمة مرور جديدة', 'New password')}</h1>
          <p className="ac-auth__sub">
            {t('اكتب الرمز الذي وصلك بالبريد، ثم كلمتك الجديدة مرتين.', 'Enter the code we emailed you, then your new password twice.')}
          </p>
        </header>

        {done ? (
          <section className="ac-auth__card">
            <div className="alert alert--success ac-note" role="status">
              <Icon name="check-circle" size={16} />
              <span>
                {t(
                  'حُدّثت كلمة المرور، وأُنهيت كل الجلسات المفتوحة على حسابك.',
                  'Your password was updated, and all open sessions on your account were signed out.',
                )}
              </span>
            </div>
            <Link href={withNext('/login', next)} className="btn btn--primary btn--block ac-auth__cta">
              {t('ادخل بكلمتك الجديدة', 'Sign in with your new password')}
            </Link>
          </section>
        ) : (
          <form className="ac-auth__card" onSubmit={submit} noValidate>
            {error ? (
              <div className="alert alert--danger ac-note" role="alert">
                <Icon name="alert" size={16} />
                <span>{error}</span>
              </div>
            ) : null}

            <TextInput
              label={t('البريد الإلكتروني', 'Email')}
              type="email"
              autoComplete="email"
              inputMode="email"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextInput
              label={t('رمز الاستعادة', 'Reset code')}
              hint={t('ستة أرقام وصلتك بالبريد، صالحة عشر دقائق.', 'Six digits sent to your email, valid for ten minutes.')}
              className="field__control ac-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              placeholder="000000"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(digitsOnly(e.target.value))}
            />
            <NewPasswordField label={t('كلمة المرور الجديدة', 'New password')} value={password} onChange={setPassword} />
            <TextInput
              label={t('أعد كتابتها', 'Type it again')}
              type="password"
              autoComplete="new-password"
              dir="ltr"
              required
              value={confirm}
              error={mismatch ? t('الكلمتان غير متطابقتين.', "The passwords don't match.") : null}
              onChange={(e) => setConfirm(e.target.value)}
            />

            <button className="btn btn--primary btn--block ac-auth__cta" type="submit" disabled={busy}>
              {busy ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ كلمة المرور وادخل', 'Save password and sign in')}
            </button>
          </form>
        )}

        <p className="ac-auth__foot">
          <span>{t('لم يصلك رمز؟', "Didn't get a code?")}</span>
          <Link href={withNext('/forgot', next)}>{t('اطلب رمزاً جديداً', 'Request a new code')}</Link>
        </p>
      </div>
    </main>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<main className="ac-auth" />}>
      <ResetForm />
    </Suspense>
  );
}
