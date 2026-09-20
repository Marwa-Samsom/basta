'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, session, type Tokens } from '@/lib/api';
import { Alert, Card, TextInput } from '@/components/ui';

/** SH-02 — إنشاء حساب. يليه الدخول مباشرةً فلا يُطلب إدخال البيانات مرتين. */
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
      router.push('/vendor/register');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء الحساب.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="stack stack--tight">
        <h1>إنشاء حساب</h1>
        <p className="muted">حساب واحد يكفي للشراء والبيع معاً.</p>
      </header>

      <Card>
        <form className="stack" onSubmit={submit} noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <TextInput label="الاسم الكامل" required value={form.fullName} onChange={set('fullName')} />
          <TextInput
            label="البريد الإلكتروني"
            type="email"
            dir="ltr"
            autoComplete="email"
            required
            value={form.email}
            onChange={set('email')}
          />
          <TextInput
            label="رقم الهاتف"
            optional
            type="tel"
            dir="ltr"
            inputMode="tel"
            placeholder="+962790000000"
            value={form.phone}
            onChange={set('phone')}
          />
          <TextInput
            label="كلمة المرور"
            type="password"
            autoComplete="new-password"
            hint="اثنا عشر حرفاً على الأقل. العبارة الطويلة أقوى من الرموز المعقّدة."
            required
            value={form.password}
            onChange={set('password')}
          />

          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}
          </button>
        </form>
      </Card>

      <p className="small muted">
        عندك حساب؟ <Link href="/login">سجّل الدخول</Link>
      </p>
    </main>
  );
}
