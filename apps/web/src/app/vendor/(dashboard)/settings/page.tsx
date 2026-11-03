'use client';

import '@/styles/screens/vendor-extra.css';
import '@/styles/screens/vendor-settings.css';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SecurityPanel, SessionsPanel, type Profile } from '@/components/account-security';
import { Icon, type IconName } from '@/components/icons';
import { Alert, PageHead, Spinner, TextInput } from '@/components/ui';
import { api, session } from '@/lib/api';
import { useReturnTick } from '@/lib/fresh';
import { CURRENCIES, useOnboarding } from '@/lib/vendor';
import { useLocale, useT } from '@/components/locale';
import type { Locale } from '@/lib/i18n';

type Tab = 'security' | 'banks' | 'notifs' | 'currency';
const TABS: { id: Tab; label: string; en: string; icon: IconName }[] = [
  { id: 'security', label: 'الحساب والأمان', en: 'Account and security', icon: 'shield' },
  { id: 'banks', label: 'الحسابات البنكية', en: 'Bank accounts', icon: 'wallet' },
  { id: 'notifs', label: 'الإشعارات', en: 'Notifications', icon: 'bell' },
  { id: 'currency', label: 'عملة التسوية', en: 'Settlement currency', icon: 'lock' },
];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.id === v);

/** قيم المتصفّح (الرمز والرابط) تُقرأ بلا اشتراك: لا تتغيّر أثناء بقاء الصفحة */
const still = () => () => undefined;
const tabFromUrl = (): Tab => {
  const q = new URLSearchParams(window.location.search).get('tab');
  return isTab(q) ? q : 'security';
};

// ------------------------------------------------------------ الأمان

function SecurityTab() {
  const t = useT();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Profile>('/me/account')
      .then(setProfile)
      .catch((e: Error) => setError(e.message));
  }, []);
  const returned = useReturnTick();
  useEffect(load, [load, returned]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!profile) return <Spinner label={t('جارٍ جلب حسابك…', 'Loading your account…')} />;
  return (
    <>
      <SecurityPanel profile={profile} onChanged={load} returnTo="/vendor/settings?tab=security" />
      <SessionsPanel />
    </>
  );
}

// -------------------------------------------------- الحسابات البنكية

interface Bank {
  id: string;
  bankName: string;
  holderName: string;
  ibanMasked: string;
  isDefault: boolean;
  verified: boolean;
}

const EMPTY_FORM = { holderName: '', iban: '', bankName: '', swift: '', password: '', code: '' };

