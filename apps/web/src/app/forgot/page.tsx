'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { RESET_EMAIL_KEY } from '../reset/new-password-field';

/**
 * SH-04 (1) — «نسيت كلمة المرور».
 *
 * الرد واحد مسجّلاً كان البريد أو لا: الصفحة لا تقول «لا حساب بهذا البريد»
 * أبداً، فلا تصير أداةً لمعرفة من سجّل لدينا.
 */
export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!/.+@.+\..+/.test(email.trim())) {
      setError('اكتب بريداً صحيحاً بالشكل name@example.com');
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
      setError(err instanceof Error ? err.message : 'تعذّر الإرسال. حاول مرة أخرى.');
    } finally {
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
          <h1 className="ac-auth__title">استعادة كلمة المرور</h1>
          <p className="ac-auth__sub">نرسل لك رمزاً من ست خانات تعيّن به كلمة مرور جديدة.</p>
        </header>

        {sent ? (
          <section className="ac-auth__card id-sent" aria-live="polite">
            <span className="id-sent__icon" aria-hidden>
              <Icon name="msg" size={24} />
            </span>
            <p className="id-sent__text">{sent} تحقّق من مجلّد البريد غير المرغوب أيضاً.</p>
            <Link href="/reset" className="btn btn--primary btn--block ac-auth__cta">
              أدخل الرمز وكلمة جديدة
            </Link>
            <button type="button" className="ac-link-btn" onClick={() => setSent(null)}>
              جرّب بريداً آخر
            </button>
          </section>
        ) : (
          <form className="ac-auth__card" onSubmit={submit} noValidate>
            <TextInput
              label="البريد الإلكتروني"
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
              {busy ? 'جارٍ الإرسال…' : 'أرسل رمز الاستعادة'}
            </button>
            <Link href="/login" className="ac-link-btn">
              عُد إلى الدخول
            </Link>
          </form>
        )}

        <p className="ac-auth__foot">
          <span>معك الرمز من قبل؟</span>
          <Link href="/reset">عيّن كلمة جديدة</Link>
        </p>
      </div>
    </main>
  );
}
