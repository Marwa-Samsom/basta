'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/icons';
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
      setNotice('عُطِّل التحقّق بخطوتين. حسابك يُفتح الآن بكلمة المرور وحدها.');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const codeField = (
    <TextInput
      label="رمز التطبيق أو رمز استعادة"
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
      <h2 className="id-card-title">التحقّق بخطوتين</h2>
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="id-tfa" data-on={on ? 'true' : undefined}>
        <Icon name="shield" size={20} />
        <span className="id-tfa__text">
          <span className="id-tfa__title">{on ? 'التحقّق بخطوتين مُفعَّل' : 'التحقّق بخطوتين غير مُفعَّل'}</span>
          <span className="id-tfa__body">
            {on
              ? isAdmin
                ? 'إلزامي لحسابات الإدارة ولا يمكن تعطيله.'
                : 'الدخول يطلب رمزاً من تطبيق المصادقة مع كلمة المرور.'
              : 'فعّله ليطلب الدخول رمزاً من هاتفك مع كلمة المرور — فلا تكفي كلمة مرور مسروقة وحدها.'}
          </span>
        </span>
      </div>

      {!on ? (
        <Link href={`/account/2fa?next=${encodeURIComponent(returnTo)}`} className="btn btn--secondary id-fit">
          <Icon name="shield" size={16} />
          فعّل التحقّق بخطوتين
        </Link>
      ) : codes ? (
        <RecoveryCodes
          codes={codes}
          doneLabel="تمّ"
          onDone={() => {
            setCodes(null);
            onChanged();
          }}
        />
      ) : (
        <>
          {codesLeft <= LOW_CODES ? (
            <Alert tone="warning" title="رموز الاستعادة قاربت على النفاد">
              الرموز الباقية: {codesLeft}. أنشئ رموزاً جديدة قبل أن تحتاجها.
            </Alert>
          ) : (
            <p className="id-note">رموز الاستعادة الباقية: {codesLeft}</p>
          )}

          {error ? <Alert tone="danger">{error}</Alert> : null}

          {mode === 'regen' ? (
            <form className="stack" onSubmit={regenerate} noValidate>
              <p className="id-note">الرموز الجديدة تُبطل كل الرموز القديمة، ولو لم تُستعمل.</p>
              {codeField}
              <div className="row">
                <button type="submit" className="btn btn--primary" disabled={busy || code.length < 6}>
                  {busy ? 'جارٍ الإنشاء…' : 'أنشئ الرموز'}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => reset('idle')}>
                  إلغاء
                </button>
              </div>
            </form>
          ) : mode === 'disable' ? (
            <form className="stack" onSubmit={disable} noValidate>
              <p className="id-note">بعد التعطيل يُفتح حسابك بكلمة المرور وحدها، وتُمحى رموز الاستعادة.</p>
              <TextInput
                label="كلمة المرور"
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
                  {busy ? 'جارٍ التعطيل…' : 'عطّل التحقّق بخطوتين'}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => reset('idle')}>
                  إلغاء
                </button>
              </div>
            </form>
          ) : (
            <div className="row">
              <button type="button" className="btn btn--secondary" onClick={() => reset('regen')}>
                <Icon name="refresh" size={16} />
                أنشئ رموز استعادة جديدة
              </button>
              {isAdmin ? null : (
                <button type="button" className="btn btn--danger" onClick={() => reset('disable')}>
                  عطّل التحقّق بخطوتين
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
