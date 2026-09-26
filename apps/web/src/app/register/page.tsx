'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, session, type Tokens } from '@/lib/api';
import { Icon } from '@/components/icons';
import { TextInput } from '@/components/ui';
import { NewPasswordField } from '../reset/new-password-field';

/** بعد التأكيد أو تخطّيه — وجهة التسجيل كما كانت قبل صفحة الرمز */
const AFTER_VERIFY = '/vendor/register';

/**
 * SH-02 — إنشاء حساب. يليه الدخول مباشرةً فلا يُطلب إدخال البيانات مرتين،
 * ثم SH-03 تأكيد البريد — ومعها «تخطَّ الآن»: التأكيد لا يحجب الحساب.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/register', {
        method: 'POST',
        auth: false,
        body: {
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          ...(form.phone ? { phone: form.phone } : {}),
        },
      });
      const login = await api<{ tokens: Tokens }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email: form.email, password: form.password },
      });
      session.write(login.tokens);
      router.push(`/verify?next=${encodeURIComponent(AFTER_VERIFY)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء الحساب.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ac-auth">
      <div className="ac-auth__box ac-auth__box--wide">
        <header className="ac-auth__head">
          <Link href="/" className="ac-wordmark">
            بسطة
          </Link>
          <h1 className="ac-auth__title">أنشئ حسابك</h1>
          <p className="ac-auth__sub">دقيقة واحدة، ثم نرسل إلى بريدك رمز تأكيد من ست خانات.</p>
        </header>

        <form className="ac-auth__card" onSubmit={submit} noValidate>
          {error ? (
            <div className="alert alert--danger ac-note" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          <TextInput label="الاسم الكامل" autoComplete="name" required value={form.fullName} onChange={set('fullName')} />
          <TextInput
            label="البريد الإلكتروني"
            type="email"
            dir="ltr"
            autoComplete="email"
            required
            value={form.email}
            onChange={set('email')}
          />

          <NewPasswordField
            label="كلمة المرور"
            value={form.password}
            onChange={(password) => setForm((f) => ({ ...f, password }))}
          />

          <TextInput
            label="رقم الجوال"
            optional
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            className="field__control ac-mono"
            placeholder="+962790000000"
            value={form.phone}
            onChange={set('phone')}
          />

          <button className="btn btn--primary btn--block ac-auth__cta" type="submit" disabled={busy}>
            {busy ? 'جارٍ الإنشاء…' : 'أنشئ الحساب'}
          </button>
        </form>

        <p className="ac-auth__foot">
          <span>لديك حساب بالفعل؟</span>
          <Link href="/login">ادخل</Link>
        </p>
      </div>
    </main>
  );
}
