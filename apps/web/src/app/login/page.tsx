'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, ApiError, session, type Tokens } from '@/lib/api';
import { Alert, Card, TextInput } from '@/components/ui';

interface LoginResponse {
  tokens: Tokens;
  requiresTotpSetup: boolean;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/vendor/onboarding/status';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
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
      router.push(res.requiresTotpSetup ? '/account/2fa' : next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذّر تسجيل الدخول.';
      // الخادم يطلب رمز التحقق الثنائي للإدارة — الحقل يظهر عندها لا قبلها
      if (err instanceof ApiError && /التحقق|رمز/.test(message)) setNeedsTotp(true);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="stack stack--tight">
        <h1>تسجيل الدخول</h1>
        <p className="muted">ادخل إلى حسابك في بسطة.</p>
      </header>

      <Card>
        <form className="stack" onSubmit={submit} noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}

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
            label="كلمة المرور"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {needsTotp ? (
            <TextInput
              label="رمز التحقق الثنائي"
              hint="ستة أرقام من تطبيق المصادقة."
              inputMode="numeric"
              dir="ltr"
              maxLength={6}
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            />
          ) : null}

          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? 'جارٍ الدخول…' : 'دخول'}
          </button>
        </form>
      </Card>

      <p className="small muted">
        ما عندك حساب؟ <Link href="/register">أنشئ حساباً</Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="shell" />}>
      <LoginForm />
    </Suspense>
  );
}
