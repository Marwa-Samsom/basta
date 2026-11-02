'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';
import { TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { internalPath, withNext } from '@/lib/safe-path';
import { RESET_EMAIL_KEY } from '../reset/new-password-field';

/**
 * SH-04 (1) — «نسيت كلمة المرور».
 *
 * الرد واحد مسجّلاً كان البريد أو لا: الصفحة لا تقول «لا حساب بهذا البريد»
 * أبداً، فلا تصير أداةً لمعرفة من سجّل لدينا. والوجهة التي جاء الزائر من أجلها
 * (`next`) تُحمل إلى صفحة التعيين، فيصلها بعد أن يدخل بكلمته الجديدة.
 */
function ForgotForm() {
  const t = useT();
  const next = internalPath(useSearchParams().get('next'));
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!/.+@.+\..+/.test(email.trim())) {
      setError(t('اكتب بريداً صحيحاً بالشكل name@example.com', 'Enter a valid email like name@example.com'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>('/auth/password/forgot', {
        method: 'POST',
        auth: false,
        body: { email: email.trim() },
      });
      try {
        window.sessionStorage.setItem(RESET_EMAIL_KEY, email.trim());
      } catch {
        // التخزين محجوب: صفحة التعيين تطلب البريد من جديد، لا أكثر
      }
      setSent(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('تعذّر الإرسال. حاول مرة أخرى.', "Couldn't send. Please try again."));
    } finally {
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
          <h1 className="ac-auth__title">{t('استعادة كلمة المرور', 'Reset your password')}</h1>
          <p className="ac-auth__sub">
            {t(
              'نرسل لك رمزاً من ست خانات تعيّن به كلمة مرور جديدة.',
              "We'll send you a six-digit code to set a new password.",
            )}
          </p>
        </header>

        {sent ? (
          <section className="ac-auth__card id-sent" aria-live="polite">
            <span className="id-sent__icon" aria-hidden>
              <Icon name="msg" size={24} />
            </span>
            <p className="id-sent__text">
              {sent} {t('تحقّق من مجلّد البريد غير المرغوب أيضاً.', 'Check your spam folder too.')}
            </p>
            <Link href={withNext('/reset', next)} className="btn btn--primary btn--block ac-auth__cta">
              {t('أدخل الرمز وكلمة جديدة', 'Enter the code and a new password')}
            </Link>
            <button type="button" className="ac-link-btn" onClick={() => setSent(null)}>
              {t('جرّب بريداً آخر', 'Try another email')}
            </button>
          </section>
        ) : (
          <form className="ac-auth__card" onSubmit={submit} noValidate>
            <TextInput
              label={t('البريد الإلكتروني', 'Email')}
              type="email"
              autoComplete="email"
              inputMode="email"
              dir="ltr"
              required
              value={email}
              error={error}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
            />
            <button className="btn btn--primary btn--block ac-auth__cta" type="submit" disabled={busy}>
              {busy ? t('جارٍ الإرسال…', 'Sending…') : t('أرسل رمز الاستعادة', 'Send reset code')}
            </button>
            <Link href={withNext('/login', next)} className="ac-link-btn">
              {t('عُد إلى الدخول', 'Back to sign in')}
            </Link>
          </form>
        )}

        <p className="ac-auth__foot">
          <span>{t('معك الرمز من قبل؟', 'Already have a code?')}</span>
          <Link href={withNext('/reset', next)}>{t('عيّن كلمة جديدة', 'Set a new password')}</Link>
        </p>
      </div>
    </main>
  );
}

export default function ForgotPage() {
  return (
    <Suspense fallback={<main className="ac-auth" />}>
      <ForgotForm />
    </Suspense>
  );
}