function BanksTab() {
  const t = useT();
  const owner = useSyncExternalStore(still, () => session.roles().includes('vendor_owner'), () => false);
  const [items, setItems] = useState<Bank[] | null>(null);
  const [totp, setTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const returned = useReturnTick();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!owner) return;
    api<{ items: Bank[] }>('/vendor/bank-accounts')
      .then((d) => setItems(d.items))
      .catch((e: Error) => setError(e.message));
    api<Profile>('/me/account')
      .then((p) => setTotp(p.totpEnabled))
      .catch(() => undefined);
  }, [owner, returned]);

  if (!owner) {
    return (
      <section className="vx-card">
        <h2 className="vx-card__title">{t('الحسابات البنكية', 'Bank accounts')}</h2>
        <p className="vx-hint">
          <Icon name="lock" size={14} />
          {t('يديرها صاحب المتجر وحده — هي وجهة أموال المتجر.', "Only the shop owner manages them — they are where the shop's money goes.")}
        </p>
      </section>
    );
  }

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function run(key: string, fn: () => Promise<void>): Promise<void> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    void run('add', async () => {
      const created = await api<Bank>('/vendor/bank-accounts', {
        method: 'POST',
        body: {
          holderName: form.holderName.trim(),
          iban: form.iban.trim(),
          bankName: form.bankName.trim(),
          ...(form.swift.trim() ? { swift: form.swift.trim() } : {}),
          password: form.password,
          ...(totp ? { code: form.code.trim() } : {}),
        },
      });
      setItems((prev) => [...(prev ?? []), created]);
      setForm(EMPTY_FORM);
      setAdding(false);
      setNotice(
        t(
          'أُضيف الحساب وأُرسل بريد تنبيه إلى صاحب المتجر. يصير قابلاً للتحويل بعد أن يوثّقه فريق بسطة.',
          'Account added and an alert email sent to the shop owner. It can receive payouts once the Basta team verifies it.',
        ),
      );
    });
  };

  const ready =
    form.holderName.trim().length >= 3 &&
    form.iban.trim().length >= 15 &&
    form.bankName.trim().length >= 2 &&
    form.password.length > 0 &&
    (!totp || form.code.trim().length >= 6);

  return (
    <section className="vx-card" aria-labelledby="banks-title">
      <div className="vx-card__head">
        <h2 id="banks-title" className="vx-card__title">
          {t('الحسابات البنكية', 'Bank accounts')}
        </h2>
        {adding ? null : (
          <span className="vx-card__end">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              {t('أضف حساباً', 'Add account')}
            </button>
          </span>
        )}
      </div>

      <div aria-live="polite">{notice ? <Alert tone="success">{notice}</Alert> : null}</div>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!items && !error ? <Spinner label={t('جارٍ جلب الحسابات…', 'Loading accounts…')} /> : null}
      {items ? (
        <ul className="vs-banks">
          {items.map((b) => (
            <li key={b.id} className={`vs-bank${b.isDefault ? ' vs-bank--default' : ''}`}>
              <span className="vs-bank__icon" aria-hidden>
                <Icon name="wallet" size={17} />
              </span>
              <span className="vs-bank__main">
                <span className="vs-bank__name">
                  {b.bankName}
                  {b.isDefault ? <span className="badge badge--brand">{t('الافتراضي', 'Default')}</span> : null}
                </span>
                <bdi dir="ltr" className="vs-bank__iban">
                  {b.ibanMasked}
                </bdi>
                <span className="vs-bank__holder">{b.holderName}</span>
              </span>
              <span className={`badge ${b.verified ? 'badge--success' : 'badge--warning'}`}>
                {b.verified ? t('موثّق', 'Verified') : t('قيد التوثيق', 'Pending verification')}
              </span>
              <span className="vs-bank__actions">
                {!b.isDefault && b.verified ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`default-${b.id}`, async () => {
                        const d = await api<{ items: Bank[] }>(`/vendor/bank-accounts/${b.id}/default`, { method: 'POST' });
                        setItems(d.items);
                        setNotice(t(`صار حساب ${b.bankName} وجهة التحويلات.`, `${b.bankName} is now where payouts go.`));
                      })
                    }
                  >
                    {t('اجعله الافتراضي', 'Make default')}
                  </button>
                ) : null}
                {!b.isDefault && confirmArchive !== b.id ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy !== null}
                    aria-label={t(`أرشف حساب ${b.bankName}`, `Archive ${b.bankName} account`)}
                    onClick={() => setConfirmArchive(b.id)}
                  >
                    <Icon name="trash" size={14} />
                    {t('أرشف', 'Archive')}
                  </button>
                ) : null}
              </span>
              {confirmArchive === b.id ? (
                <span className="vs-confirm" role="group" aria-label={t('تأكيد الأرشفة', 'Confirm archiving')}>
                  {t(
                    'لا يُحوَّل إلى هذا الحساب بعد الأرشفة، ويبقى في سجلّ التحويلات السابقة.',
                    'No payouts go to this account once archived; it stays in the history of past payouts.',
                  )}
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`archive-${b.id}`, async () => {
                        const d = await api<{ items: Bank[] }>(`/vendor/bank-accounts/${b.id}`, { method: 'DELETE' });
                        setItems(d.items);
                        setConfirmArchive(null);
                        setNotice(t(`أُرشف حساب ${b.bankName}.`, `${b.bankName} account archived.`));
                      })
                    }
                  >
                    {t('نعم، أرشفه', 'Yes, archive it')}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmArchive(null)}>
                    {t('إلغاء', 'Cancel')}
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <form className="vs-form" onSubmit={add} noValidate>
          <p className="vx-hint">
            <Icon name="info" size={14} />
            {t(
              'أضف حساباً باسم النشاط نفسه. لا يُحوَّل إليه شيء قبل أن يوثّقه فريق بسطة، ويصل صاحبَ المتجر بريد بكل إضافة.',
              'Add an account in the business name itself. Nothing is paid out to it until the Basta team verifies it, and the shop owner gets an email for every addition.',
            )}
          </p>
          <div className="vs-form__grid">
            <TextInput
              label={t('اسم صاحب الحساب', 'Account holder name')}
              hint={t('كما هو لدى البنك', 'As it appears at the bank')}
              required
              value={form.holderName}
              onChange={set('holderName')}
            />
            <TextInput label={t('اسم البنك', 'Bank name')} required value={form.bankName} onChange={set('bankName')} />
            <TextInput
              label={t('رقم الآيبان', 'IBAN')}
              required
              dir="ltr"
              className="field__control ac-mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="SA03 8000 0000 6080 1016 7519"
              value={form.iban}
              onChange={set('iban')}
            />
            <TextInput label={t('رمز السويفت', 'SWIFT code')} optional dir="ltr" className="field__control ac-mono" maxLength={11} value={form.swift} onChange={set('swift')} />
          </div>
          <div className="vs-form__proof">
            <span className="vx-label">{t('أكّد أنك صاحب الحساب', "Confirm it's you")}</span>
            <TextInput label={t('كلمة المرور', 'Password')} type="password" autoComplete="current-password" dir="ltr" required value={form.password} onChange={set('password')} />
            {totp ? (
              <TextInput
                label={t('رمز التطبيق أو رمز استعادة', 'Authenticator code or recovery code')}
                className="field__control ac-otp"
                autoComplete="one-time-code"
                dir="ltr"
                placeholder="000000"
                maxLength={11}
                required
                value={form.code}
                onChange={set('code')}
              />
            ) : null}
          </div>
          <div className="vs-form__actions">
            <button type="submit" className="btn btn--primary" disabled={!ready || busy !== null}>
              {busy === 'add' ? t('جارٍ الإضافة…', 'Adding…') : t('أضف الحساب', 'Add account')}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setAdding(false);
                setForm(EMPTY_FORM);
              }}
            >
              {t('إلغاء', 'Cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------ الإشعارات

interface Pref {
  key: string;
  labelAr: string;
  noteAr: string;
  email: boolean;
}

function NotifsTab() {
  const t = useT();
  const [items, setItems] = useState<Pref[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Pref[] }>('/me/notifications/prefs')
      .then((d) => setItems(d.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  async function toggle(p: Pref): Promise<void> {
    setBusy(p.key);
    setError(null);
    try {
      const d = await api<{ items: Pref[] }>('/me/notifications/prefs', { method: 'PUT', body: { prefs: { [p.key]: !p.email } } });
      setItems(d.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="vx-card" aria-labelledby="prefs-title">
      <h2 id="prefs-title" className="vx-card__title">
        {t('تفضيلات الإشعارات', 'Notification preferences')}
      </h2>
      <p className="vx-hint">
        <Icon name="info" size={14} />
        {t(
          'كل إشعار يظهر في اللوحة دائماً. هنا تختار ما يصلك بالبريد أيضاً. تنبيهات الأمن والحسابات البنكية لا تُطفأ.',
          'Every notification always shows in your dashboard. Here you choose which ones also reach you by email. Security and bank account alerts can’t be turned off.',
        )}
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!items && !error ? <Spinner label={t('جارٍ جلب التفضيلات…', 'Loading preferences…')} /> : null}
      {items ? (
        <ul className="vs-prefs">
          {items.map((p) => (
            <li key={p.key} className="vs-pref">
              <span className="vs-pref__text">
                <span className="vs-pref__label" id={`pref-${p.key}`}>
                  {p.labelAr}
                </span>
                <span className="vs-pref__note">{p.noteAr}</span>
              </span>
              <button
                type="button"
                role="switch"
                className="vx-switch"
                aria-checked={p.email}
                aria-labelledby={`pref-${p.key}`}
                disabled={busy !== null}
                onClick={() => void toggle(p)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// -------------------------------------------------------------- العملة

/** خانات العملة بعد الفاصلة بالعربية: الريال خانتان والدينار ثلاث */
const fractionDigits = (digits: number, locale: Locale): string =>
  locale === 'en'
    ? digits === 0
      ? 'No decimals'
      : `${digits} ${digits === 1 ? 'decimal place' : 'decimal places'}`
    : digits === 0 ? 'بلا كسور' : digits === 2 ? 'خانتان بعد الفاصلة' : digits === 3 ? 'ثلاث خانات بعد الفاصلة' : `${digits} خانات بعد الفاصلة`;

function CurrencyTab() {
  const t = useT();
  const locale = useLocale();
  const { data, error, loading } = useOnboarding();
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (loading || !data) return <Spinner label={t('جارٍ جلب المتجر…', 'Loading your shop…')} />;
  const c = CURRENCIES.find((x) => x.code === data.settlementCurrency);
  return (
    <section className="vx-card" aria-labelledby="currency-title">
      <h2 id="currency-title" className="vx-card__title">
        {t('عملة التسوية', 'Settlement currency')}
      </h2>
      <div className="vs-currency">
        <span className="vs-currency__main">
          <span className="vs-currency__name">{(locale === 'en' ? c?.nameEn : c?.nameAr) ?? data.settlementCurrency}</span>
          {/* كانت «SAR · 2 decimals» بالإنجليزية — الرمز وحده لاتيني، والباقي بالعربية */}
          <span className="vs-currency__code">
            <bdi dir="ltr">{data.settlementCurrency}</bdi> · {fractionDigits(c?.digits ?? 2, locale)}
          </span>
        </span>
        {data.settlementCurrencyLocked ? (
          <span className="badge">
            <Icon name="lock" size={14} />
            {t('للقراءة فقط', 'Read only')}
          </span>
        ) : null}
      </div>
      <p className="vx-hint">
        <Icon name="alert" size={14} />
        {data.settlementCurrencyLocked
          ? t(
              'عملة التسوية ثابتة بعد تثبيتها: بها تُسعَّر منتجاتك وتُحفظ محفظتك وتُحوَّل مستحقاتك. تغييرها يعني متجراً بمحفظة جديدة — راسل الدعم.',
              'The settlement currency is fixed once locked: your products are priced in it, your wallet is held in it and your payouts are made in it. Changing it means a shop with a new wallet — contact support.',
            )
          : t(
              'لم تُثبَّت العملة بعد. ثبّتها من خطوة العملة في التسجيل قبل أول عملية بيع.',
              'The currency is not locked yet. Lock it in the currency step of registration before your first sale.',
            )}
      </p>
    </section>
  );
}

// ------------------------------------------------------------- الصفحة

/**
 * VD-20 — إعدادات البائع: الأمان والجلسات (مشتركة مع حساب المشتري)، والحسابات
 * البنكية بعد الاعتماد، وتفضيلات البريد، وعملة التسوية للقراءة.
 * `?tab=banks` يفتح التبويب مباشرة — رابط بريد «أُضيف حساب بنكي» يأتي إليه.
 */
export default function VendorSettingsPage() {
  const t = useT();
  // التبويب من الرابط بعد الإماهة (الخادم لا يعرف الرابط)، ثم ما يختاره البائع
  const fromUrl = useSyncExternalStore(still, tabFromUrl, () => 'security' as const);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked ?? fromUrl;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const pick = (t: Tab) => {
    setPicked(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url);
  };

  function onKey(event: React.KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + TABS.length) % TABS.length;
    pick(TABS[next]!.id);
    refs.current[next]?.focus();
  }

  return (
    <div className="vm-page">
      <PageHead title={t('الإعدادات', 'Settings')} />
      <div className="vs-layout">
        <div className="vs-tabs" role="tablist" aria-label={t('أقسام الإعدادات', 'Settings sections')} aria-orientation="vertical">
          {TABS.map((item, i) => (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`vs-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={tab === item.id ? `vs-panel-${item.id}` : undefined}
              tabIndex={tab === item.id ? 0 : -1}
              className="vs-tab"
              onClick={() => pick(item.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <Icon name={item.icon} size={16} />
              {t(item.label, item.en)}
            </button>
          ))}
        </div>
        <div className="vs-panel" role="tabpanel" id={`vs-panel-${tab}`} aria-labelledby={`vs-tab-${tab}`}>
          {tab === 'security' ? <SecurityTab /> : null}
          {tab === 'banks' ? <BanksTab /> : null}
          {tab === 'notifs' ? <NotifsTab /> : null}
          {tab === 'currency' ? <CurrencyTab /> : null}
        </div>
      </div>
    </div>
  );
}
