'use client';

import '@/styles/screens/identity.css';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { Alert, PageHead, TextInput } from '@/components/ui';
import { api, session as tokens } from '@/lib/api';
import { SecurityPanel, SessionsPanel, type Profile } from '@/components/account-security';

type Tab = 'profile' | 'security' | 'sessions';
const TABS: { id: Tab; label: string; en: string }[] = [
  { id: 'profile', label: 'الملف الشخصي', en: 'Profile' },
  { id: 'security', label: 'الأمان', en: 'Security' },
  { id: 'sessions', label: 'الجلسات', en: 'Sessions' },
];

// ------------------------------------------------------------------ الملف

function ProfilePanel({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const t = useT();
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
      <h2 className="id-card-title">{t('البيانات الشخصية', 'Personal details')}</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved && !dirty ? (
        <Alert tone="success">{t('حُفظت بياناتك.', 'Your details were saved.')}</Alert>
      ) : null}

      <TextInput
        label={t('الاسم الكامل', 'Full name')}
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="field">
        <span className="field__label">{t('البريد الإلكتروني', 'Email')}</span>
        <div className="id-inline">
          <bdi dir="ltr" className="id-readonly">
            {profile.email ?? '—'}
          </bdi>
          <span className={`badge ${verified ? 'badge--success' : 'badge--warning'} id-badge`}>
            <Icon name={verified ? 'check-circle' : 'alert'} size={13} />
            {verified ? t('موثّق', 'Verified') : t('غير موثّق', 'Not verified')}
          </span>
        </div>
        {!verified && profile.email ? (
          <Link href="/verify?next=/account" className="btn btn--secondary btn--sm id-fit">
            {t('أرسل رمز التحقّق', 'Send verification code')}
          </Link>
        ) : null}
      </div>

      <TextInput
        label={t('رقم الجوال', 'Mobile number')}
        optional
        hint={t(
          'بصيغة دولية تبدأ بـ + ورمز الدولة. اتركه فارغاً لحذفه.',
          'In international format, starting with + and the country code. Leave it empty to remove it.',
        )}
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
          {busy ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ التغييرات', 'Save changes')}
        </button>
        {dirty ? (
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel} disabled={busy}>
              {t('تراجع', 'Cancel')}
            </button>
            <span className="id-dirty">{t('تغييرات غير محفوظة', 'Unsaved changes')}</span>
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
  const t = useT();
  const locale = useLocale();
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
    const forward = locale === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    const backward = locale === 'ar' ? 'ArrowRight' : 'ArrowLeft';
    const step = event.key === forward ? 1 : event.key === backward ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const nextIndex = (index + step + TABS.length) % TABS.length;
    setTab(TABS[nextIndex]!.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="id-account">
      <PageHead title={t('الحساب', 'Account')} />
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div
        className="tabs id-tabs"
        role="tablist"
        aria-label={t('أقسام الحساب', 'Account sections')}
      >
        {TABS.map((item, i) => (
          <button
            key={item.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={tab === item.id ? `panel-${item.id}` : undefined}
            tabIndex={tab === item.id ? 0 : -1}
            className="tabs__tab"
            onClick={() => setTab(item.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t(item.label, item.en)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {!profile && !error ? (
          <div className="card" role="status">
            <span className="skeleton id-skel" />
            <span className="visually-hidden">{t('جارٍ جلب حسابك…', 'Loading your account…')}</span>
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
