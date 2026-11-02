'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';
import { QrCode } from '@/components/qr-code';
import { digitsOnly } from '@/lib/digits';
import { RecoveryCodes } from '@/components/recovery-codes';
import { Alert, ClearableInput, Field, Spinner, TextInput } from '@/components/ui';
import { api, ApiError, session } from '@/lib/api';
import { internalPath } from '@/lib/safe-path';

const still = () => () => undefined;

/** مسار داخلي في الحساب أو لوحة البائع وحده — لا إعادة توجيه مفتوحة إلى موقع آخر */
function backFromUrl(): string {
  const next = internalPath(new URLSearchParams(window.location.search).get('next'));
  return next && /^\/(account|vendor)([/?]|$)/.test(next) ? next : '/account';
}

/**
 * تفعيل التحقق بخطوتين — AD-02 للإدارة (إلزامي، بلا «تخطٍّ»)، واختياري
 * لغيرها من صفحة الحساب.
 *
 * بعد التأكيد تُعرض رموز الاستعادة مرة واحدة، ثم تُبطَل الجلسات كلها فيدخل
 * صاحب الحساب من جديد بكلمة المرور والرمز معاً — فيرى أن الحماية تعمل.
 *
 * على تحقق مفعَّل يرفض الخادم البدء (409) فتعرض الصفحة «تغيير الجهاز»:
 * كلمة المرور ورمز من الجهاز الحالي، ثم المفتاح الجديد. القديم يبقى سارياً
 * حتى يُؤكَّد الجديد — فالصفحة المفتوحة لا تنزع الحماية.
 */
