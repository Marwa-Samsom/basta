'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';
import { RecoveryCodes } from '@/components/recovery-codes';
import { Alert, TextInput } from '@/components/ui';
import { api } from '@/lib/api';

/** تحت هذا العدد من رموز الاستعادة يُنبَّه صاحب الحساب ليجدّدها قبل أن تنفد */
const LOW_CODES = 3;

/**
 * التحقق بخطوتين في صفحة الأمان — لكل الحسابات.
 *
 * التفعيل في صفحته (`/account/2fa`) لأنه يعرض مفتاحاً ويُبطل الجلسات. هنا ما
 * بعده: عدد رموز الاستعادة الباقية، وتجديدها، والتعطيل. التجديد والتعطيل
 * كلاهما يطلب إثباتاً ثانياً — والتعطيل كلمة المرور معه — فجلسة مسروقة
 * وحدها لا تنزع الحماية ولا تسرق رموزاً جديدة.
 */
export function TwoFactorCard({
  on,
  isAdmin,
  codesLeft,
  onChanged,
  returnTo = '/account',
}: {
  on: boolean;
  isAdmin: boolean;
  codesLeft: number;
  onChanged: () => void;
  /** إلى أين يعود صاحب الحساب بعد التفعيل (يدخل من جديد) */
  returnTo?: string;
}) {
  const t = useT();
  const [mode, setMode] = useState<'idle' | 'regen' | 'disable'>('idle');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = (next: typeof mode) => {
    setMode(next);
    setCode('');
    setPassword('');
    setError(null);
  };

  async function regenerate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ recoveryCodes: string[] }>('/auth/totp/recovery-codes', {
        method: 'POST',
        body: { code: code.trim() },
      });
      setCodes(res.recoveryCodes);
      reset('idle');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/totp/disable', { method: 'POST', body: { password, code: code.trim() } });
      reset('idle');
      setNotice(
        t(
          'عُطِّل التحقّق بخطوتين. حسابك يُفتح الآن بكلمة المرور وحدها.',
          'Two-step verification is off. Your account now opens with your password alone.',
        ),
      );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const codeField = (
    <TextInput
      label={t('رمز التطبيق أو رمز استعادة', 'App code or recovery code')}
      className="field__control ac-otp"
      autoComplete="one-time-code"
      spellCheck={false}
      dir="ltr"
      placeholder="000000"
      maxLength={11}
      required
      value={code}
      onChange={(e) => setCode(e.target.value.trim())}
    />
  );

  return (
    <section className="card id-card-start">
      <h2 className="id-card-title">{t('التحقّق بخطوتين', 'Two-step verification')}</h2>
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="id-tfa" data-on={on ? 'true' : undefined}>
        <Icon name="shield" size={20} />
        <span className="id-tfa__text">
          <span className="id-tfa__title">
            {on ? t('التحقّق بخطوتين مُفعَّل', 'Two-step verification is on') : t('التحقّق بخطوتين غير مُفعَّل', 'Two-step verification is off')}
          </span>
          <span className="id-tfa__body">
            {on
              ? isAdmin
                ? t('إلزامي لحسابات الإدارة ولا يمكن تعطيله.', "It's required for admin accounts and can't be turned off.")
                : t('الدخول يطلب رمزاً من تطبيق المصادقة مع كلمة المرور.', 'Signing in asks for a code from your authenticator app along with your password.')
              : t(
                  'فعّله ليطلب الدخول رمزاً من هاتفك مع كلمة المرور — فلا تكفي كلمة مرور مسروقة وحدها.',
                  "Turn it on so signing in asks for a code from your phone along with your password — a stolen password alone won't be enough.",
                )}
          </span>
        </span>
      </div>

      {!on ? (
        <Link href={`/account/2fa?next=${encodeURIComponent(returnTo)}`} className="btn btn--secondary id-fit">
          <Icon name="shield" size={16} />
          {t('فعّل التحقّق بخطوتين', 'Turn on two-step verification')}
        </Link>
      ) : codes ? (
        <RecoveryCodes
          codes={codes}
          doneLabel={t('تمّ', 'Done')}
          onDone={() => {
            setCodes(null);
            onChanged();
          }}
        />
      ) : (
        <>
          {codesLeft <= LOW_CODES ? (
            <Alert tone="warning" title={t('رموز الاستعادة قاربت على النفاد', 'Recovery codes are running low')}>
              {t(
                `الرموز الباقية: ${codesLeft}. أنشئ رموزاً جديدة قبل أن تحتاجها.`,
                `Codes left: ${codesLeft}. Create new ones before you need them.`,
              )}
            </Alert>
          ) : (
            <p className="id-note">{t(`رموز الاستعادة الباقية: ${codesLeft}`, `Recovery codes left: ${codesLeft}`)}</p>
          )}

          {error ? <Alert tone="danger">{error}</Alert> : null}

          {mode === 'regen' ? (
            <form className="stack" onSubmit={regenerate} noValidate>
              <p className="id-note">{t('الرموز الجديدة تُبطل كل الرموز القديمة، ولو لم تُستعمل.', 'New codes cancel all old codes, even unused ones.')}</p>
              {codeField}
              <div className="row">
                <button type="submit" className="btn btn--primary" disabled={busy || code.length < 6}>
                  {busy ? t('جارٍ الإنشاء…', 'Creating…') : t('أنشئ الرموز', 'Create codes')}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => reset('idle')}>
                  {t('إلغاء', 'Cancel')}
                </button>
              </div>
            </form>
          ) : mode === 'disable' ? (
            <form className="stack" onSubmit={disable} noValidate>
              <p className="id-note">
                {t('بعد التعطيل يُفتح حسابك بكلمة المرور وحدها، وتُمحى رموز الاستعادة.', 'Once turned off, your account opens with your password alone, and your recovery codes are deleted.')}
              </p>
              <TextInput
                label={t('كلمة المرور', 'Password')}
                type="password"
                autoComplete="current-password"
                dir="ltr"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {codeField}
              <div className="row">
                <button
                  type="submit"
                  className="btn btn--danger"
                  disabled={busy || !password || code.length < 6}
                >
                  <Icon name="lock" size={16} />
                  {busy ? t('جارٍ التعطيل…', 'Turning off…') : t('عطّل التحقّق بخطوتين', 'Turn off two-step verification')}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => reset('idle')}>
                  {t('إلغاء', 'Cancel')}
                </button>
              </div>
            </form>
          ) : (
            <div className="row">
              <button type="button" className="btn btn--secondary" onClick={() => reset('regen')}>
                <Icon name="refresh" size={16} />
                {t('أنشئ رموز استعادة جديدة', 'Create new recovery codes')}
              </button>
              <Link href={`/account/2fa?next=${encodeURIComponent(returnTo)}`} className="btn btn--secondary">
                <Icon name="shield" size={16} />
                {t('غيّر الجهاز', 'Change device')}
              </Link>
              {isAdmin ? null : (
                <button type="button" className="btn btn--danger" onClick={() => reset('disable')}>
                  {t('عطّل التحقّق بخطوتين', 'Turn off two-step verification')}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
