'use client';

import '@/styles/screens/identity.css';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { TwoFactorCard } from '@/components/two-factor-card';
import { Alert, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { when } from '@/lib/orders';
import { MIN_PASSWORD, NewPasswordField } from '@/app/reset/new-password-field';

/**
 * الأمان والجلسات — مشتركة بين صفحة الحساب (ST-25) وإعدادات البائع (VD-20).
 * كلٌّ يخصّ صاحب الجلسة وحده: الخادم يقرأ المستخدم من رمزه لا من الطلب.
 */

export interface Profile {
  id: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  totpEnabled: boolean;
  recoveryCodesLeft: number;
  isAdmin: boolean;
  createdAt: string;
}

interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  signedInAt: string;
  lastActiveAt: string;
  current: boolean;
}

/** اسم مفهوم للجهاز من ترويسة المتصفّح — «Chrome على Windows» لا سلسلة خام */
function deviceName(ua: string | null, locale: Locale = 'ar'): string {
  if (!ua) return locale === 'en' ? 'Unknown device' : 'جهاز غير معروف';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (browser && os) return locale === 'en' ? `${browser} on ${os}` : `${browser} على ${os}`;
  return browser ?? os ?? (locale === 'en' ? 'Unknown browser' : 'متصفّح غير معروف');
}

/** «٣ جلسات» بالعربية الصحيحة للعدد */
const countSessions = (n: number, locale: Locale = 'ar'): string =>
  locale === 'en'
    ? `${n} ${n === 1 ? 'session' : 'sessions'}`
    : n === 1
      ? 'جلسة واحدة'
      : n === 2
        ? 'جلستان'
        : n >= 3 && n <= 10
          ? `${n} جلسات`
          : `${n} جلسة`;

// ------------------------------------------------------------------ الأمان