export default function TwoFactorSetupPage() {
  const t = useT();
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [admin, setAdmin] = useState(false);
  const [alreadyOn, setAlreadyOn] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  /** تغيير الجهاز على تحقق مفعَّل: إثبات الجهاز الحالي قبل أي مفتاح جديد */
  const [rotating, setRotating] = useState(false);
  const [proof, setProof] = useState({ password: '', code: '' });
  /** العودة لغير الإدارة: الحساب افتراضياً، أو إعدادات البائع إن جاء منها */
  const back = useSyncExternalStore(still, backFromUrl, () => '/account');
  /**
   * طلب التهيئة مرة واحدة للصفحة. كل طلب يكتب سرّاً منتظراً جديداً، ووضع React الصارم
   * يشغّل الأثر مرتين: كانت الصفحة ترسم سرّ الطلب الثاني والخادم قد يحفظ سرّ الأول
   * إن وصل بعده — فيُمسح رمز لا يُقبل رمزه. الطلب الواحد يخدم التشغيلتين.
   */
  const firstSetup = useRef<Promise<{ secret: string; uri: string }> | null>(null);

  useEffect(() => {
    if (!session.read()) {
      router.replace('/login?next=/account/2fa');
      return;
    }
    let alive = true;
    firstSetup.current ??= api<{ secret: string; uri: string }>('/auth/totp/setup', { method: 'POST' });
    firstSetup.current
      .then((s) => {
        if (!alive) return;
        setAdmin(session.roles().includes('admin'));
        setSetup(s);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setAdmin(session.roles().includes('admin'));
        if (e instanceof ApiError && e.status === 409) setAlreadyOn(true);
        else setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const beginRotation = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ secret: string; uri: string }>('/auth/totp/setup', {
        method: 'POST',
        body: { password: proof.password, code: proof.code.trim() },
      });
      setProof({ password: '', code: '' });
      setRotating(true);
      setAlreadyOn(false);
      setSetup(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ recoveryCodes: string[] }>('/auth/totp/confirm', {
        method: 'POST',
        body: { token: code.trim() },
      });
      setCodes(res.recoveryCodes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // الخادم أبطل الجلسات عند التأكيد — الدخول من جديد يُثبت أن الرمز صار مطلوباً
  const finish = () => {
    session.clear();
    router.replace(`/login?next=${encodeURIComponent(admin ? '/admin' : back)}`);
  };

  return (
    <main className="ac-auth">
      <div className="ac-auth__box ac-auth__box--xwide">
        <header className="ac-auth__head">
          <span className="ac-mark" aria-hidden>
            {t('ب', 'B')}
          </span>
          <h1 className="ac-auth__title">
            {alreadyOn || rotating
              ? t('تغيير جهاز التحقّق بخطوتين', 'Change your two-step verification device')
              : t('تفعيل التحقّق بخطوتين', 'Turn on two-step verification')}
          </h1>
        </header>

        {codes ? (
          <section className="ac-auth__card">
            <h2 className="ac-section-title">
              {rotating
                ? t('رُبط الجهاز الجديد', 'Your new device is linked')
                : t('فُعِّل التحقّق بخطوتين', 'Two-step verification is on')}
            </h2>
            <RecoveryCodes codes={codes} onDone={finish} doneLabel={t('تابع إلى تسجيل الدخول', 'Continue to sign in')} />
          </section>
        ) : alreadyOn ? (
          <form
            className="ac-auth__card"
            onSubmit={(e) => {
              e.preventDefault();
              void beginRotation();
            }}
          >
            <Alert tone="success" title={t('التحقّق بخطوتين مفعَّل على حسابك', 'Two-step verification is on for your account')}>
              {t(
                'لنقله إلى هاتف جديد أكّد أنك صاحب الحساب بكلمة المرور ورمز من الجهاز الحالي. يبقى الجهاز الحالي سارياً حتى تؤكّد الجديد.',
                "To move it to a new phone, confirm it's your account with your password and a code from your current device. Your current device keeps working until you confirm the new one.",
              )}
            </Alert>
            <TextInput
              label={t('كلمة المرور', 'Password')}
              type="password"
              autoComplete="current-password"
              dir="ltr"
              required
              value={proof.password}
              onChange={(e) => setProof((p) => ({ ...p, password: e.target.value }))}
            />
            <TextInput
              label={t('رمز من الجهاز الحالي أو رمز استعادة', 'Code from your current device, or a recovery code')}
              className="field__control ac-otp"
              autoComplete="one-time-code"
              dir="ltr"
              placeholder="000000"
              maxLength={11}
              required
              value={proof.code}
              onChange={(e) => setProof((p) => ({ ...p, code: e.target.value }))}
              error={error}
            />
            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={busy || !proof.password || proof.code.trim().length < 6}
            >
              {t('تابع إلى الجهاز الجديد', 'Continue to the new device')}
            </button>
            <Link
              href={admin ? '/admin' : back}
              className="btn btn--secondary btn--block ac-auth__cta"
            >
              {admin
                ? t('عُد إلى لوحة الإدارة', 'Back to the admin dashboard')
                : back.startsWith('/vendor')
                  ? t('عُد إلى الإعدادات', 'Back to settings')
                  : t('عُد إلى حسابي', 'Back to my account')}
            </Link>
          </form>
        ) : (
          <>
            {setup ? (
              rotating ? (
                <div className="alert alert--info ac-note">
                  <Icon name="shield" size={19} />
                  <span className="ac-note__text">
                    <span className="ac-note__title">
                      {t('أضف الحساب في تطبيق الهاتف الجديد', 'Add the account in the app on your new phone')}
                    </span>
                    <span className="ac-note__body">
                      {t(
                        'الجهاز القديم يبقى سارياً حتى تؤكّد برمز من الجديد. بعد التأكيد يتوقّف القديم، وتُستبدل رموز الاستعادة، وتُنهى كل الجلسات.',
                        'Your old device keeps working until you confirm with a code from the new one. After that, the old one stops, your recovery codes are replaced, and all sessions are signed out.',
                      )}
                    </span>
                  </span>
                </div>
              ) : admin ? (
                <div className="alert alert--warning ac-note">
                  <Icon name="lock" size={19} />
                  <span className="ac-note__text">
                    <span className="ac-note__title">
                      {t(
                        'فعّل التحقّق بخطوتين أولاً — إلزامي لحسابات الإدارة',
                        'Turn on two-step verification first — required for admin accounts',
                      )}
                    </span>
                    <span className="ac-note__body">
                      {t(
                        'لا يمكنك الوصول إلى أي شاشة قبل التفعيل. لا يوجد تخطٍّ.',
                        "You can't reach any screen until it's on. There's no skipping.",
                      )}
                    </span>
                  </span>
                </div>
              ) : (
                <div className="alert alert--info ac-note">
                  <Icon name="shield" size={19} />
                  <span className="ac-note__text">
                    <span className="ac-note__title">{t('طبقة حماية ثانية لحسابك', 'A second layer of protection for your account')}</span>
                    <span className="ac-note__body">
                      {t(
                        'بعد التفعيل يطلب الدخول رمزاً من هاتفك مع كلمة المرور، فلا تكفي كلمة مرور مسروقة وحدها.',
                        'Once on, signing in asks for a code from your phone along with your password, so a stolen password alone is not enough.',
                      )}
                    </span>
                  </span>
                </div>
              )
            ) : null}

            {!setup ? (
              error ? (
                <Alert tone="danger">{error}</Alert>
              ) : (
                <section className="ac-auth__card">
                  <Spinner label={t('جارٍ تجهيز المفتاح…', 'Preparing the key…')} />
                </section>
              )
            ) : (
              <section className="ac-auth__card">
                <h2 className="ac-section-title">{t('أضف حسابك في تطبيق المصادقة', 'Add your account to an authenticator app')}</h2>
                <p className="ac-help">
                  {t(
                    'افتح تطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو غيرهما) وامسح الرمز أدناه. على الهاتف نفسه يكفي أن تفتح',
                    'Open an authenticator app (Google Authenticator, Microsoft Authenticator or another) and scan the code below. On the same phone, just open',
                  )}{' '}
                  <a href={setup.uri} dir="ltr">
                    {t('هذا الرابط', 'this link')}
                  </a>
                  .
                </p>

                <div className="ac-group">
                  <span className="ac-group__label">{t('امسح الرمز بتطبيق المصادقة', 'Scan the code with your authenticator app')}</span>
                  {/* الرمز يحمل الرابط نفسه (otpauth) — بدل مفتاح يُنسخ حرفاً حرفاً */}
                  <QrCode
                    value={setup.uri}
                    label={t('رمز QR لإضافة الحساب في تطبيق المصادقة', 'QR code to add the account to your authenticator app')}
                  />
                </div>

                <Field label={t('أكّد بالرمز من التطبيق (ستة أرقام)', 'Confirm with the code from the app (six digits)')} error={error}>
                  {(props) => (
                    <div className="ac-inline">
                      <ClearableInput
                        className="field__control ac-otp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        dir="ltr"
                        placeholder="000000"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(digitsOnly(e.target.value))}
                        {...props}
                      />
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={busy || code.length !== 6}
                        onClick={() => void confirm()}
                      >
                        {t('تأكيد وتفعيل', 'Confirm and turn on')}
                      </button>
                    </div>
                  )}
                </Field>

                {rotating ? (
                  <Link href={admin ? '/admin' : back} className="ac-help">
                    {t('ألغِ — يبقى الجهاز الحالي كما هو', 'Cancel — keep your current device')}
                  </Link>
                ) : admin ? null : (
                  <Link href={back} className="ac-help">
                    {back.startsWith('/vendor')
                      ? t('ليس الآن — عُد إلى الإعدادات', 'Not now — back to settings')
                      : t('ليس الآن — عُد إلى حسابي', 'Not now — back to my account')}
                  </Link>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
