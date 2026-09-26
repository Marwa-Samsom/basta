'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Alert, PageHead, TextInput } from '@/components/ui';
import { api, session as tokens } from '@/lib/api';
import { when } from '@/lib/orders';
import { MIN_PASSWORD, NewPasswordField } from '../../reset/new-password-field';

interface Profile {
  id: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  totpEnabled: boolean;
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

type Tab = 'profile' | 'security' | 'sessions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'الملف الشخصي' },
  { id: 'security', label: 'الأمان' },
  { id: 'sessions', label: 'الجلسات' },
];

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

// ------------------------------------------------------------------ الملف

function ProfilePanel({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [name, setName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = name.trim() !== profile.fullName || phone.trim() !== (profile.phone ?? '');
  const verified = profile.emailVerifiedAt !== null;

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const p = await api<Profile>('/me/account', {
        method: 'PATCH',
        body: { fullName: name.trim(), phone: phone.trim() },
      });
      onSaved(p);
      setName(p.fullName);
      setPhone(p.phone ?? '');
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel(): void {
    setName(profile.fullName);
    setPhone(profile.phone ?? '');
    setError(null);
  }

  return (
    <form className="card id-profile" onSubmit={save} noValidate>
      <h2 className="id-card-title">البيانات الشخصية</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved && !dirty ? <Alert tone="success">حُفظت بياناتك.</Alert> : null}

      <TextInput
        label="الاسم الكامل"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="field">
        <span className="field__label">البريد الإلكتروني</span>
        <div className="id-inline">
          <bdi dir="ltr" className="id-readonly">
            {profile.email ?? '—'}
          </bdi>
          <span className={`badge ${verified ? 'badge--success' : 'badge--warning'} id-badge`}>
            <Icon name={verified ? 'check-circle' : 'alert'} size={13} />
            {verified ? 'موثّق' : 'غير موثّق'}
          </span>
        </div>
        {!verified && profile.email ? (
          <Link href="/verify?next=/account" className="btn btn--secondary btn--sm id-fit">
            أرسل رمز التحقّق
          </Link>
        ) : null}
      </div>

      <TextInput
        label="رقم الجوال"
        optional
        hint="بصيغة دولية تبدأ بـ + ورمز الدولة. اتركه فارغاً لحذفه."
        type="tel"
        dir="ltr"
        inputMode="tel"
        autoComplete="tel"
        className="field__control ac-mono"
        placeholder="+962790000000"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <div className="id-actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !dirty}>
          {busy ? 'جارٍ الحفظ…' : 'احفظ التغييرات'}
        </button>
        {dirty ? (
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel} disabled={busy}>
              تراجع
            </button>
            <span className="id-dirty">تغييرات غير محفوظة</span>
          </>
        ) : null}
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ الأمان

function SecurityPanel({ profile }: { profile: Profile }) {
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

  const on = profile.totpEnabled;
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

      {/*
        التحقق بخطوتين للإدارة وحدها: الدخول لا يطلب الرمز إلا من المدير، ولا طريق
        لاستعادة حساب عميل أضاع جهازه. عرضُه على العميل كان يوهمه بحماية لا وجود لها —
        تعميمه قرار معلَّق (docs/OPEN-ITEMS.md §1).
      */}
      {profile.isAdmin ? (
        <section className="card id-card-start">
          <h2 className="id-card-title">التحقّق بخطوتين</h2>
          <div className="id-tfa" data-on={on ? 'true' : undefined}>
            <Icon name="shield" size={20} />
            <span className="id-tfa__text">
              <span className="id-tfa__title">
                {on ? 'التحقّق بخطوتين مُفعَّل' : 'التحقّق بخطوتين غير مُفعَّل'}
              </span>
              <span className="id-tfa__body">
                {on
                  ? profile.isAdmin
                    ? 'إلزامي لحسابات الإدارة ولا يمكن تعطيله.'
                    : 'حسابك مربوط بتطبيق المصادقة على جهازك.'
                  : 'فعّله لتأمين حسابك برمز إضافي من تطبيق المصادقة.'}
              </span>
            </span>
          </div>
          {/* صفحة التهيئة تبدأ سرّاً جديداً وتوقف القديم حتى التأكيد — فلا رابط إليها والتحقق مفعَّل */}
          {on ? null : (
            <Link href="/account/2fa" className="btn btn--secondary id-fit">
              <Icon name="shield" size={16} />
              فعّل التحقّق بخطوتين
            </Link>
          )}
          <p className="id-note">إلزامي لحسابات الإدارة.</p>
        </section>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ الجلسات

function SessionsPanel() {
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

// ------------------------------------------------------------------ الصفحة

/**
 * ST-25 — الحساب: الملف، والأمان، والجلسات.
 *
 * كل ما هنا يخصّ صاحب الجلسة وحده — الخادم يقرأ المستخدم من رمزه لا من
 * الطلب. تأكيد البريد لا يحجب شيئاً؛ حالته هنا ورابطه إلى صفحة الرمز.
 */
export default function AccountPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!tokens.read()) {
      router.replace('/login?next=/account');
      return;
    }
    api<Profile>('/me/account')
      .then(setProfile)
      .catch((e: Error) => setError(e.message));
  }, [router]);

  function onTabKey(event: React.KeyboardEvent, index: number): void {
    // الأسهم بين التبويبات؛ الاتجاه البصري في RTL معكوس: اليسار هو «التالي»
    const step = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const nextIndex = (index + step + TABS.length) % TABS.length;
    setTab(TABS[nextIndex]!.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="id-account">
      <PageHead title="الحساب" />
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="tabs id-tabs" role="tablist" aria-label="أقسام الحساب">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={tab === t.id ? `panel-${t.id}` : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            className="tabs__tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {!profile && !error ? (
          <div className="card" role="status">
            <span className="skeleton id-skel" />
            <span className="visually-hidden">جارٍ جلب حسابك…</span>
          </div>
        ) : null}
        {profile && tab === 'profile' ? (
          <ProfilePanel profile={profile} onSaved={setProfile} />
        ) : null}
        {profile && tab === 'security' ? <SecurityPanel profile={profile} /> : null}
        {profile && tab === 'sessions' ? <SessionsPanel /> : null}
      </div>
    </div>
  );
}
