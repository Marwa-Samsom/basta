'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Card, Spinner, TextInput } from '@/components/ui';
import { api, session } from '@/lib/api';

/**
 * AD-02 — التحقق الثنائي الإلزامي للإدارة.
 *
 * الرمز المحدود لا يفتح إلا هذه الصفحة. بعد التأكيد تُبطَل الجلسة المحدودة،
 * فيدخل المدير من جديد بكلمة المرور والرمز معاً. **لا زرّ «تخطٍّ»**.
 */
export default function TwoFactorSetupPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session.read()) {
      router.replace('/login?next=/admin');
      return;
    }
    let alive = true;
    api<{ secret: string; uri: string }>('/auth/totp/setup', { method: 'POST' })
      .then((s) => alive && setSetup(s))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [router]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/totp/confirm', { method: 'POST', body: { token: code.trim() } });
      session.clear();
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell">
      <header className="stack stack--tight">
        <h1>فعّل التحقق الثنائي أولاً</h1>
        <p className="muted">إلزامي على حسابات الإدارة — لا يُفتح شيء في اللوحة قبله.</p>
      </header>

      {done ? (
        <Card>
          <Alert tone="success" title="فُعِّل التحقق الثنائي">
            ادخل الآن بكلمة المرور ورمز التطبيق معاً.
          </Alert>
          <button type="button" className="btn btn--primary" onClick={() => router.replace('/login?next=/admin')}>
            تسجيل الدخول
          </button>
        </Card>
      ) : !setup ? (
        error ? <Alert tone="danger">{error}</Alert> : <Spinner label="جارٍ تجهيز المفتاح…" />
      ) : (
        <Card>
          <ol className="stack">
            <li>
              افتح تطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو غيرهما) وأضف حساباً بالمفتاح أدناه.
              على الهاتف نفسه يكفي أن تفتح{' '}
              <a href={setup.uri} dir="ltr">
                هذا الرابط
              </a>
              .
            </li>
            <li>
              <span className="small muted">المفتاح السرّي — اكتبه في التطبيق كما هو:</span>
              <div className="row">
                <code className="num" dir="ltr" style={{ fontSize: '1.1rem', letterSpacing: '0.1em', wordBreak: 'break-all' }}>
                  {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
                </code>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void navigator.clipboard?.writeText(setup.secret)}>
                  نسخ
                </button>
              </div>
            </li>
            <li>
              <TextInput
                label="الرمز من التطبيق (ستة أرقام)"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </li>
          </ol>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <button type="button" className="btn btn--primary" disabled={busy || code.length !== 6} onClick={() => void confirm()}>
            تأكيد وتفعيل
          </button>
        </Card>
      )}
    </main>
  );
}
