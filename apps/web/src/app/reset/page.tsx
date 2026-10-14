'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons';
import { digitsOnly } from '@/lib/digits';
import { TextInput } from '@/components/ui';
import { api, session, type Tokens } from '@/lib/api';
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
          ? 'كلمة المرور ثمانية أحرف على الأقل.'
          : mismatch
            ? 'الكلمتان غير متطابقتين.'
            : 'اكتب البريد والرمز المكوّن من ستة أرقام.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', auth: false, body: { email: email.trim(), code, newPassword: password } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تعيين كلمة المرور.');
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
            بسطة
          </Link>
          <h1 className="ac-auth__title">كلمة مرور جديدة</h1>
          <p className="ac-auth__sub">اكتب الرمز الذي وصلك بالبريد، ثم كلمتك الجديدة مرتين.</p>
        </header>

        {done ? (
          <section className="ac-auth__card">
            <div className="alert alert--success ac-note" role="status">
              <Icon name="check-circle" size={16} />
              <span>حُدّثت كلمة المرور، وأُنهيت كل الجلسات المفتوحة على حسابك.</span>
            </div>
            <Link href={withNext('/login', next)} className="btn btn--primary btn--block ac-auth__cta">
              ادخل بكلمتك الجديدة
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
              label="البريد الإلكتروني"
              type="email"
              autoComplete="email"
              inputMode="email"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextInput
              label="رمز الاستعادة"
              hint="ستة أرقام وصلتك بالبريد، صالحة عشر دقائق."
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
            <NewPasswordField label="كلمة المرور الجديدة" value={password} onChange={setPassword} />
            <TextInput
              label="أعد كتابتها"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              required
              value={confirm}
              error={mismatch ? 'الكلمتان غير متطابقتين.' : null}
              onChange={(e) => setConfirm(e.target.value)}
            />

            <button className="btn btn--primary btn--block ac-auth__cta" type="submit" disabled={busy}>
              {busy ? 'جارٍ الحفظ…' : 'احفظ كلمة المرور وادخل'}
            </button>
          </form>
        )}

        <p className="ac-auth__foot">
          <span>لم يصلك رمز؟</span>
          <Link href={withNext('/forgot', next)}>اطلب رمزاً جديداً</Link>
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
