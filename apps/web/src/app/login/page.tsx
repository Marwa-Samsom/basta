'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, ApiError, session, type Tokens } from '@/lib/api';
import { Icon } from '@/components/icons';
import { Field, TextInput } from '@/components/ui';
import { homeFor, internalPath, withNext } from '@/lib/safe-path';

interface LoginResponse {
  tokens: Tokens;
  requiresTotpSetup: boolean;
}

/**
 * حقل كلمة المرور بزرّ إظهار في طرفه (التصميم). اسم الزرّ لا يحوي «كلمة المرور»
 * عمداً: البحث بالتسمية «كلمة المرور» يجب أن يجد الحقل وحده.
 */
function PasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Field label="كلمة المرور">
      {(props) => (
        <span className="ac-pw">
          <input
            className="field__control"
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            dir="ltr"
            required
            value={value}
            onChange={(e) => onChange(e.target.value)}
            {...props}
          />
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
      )}
    </Field>
  );
}

/**
 * SH-01 — الدخول، ويخدم دخول الإدارة AD-01 حين يكون `next` تحت /admin.
 *
 * الإدارة خطوتان كما في التصميم: البيانات، ثم رمز التحقق حين يطلبه الخادم.
 * في الخطوة الثانية يختفي البريد وكلمة المرور من العرض لا من الحالة — الطلب
 * الثاني يرسل الثلاثة معاً كما كان.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // الوجهة من الرابط: مسار داخلي وإلا فلا — لا `?next=https://…` يخرج بالمستخدم بعد الدخول.
  // بلا وجهة يقرّرها الدور بعد الدخول (homeFor)، لا وجهة ثابتة واحدة للجميع
  const next = internalPath(params.get('next'));
  const isAdmin = next?.startsWith('/admin') ?? false;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
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
      router.push(res.requiresTotpSetup ? '/account/2fa' : (next ?? homeFor(session.roles())));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذّر تسجيل الدخول.';
      // الخادم يطلب رمز التحقق الثنائي ممّن فعّله — الحقل يظهر عندها لا قبلها.
      // أول طلب للرمز ليس خطأً بل خطوة: يشرحها شريط المعلومات لا تنبيه أحمر.
      if (err instanceof ApiError && /التحقق|رمز/.test(message)) {
        const firstAsk = !needsTotp;
        setNeedsTotp(true);
        setError(firstAsk ? null : message);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  function back(): void {
    setNeedsTotp(false);
    setUseRecovery(false);
    setTotp('');
    setError(null);
  }

  const sub = isAdmin
    ? needsTotp
      ? 'اكتب الرمز من تطبيق المصادقة.'
      : 'خطوتان: بياناتك ثم رمز التحقّق.'
    : 'تابع طلباتك من أي جهاز.';

  return (
    <main className="ac-auth">
      <div className="ac-auth__box">
        <header className="ac-auth__head">
          {isAdmin ? (
            <Link href="/" className="ac-mark" aria-label="بسطة — الرئيسية">
              ب
            </Link>
          ) : (
            <Link href="/" className="ac-wordmark">
              بسطة
            </Link>
          )}
          <h1 className="ac-auth__title">{isAdmin ? 'دخول لوحة الإدارة' : 'ادخل إلى حسابك'}</h1>
          <p className="ac-auth__sub">{sub}</p>
        </header>

        <form className="ac-auth__card" onSubmit={submit} noValidate>
          {error ? (
            <div className="alert alert--danger ac-note" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          {needsTotp ? (
            <>
              <div className="alert alert--info ac-note" role="status">
                <Icon name="shield" size={16} />
                <span>
                  {isAdmin ? 'رمز التحقّق بخطوتين إلزامي لحسابات الإدارة' : 'حسابك محمي بالتحقّق بخطوتين'}
                </span>
              </div>
              {useRecovery ? (
                <TextInput
                  label="رمز الاستعادة"
                  hint="أحد الرموز العشرة التي حفظتها عند التفعيل — كلٌّ يُستعمل مرة واحدة."
                  className="field__control ac-otp"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  dir="ltr"
                  placeholder="XXXXX-XXXXX"
                  maxLength={11}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.trim())}
                />
              ) : (
                <TextInput
                  label="رمز التحقق الثنائي"
                  hint="ستة أرقام من تطبيق المصادقة."
                  className="field__control ac-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  placeholder="000000"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                />
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm ac-fit"
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setTotp('');
                  setError(null);
                }}
              >
                {useRecovery ? 'استعمل رمز التطبيق' : 'أضعت هاتفك؟ استعمل رمز استعادة'}
              </button>
            </>
          ) : (
            <>
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
              <PasswordField value={password} onChange={setPassword} />
              {/* رابط لا تسمية: البحث بالتسمية «كلمة المرور» يبقى يجد الحقل وحده */}
              <Link href={withNext('/forgot', next)} className="id-forgot">
                نسيت كلمة المرور؟
              </Link>
            </>
          )}

          <button className="btn btn--primary btn--block ac-auth__cta" type="submit" disabled={busy}>
            {busy ? 'جارٍ الدخول…' : 'دخول'}
          </button>

          {needsTotp ? (
            <button type="button" className="ac-link-btn" onClick={back}>
              رجوع
            </button>
          ) : null}
        </form>

        {isAdmin ? null : (
          <p className="ac-auth__foot">
            <span>ليس لديك حساب؟</span>
            <Link href={withNext('/register', next)}>أنشئ حساباً</Link>
          </p>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="ac-auth" />}>
      <LoginForm />
    </Suspense>
  );
}
