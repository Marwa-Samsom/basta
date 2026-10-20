'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, session, type Tokens } from '@/lib/api';
import { syncAccountCurrency } from '@/lib/currency';
import { Icon } from '@/components/icons';
import { TextInput } from '@/components/ui';
import { internalPath, withNext } from '@/lib/safe-path';
import { NewPasswordField } from '../reset/new-password-field';

/**
 * SH-02 — إنشاء حساب. يليه الدخول مباشرةً فلا يُطلب إدخال البيانات مرتين،
 * ثم SH-03 تأكيد البريد — ومعها «تخطَّ الآن»: التأكيد لا يحجب الحساب.
 *
 * الوجهة بعد التأكيد ما جاء الزائر من أجله (`next`) — بائع من «ابدأ البيع» يُكمل
 * إلى تسجيل متجره — وإلا فحسابه. كانت ثابتة على تسجيل المتجر، فيصل كل مشترٍ جديد
 * إلى نموذج فتح متجر.
 */
function RegisterForm() {
  const router = useRouter();
  const next = internalPath(useSearchParams().get('next'));
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
      await syncAccountCurrency();
      router.push(withNext('/verify', next ?? '/account'));
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
          <Link href={withNext('/login', next)}>ادخل</Link>
        </p>
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="ac-auth" />}>
      <RegisterForm />
    </Suspense>
  );
}
