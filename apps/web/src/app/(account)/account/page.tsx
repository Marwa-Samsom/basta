'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Alert, PageHead, TextInput } from '@/components/ui';
import { api, session as tokens } from '@/lib/api';
import { SecurityPanel, SessionsPanel, type Profile } from '@/components/account-security';

type Tab = 'profile' | 'security' | 'sessions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'الملف الشخصي' },
  { id: 'security', label: 'الأمان' },
  { id: 'sessions', label: 'الجلسات' },
];

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
        {profile && tab === 'security' ? (
          <SecurityPanel
            profile={profile}
            onChanged={() => {
              api<Profile>('/me/account')
                .then(setProfile)
                .catch((e: Error) => setError(e.message));
            }}
          />
        ) : null}
        {profile && tab === 'sessions' ? <SessionsPanel /> : null}
      </div>
    </div>
  );
}