export function SecurityPanel({
  profile,
  onChanged,
  returnTo,
}: {
  profile: Profile;
  onChanged: () => void;
  returnTo?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ready = current.length > 0 && next.length >= MIN_PASSWORD;

  async function change(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ revokedSessions: number; currentKept: boolean }>(
        '/me/account/password',
        {
          method: 'POST',
          body: { currentPassword: current, newPassword: next },
        },
      );
      setCurrent('');
      setNext('');
      setDone(
        r.currentKept
          ? r.revokedSessions > 0
            ? t(
                `حُدّثت كلمة المرور، وأُنهيت الجلسات على الأجهزة الأخرى (${countSessions(r.revokedSessions)}).`,
                `Password updated, and sessions on other devices were ended (${countSessions(r.revokedSessions, locale)}).`,
              )
            : t('حُدّثت كلمة المرور. لا جلسات أخرى مفتوحة.', 'Password updated. No other sessions are open.')
          : t(
              'حُدّثت كلمة المرور وأُنهيت كل الجلسات. ادخل من جديد على هذا الجهاز حين تنتهي جلستك.',
              'Password updated and all sessions were ended. Sign in again on this device when your session ends.',
            ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-2 id-security">
      <form className="card" onSubmit={change} noValidate>
        <h2 className="id-card-title">{t('تغيير كلمة المرور', 'Change password')}</h2>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
        <TextInput
          label={t('كلمة المرور الحالية', 'Current password')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <NewPasswordField label={t('كلمة المرور الجديدة', 'New password')} value={next} onChange={setNext} />
        <button type="submit" className="btn btn--primary id-fit" disabled={busy || !ready}>
          {busy ? t('جارٍ التحديث…', 'Updating…') : t('حدّث كلمة المرور', 'Update password')}
        </button>
        <p className="id-note">{t('تحديث كلمة المرور ينهي كل الجلسات الأخرى على الأجهزة الأخرى.', 'Updating your password ends all other sessions on other devices.')}</p>
      </form>

      <TwoFactorCard
        on={profile.totpEnabled}
        isAdmin={profile.isAdmin}
        codesLeft={profile.recoveryCodesLeft}
        onChanged={onChanged}
        {...(returnTo ? { returnTo } : {})}
      />
    </div>
  );
}

// ------------------------------------------------------------------ الجلسات

export function SessionsPanel() {
  const t = useT();
  const locale = useLocale();
  const [items, setItems] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ items: Session[] }>('/me/account/sessions')
      .then((d) => setItems(d.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function revoke(s: Session): Promise<void> {
    setBusy(s.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/me/account/sessions/${s.id}`, { method: 'DELETE' });
      setNotice(t(`أُنهيت الجلسة على ${deviceName(s.userAgent)}.`, `Ended the session on ${deviceName(s.userAgent, locale)}.`));
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers(): Promise<void> {
    setBusy('others');
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ revokedSessions: number }>('/me/account/sessions/revoke-others', {
        method: 'POST',
      });
      setNotice(
        r.revokedSessions > 0
          ? t(
              `أُنهيت كل الجلسات الأخرى (${countSessions(r.revokedSessions)}).`,
              `Ended all other sessions (${countSessions(r.revokedSessions, locale)}).`,
            )
          : t('لا جلسات أخرى لإنهائها.', 'No other sessions to end.'),
      );
      setConfirming(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const others = items?.filter((s) => !s.current).length ?? 0;

  return (
    <section className="card card--flush" aria-labelledby="sessions-title">
      <div className="card__head">
        <h2 id="sessions-title" className="id-card-title">
          {t('الجلسات النشطة', 'Active sessions')}
        </h2>
        {items ? <span className="id-count">{countSessions(items.length, locale)}</span> : null}
        <button
          type="button"
          className="btn btn--danger btn--sm id-end"
          onClick={() => setConfirming(true)}
          disabled={others === 0 || confirming || busy !== null}
        >
          <Icon name="x" size={14} />
          {t('أنهِ كل الجلسات الأخرى', 'End all other sessions')}
        </button>
      </div>

      {confirming ? (
        <div className="id-confirm" role="group" aria-labelledby="confirm-text">
          <span id="confirm-text">
            {t(
              `ستُنهى ${countSessions(others)} على أجهزة أخرى، ويلزمها الدخول من جديد. جلستك هذه تبقى.`,
              `${countSessions(others, locale)} on other devices will be ended and will need to sign in again. This session stays.`,
            )}
          </span>
          <span className="id-confirm__actions">
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => void revokeOthers()}
              disabled={busy !== null}
            >
              {busy === 'others' ? t('جارٍ الإنهاء…', 'Ending…') : t('نعم، أنهِها', 'Yes, end them')}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
            >
              {t('إلغاء', 'Cancel')}
            </button>
          </span>
        </div>
      ) : null}

      <div aria-live="polite">{notice ? <p className="id-notice">{notice}</p> : null}</div>
      {error ? (
        <div className="id-pad">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {!items && !error ? (
        <div className="id-pad" role="status">
          <span className="skeleton id-skel" />
          <span className="visually-hidden">{t('جارٍ جلب الجلسات…', 'Loading sessions…')}</span>
        </div>
      ) : null}

      {items?.map((s) => (
        <div key={s.id} className="id-session" data-current={s.current ? 'true' : undefined}>
          <span className="id-session__icon" aria-hidden>
            <Icon name="device" size={19} />
          </span>
          <span className="id-session__main">
            <span className="id-session__name">
              {deviceName(s.userAgent, locale)}
              {s.current ? <span className="badge badge--success">{t('هذا الجهاز', 'This device')}</span> : null}
            </span>
            <span className="id-session__meta">
              {s.ip ? (
                <>
                  <bdi dir="ltr" className="num">
                    {s.ip}
                  </bdi>
                  {' · '}
                </>
              ) : null}
              {t(
                `آخر نشاط ${when(s.lastActiveAt)} · منذ الدخول ${when(s.signedInAt)}`,
                `Last active ${when(s.lastActiveAt, locale)} · signed in ${when(s.signedInAt, locale)}`,
              )}
            </span>
          </span>
          {s.current ? null : (
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => void revoke(s)}
              disabled={busy !== null}
              aria-label={t(`أنهِ الجلسة على ${deviceName(s.userAgent)}`, `End the session on ${deviceName(s.userAgent, locale)}`)}
            >
              <Icon name="x" size={14} />
              {busy === s.id ? t('جارٍ الإنهاء…', 'Ending…') : t('أنهِ الجلسة', 'End session')}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
