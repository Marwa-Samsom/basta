'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Alert, Field, Spinner } from '@/components/ui';
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
  const [copied, setCopied] = useState(false);

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

  const copy = (secret: string) => {
    void navigator.clipboard?.writeText(secret).then(() => setCopied(true));
  };

  return (
    <main className="ac-auth">
      <div className="ac-auth__box ac-auth__box--xwide">
        <header className="ac-auth__head">
          <span className="ac-mark" aria-hidden>
            ب
          </span>
          <h1 className="ac-auth__title">تفعيل التحقّق بخطوتين</h1>
        </header>

        {done ? (
          <section className="ac-auth__card">
            <Alert tone="success" title="فُعِّل التحقق الثنائي">
              ادخل الآن بكلمة المرور ورمز التطبيق معاً.
            </Alert>
            <button
              type="button"
              className="btn btn--primary btn--block ac-auth__cta"
              onClick={() => router.replace('/login?next=/admin')}
            >
              تسجيل الدخول
            </button>
          </section>
        ) : (
          <>
            <div className="alert alert--warning ac-note">
              <Icon name="lock" size={19} />
              <span className="ac-note__text">
                <span className="ac-note__title">فعّل التحقّق بخطوتين أولاً — إلزامي لحسابات الإدارة</span>
                <span className="ac-note__body">لا يمكنك الوصول إلى أي شاشة قبل التفعيل. لا يوجد تخطٍّ.</span>
              </span>
            </div>

            {!setup ? (
              error ? (
                <Alert tone="danger">{error}</Alert>
              ) : (
                <section className="ac-auth__card">
                  <Spinner label="جارٍ تجهيز المفتاح…" />
                </section>
              )
            ) : (
              <section className="ac-auth__card">
                <h2 className="ac-section-title">أضف حسابك في تطبيق المصادقة</h2>
                <p className="ac-help">
                  افتح تطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو غيرهما) وأضف حساباً
                  بالمفتاح أدناه. على الهاتف نفسه يكفي أن تفتح{' '}
                  <a href={setup.uri} dir="ltr">
                    هذا الرابط
                  </a>
                  .
                </p>

                <div className="ac-group">
                  <span className="ac-group__label">المفتاح السرّي — اكتبه في التطبيق كما هو</span>
                  <div className="ac-inline">
                    <code className="ac-secret num">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="انسخ المفتاح"
                      onClick={() => copy(setup.secret)}
                    >
                      <Icon name={copied ? 'check' : 'copy'} size={17} />
                    </button>
                  </div>
                  {copied ? (
                    <span className="ac-copied" role="status">
                      نُسخ المفتاح.
                    </span>
                  ) : null}
                </div>

                <Field label="أكّد بالرمز من التطبيق (ستة أرقام)" error={error}>
                  {(props) => (
                    <div className="ac-inline">
                      <input
                        className="field__control ac-otp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        dir="ltr"
                        placeholder="000000"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                        {...props}
                      />
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={busy || code.length !== 6}
                        onClick={() => void confirm()}
                      >
                        تأكيد وتفعيل
                      </button>
                    </div>
                  )}
                </Field>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
