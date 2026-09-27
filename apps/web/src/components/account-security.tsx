'use client';

import '@/styles/screens/identity.css';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { TwoFactorCard } from '@/components/two-factor-card';
import { Alert, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
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
function deviceName(ua: string | null): string {
  if (!ua) return 'جهاز غير معروف';
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
  if (browser && os) return `${browser} على ${os}`;
  return browser ?? os ?? 'متصفّح غير معروف';
}

/** «٣ جلسات» بالعربية الصحيحة للعدد */
const countSessions = (n: number): string =>
  n === 1 ? 'جلسة واحدة' : n === 2 ? 'جلستان' : n >= 3 && n <= 10 ? `${n} جلسات` : `${n} جلسة`;

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
            ? `حُدّثت كلمة المرور، وأُنهيت الجلسات على الأجهزة الأخرى (${countSessions(r.revokedSessions)}).`
            : 'حُدّثت كلمة المرور. لا جلسات أخرى مفتوحة.'
          : 'حُدّثت كلمة المرور وأُنهيت كل الجلسات. ادخل من جديد على هذا الجهاز حين تنتهي جلستك.',
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
        <h2 className="id-card-title">تغيير كلمة المرور</h2>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
        <TextInput
          label="كلمة المرور الحالية"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <NewPasswordField label="كلمة المرور الجديدة" value={next} onChange={setNext} />
        <button type="submit" className="btn btn--primary id-fit" disabled={busy || !ready}>
          {busy ? 'جارٍ التحديث…' : 'حدّث كلمة المرور'}
        </button>
        <p className="id-note">تحديث كلمة المرور ينهي كل الجلسات الأخرى على الأجهزة الأخرى.</p>
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
      setNotice(`أُنهيت الجلسة على ${deviceName(s.userAgent)}.`);
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
          ? `أُنهيت كل الجلسات الأخرى (${countSessions(r.revokedSessions)}).`
          : 'لا جلسات أخرى لإنهائها.',
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
          الجلسات النشطة
        </h2>
        {items ? <span className="id-count">{countSessions(items.length)}</span> : null}
        <button
          type="button"
          className="btn btn--danger btn--sm id-end"
          onClick={() => setConfirming(true)}
          disabled={others === 0 || confirming || busy !== null}
        >
          <Icon name="x" size={14} />
          أنهِ كل الجلسات الأخرى
        </button>
      </div>

      {confirming ? (
        <div className="id-confirm" role="group" aria-labelledby="confirm-text">
          <span id="confirm-text">
            ستُنهى {countSessions(others)} على أجهزة أخرى، ويلزمها الدخول من جديد. جلستك هذه تبقى.
          </span>
          <span className="id-confirm__actions">
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => void revokeOthers()}
              disabled={busy !== null}
            >
              {busy === 'others' ? 'جارٍ الإنهاء…' : 'نعم، أنهِها'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
            >
              إلغاء
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
          <span className="visually-hidden">جارٍ جلب الجلسات…</span>
        </div>
      ) : null}

      {items?.map((s) => (
        <div key={s.id} className="id-session" data-current={s.current ? 'true' : undefined}>
          <span className="id-session__icon" aria-hidden>
            <Icon name="device" size={19} />
          </span>
          <span className="id-session__main">
            <span className="id-session__name">
              {deviceName(s.userAgent)}
              {s.current ? <span className="badge badge--success">هذا الجهاز</span> : null}
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
              آخر نشاط {when(s.lastActiveAt)} · منذ الدخول {when(s.signedInAt)}
            </span>
          </span>
          {s.current ? null : (
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => void revoke(s)}
              disabled={busy !== null}
              aria-label={`أنهِ الجلسة على ${deviceName(s.userAgent)}`}
            >
              <Icon name="x" size={14} />
              {busy === s.id ? 'جارٍ الإنهاء…' : 'أنهِ الجلسة'}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
