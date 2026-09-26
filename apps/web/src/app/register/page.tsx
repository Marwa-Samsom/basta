'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, session, type Tokens } from '@/lib/api';
import { Icon } from '@/components/icons';
import { Field, TextInput } from '@/components/ui';

/**
 * قوة كلمة المرور بطولها — كما يقول التلميح: العبارة الطويلة أقوى من الرموز.
 * أقلّ من اثني عشر حرفاً يرفضه الخادم، فهو «ضعيفة» هنا أيضاً.
 */
const STRENGTH_LABEL = ['—', 'ضعيفة', 'متوسطة', 'قوية'] as const;
function strength(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  if (password.length < 12) return 1;
  return password.length < 16 ? 2 : 3;
}

/** SH-02 — إنشاء حساب. يليه الدخول مباشرةً فلا يُطلب إدخال البيانات مرتين. */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [shown, setShown] = useState(false);
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
      router.push('/vendor/register');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء الحساب.');
    } finally {
      setBusy(false);
    }
  }

  const level = strength(form.password);

  return (
    <main className="ac-auth">
      <div className="ac-auth__box ac-auth__box--wide">
        <header className="ac-auth__head">
          <Link href="/" className="ac-wordmark">
            بسطة
          </Link>
          <h1 className="ac-auth__title">أنشئ حسابك</h1>
          <p className="ac-auth__sub">حساب واحد يكفي للشراء والبيع معاً.</p>
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

          <Field label="كلمة المرور" hint="اثنا عشر حرفاً على الأقل. العبارة الطويلة أقوى من الرموز المعقّدة.">
            {(props) => (
              <>
                <span className="ac-pw">
                  <input
                    className="field__control"
                    type={shown ? 'text' : 'password'}
                    autoComplete="new-password"
                    dir="ltr"
                    required
                    value={form.password}
                    onChange={set('password')}
                    {...props}
                  />
                  {/* الاسم لا يحوي «كلمة المرور»: التسمية تخصّ الحقل وحده */}
                  <button
                    type="button"
                    className="ac-pw__toggle"
                    aria-label="إظهار الحروف"
                    aria-pressed={shown}
                    onClick={() => setShown((s) => !s)}
                  >
                    <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
                  </button>
                </span>
                <span className="ac-strength" data-level={level}>
                  <span className="ac-strength__track" aria-hidden>
                    <span className="ac-strength__fill" />
                  </span>
                  <span className="ac-strength__label" aria-live="polite">
                    <span className="visually-hidden">القوة: </span>
                    {STRENGTH_LABEL[level]}
                  </span>
                </span>
              </>
            )}
          </Field>

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
