'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { RegionSelect } from '@/components/region-select';
import { Alert, EmptyState, Field, PageHead, TextInput } from '@/components/ui';
import { api, session } from '@/lib/api';
import {
  COUNTRIES,
  addressCount,
  addressLine,
  addressTitle,
  type SavedAddress,
} from '@/lib/addresses';
import type { Translate } from '@/lib/i18n';

const PHONE = /^\+?[0-9 ]{7,20}$/;
const UNDO_MS = 6_000;

type FormState = {
  label: string;
  recipientName: string;
  phone: string;
  country: string;
  region: string;
  city: string;
  area: string;
  street: string;
  building: string;
  floor: string;
  landmark: string;
  isDefault: boolean;
};

const EMPTY: FormState = {
  label: '',
  recipientName: '',
  phone: '',
  country: 'JO',
  region: '',
  city: '',
  area: '',
  street: '',
  building: '',
  floor: '',
  landmark: '',
  isDefault: false,
};

const fromAddress = (a: SavedAddress): FormState => ({
  label: a.label ?? '',
  recipientName: a.recipientName,
  phone: a.phone,
  country: a.country,
  region: a.region,
  city: a.city,
  area: a.area ?? '',
  street: a.street,
  building: a.building ?? '',
  floor: a.floor ?? '',
  landmark: a.landmark ?? '',
  isDefault: a.isDefault,
});

type Errors = Partial<Record<keyof FormState, string>>;

/** التحقق نفسه في الخادم؛ هنا ليظهر الخطأ تحت حقله قبل الإرسال */
function validate(f: FormState, t: Translate): Errors {
  const e: Errors = {};
  if (f.recipientName.trim().length < 2) e.recipientName = t('اكتب اسم من يستلم الطلب.', 'Enter the name of the person receiving the order.');
  if (!PHONE.test(f.phone.trim()))
    e.phone = t('رقم الهاتف غير مكتمل — أرقام فقط، مثل +962 79 123 4567.', 'The phone number is incomplete — digits only, like +962 79 123 4567.');
  if (!f.region.trim()) e.region = t('اكتب المحافظة أو المنطقة.', 'Choose the governorate or region.');
  if (!f.city.trim()) e.city = t('اكتب المدينة.', 'Enter the city.');
  if (f.street.trim().length < 2) e.street = t('اكتب الشارع — يحتاجه المندوب ليصل.', 'Enter the street — the courier needs it to reach you.');
  return e;
}

/**
 * ST-26 — العناوين.
 *
 * بطاقة لكل عنوان بتسميته و«الافتراضي»، والتحرير في دُرج جانبي، والحذف
 * فوري بشريط «تراجع» لست ثوانٍ (الخادم يحذف حذفاً ناعماً ويقبل الاسترجاع).
 * الافتراضي يُعيَّن فوراً في الواجهة ثم يُثبَّت في الخادم، ويرتدّ إن فشل.
 */
export default function AddressesPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<SavedAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<{ address: SavedAddress | null } | null>(null);
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: SavedAddress[] }>('/me/addresses');
      setItems(d.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذّر جلب عناوينك.', "Couldn't load your addresses."));
    }
  }, [t]);

  useEffect(() => {
    if (!session.read()) {
      router.replace('/login?next=/account/addresses');
      return;
    }
    let alive = true;
    api<{ items: SavedAddress[] }>('/me/addresses')
      .then((d) => alive && setItems(d.items))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  async function makeDefault(a: SavedAddress): Promise<void> {
    const before = items;
    setItems((list) => list?.map((x) => ({ ...x, isDefault: x.id === a.id })) ?? list);
    setBusyId(a.id);
    try {
      await api(`/me/addresses/${a.id}/default`, { method: 'POST' });
      setStatus(t(`صار «${addressTitle(a)}» العنوان الافتراضي.`, `“${addressTitle(a)}” is now your default address.`));
      await load();
    } catch (e) {
      setItems(before);
      setError(e instanceof Error ? e.message : t('تعذّر تعيين العنوان الافتراضي.', "Couldn't set the default address."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a: SavedAddress): Promise<void> {
    setBusyId(a.id);
    try {
      await api(`/me/addresses/${a.id}`, { method: 'DELETE' });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({ id: a.id, label: addressTitle(a) });
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
      setStatus('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذّر حذف العنوان.', "Couldn't delete the address."));
    } finally {
      setBusyId(null);
    }
  }

  async function restore(): Promise<void> {
    if (!undo) return;
    const u = undo;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
    try {
      await api(`/me/addresses/${u.id}/restore`, { method: 'POST' });
      setStatus(t(`استُرجع العنوان «${u.label}».`, `Address “${u.label}” restored.`));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذّر استرجاع العنوان.', "Couldn't restore the address."));
    }
  }

  const count = items?.length ?? 0;

  return (
    <div className="aa-page">
      <PageHead
        title={t('العناوين', 'Addresses')}
        {...(items && count > 0 ? { count: addressCount(count, locale) } : {})}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setEditing({ address: null })}>
            <Icon name="plus" size={16} />
            {t('أضف عنواناً', 'Add an address')}
          </button>
        }
      />

      <p className="visually-hidden" role="status">
        {status}
      </p>

      {undo ? (
        <div className="aa-undo" role="status">
          <Icon name="trash" size={17} />
          <span className="aa-undo__text">{t(`حُذف العنوان «${undo.label}»`, `Address “${undo.label}” deleted`)}</span>
          <button type="button" className="aa-undo__btn" onClick={() => void restore()}>
            {t('تراجع', 'Undo')}
          </button>
        </div>
      ) : null}

      {error ? (
        <Alert tone="danger" title={t('لم يكتمل الطلب', "The request didn't go through")}>
          {error}
        </Alert>
      ) : null}

      {!items && !error ? (
        <div className="aa-skel" role="status">
          <span className="visually-hidden">{t('جارٍ جلب عناوينك…', 'Loading your addresses…')}</span>
          <span className="skeleton aa-skel__card" aria-hidden />
          <span className="skeleton aa-skel__card" aria-hidden />
        </div>
      ) : null}

      {items && count === 0 ? (
        <EmptyState
          icon="pin"
          title={t('لا عناوين محفوظة', 'No saved addresses')}
          actions={
            <button type="button" className="btn btn--primary" onClick={() => setEditing({ address: null })}>
              {t('أضف عنواناً', 'Add an address')}
            </button>
          }
        >
          {t(
            'أضف عنواناً الآن ليكون جاهزاً عند الدفع، أو أضفه أثناء إتمام الطلب.',
            "Add an address now so it's ready at checkout, or add one while placing your order.",
          )}
        </EmptyState>
      ) : null}

      {items && count > 0 ? (
        <ul className="aa-addrs">
          {items.map((a) => {
            const title = addressTitle(a);
            return (
              <li key={a.id}>
                <article className="aa-addr" data-default={a.isDefault} aria-label={title}>
                  <div className="aa-addr__tags">
                    <span className="aa-tag">
                      <Icon name="pin" size={13} />
                      {title}
                    </span>
                    {a.isDefault ? (
                      <span className="aa-tag aa-tag--brand">
                        <Icon name="check" size={13} />
                        {t('الافتراضي', 'Default')}
                      </span>
                    ) : null}
                  </div>
                  <span className="aa-addr__name">{a.recipientName}</span>
                  <span className="aa-addr__lines">
                    {addressLine(a, locale)}
                    {a.landmark ? (
                      <>
                        <br />
                        {a.landmark}
                      </>
                    ) : null}
                  </span>
                  <bdi className="aa-addr__phone num" dir="ltr">
                    {a.phone}
                  </bdi>
                  <div className="aa-addr__actions">
                    {!a.isDefault ? (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={busyId === a.id}
                        onClick={() => void makeDefault(a)}
                      >
                        {t('اجعله الافتراضي', 'Make default')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      aria-label={t(`حرّر «${title}»`, `Edit “${title}”`)}
                      onClick={() => setEditing({ address: a })}
                    >
                      {t('حرّر', 'Edit')}
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      aria-label={t(`احذف «${title}»`, `Delete “${title}”`)}
                      disabled={busyId === a.id}
                      onClick={() => void remove(a)}
                    >
                      <Icon name="trash" size={13} />
                      {t('احذف', 'Delete')}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}

      {editing ? (
        <AddressDrawer
          address={editing.address}
          firstAddress={count === 0}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            setEditing(null);
            setError(null);
            setStatus(
              editing.address
                ? t(`حُفظت تعديلات «${addressTitle(saved)}».`, `Changes to “${addressTitle(saved)}” saved.`)
                : t(`أُضيف العنوان «${addressTitle(saved)}».`, `Address “${addressTitle(saved)}” added.`),
            );
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

/** دُرج التحرير — <dialog> أصيل: التركيز محبوس فيه، و Esc والخلفية تغلقانه */
function AddressDrawer({
  address,
  firstAddress,
  onClose,
  onSaved,
}: {
  address: SavedAddress | null;
  firstAddress: boolean;
  onClose: () => void;
  onSaved: (a: SavedAddress) => void | Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [form, setForm] = useState<FormState>(() => (address ? fromAddress(address) : EMPTY));
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  const set =
    (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
      const next = { ...form, [key]: value };
      setForm(next);
      if (submitted) setErrors(validate(next, t));
    };

  /** المحافظة من القائمة؛ وتغيير البلد يفرغها — محافظة بلد آخر لا تبقى مختارة */
  const setRegion = (region: string, country = form.country) => {
    const next = { ...form, country, region };
    setForm(next);
    if (submitted) setErrors(validate(next, t));
  };

  /** الخطأ يظهر عند مغادرة الحقل، لا أثناء الكتابة */
  const blur = (key: keyof FormState) => () => {
    const e = validate(form, t)[key];
    setErrors((prev) => {
      const next = { ...prev };
      if (e) next[key] = e;
      else delete next[key];
      return next;
    });
  };

  async function submit(ev: FormEvent): Promise<void> {
    ev.preventDefault();
    setSubmitted(true);
    const e = validate(form, t);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    setServerError(null);
    const { isDefault, ...fields } = form;
    const body = {
      ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()])),
      ...(isDefault && !address?.isDefault ? { isDefault: true } : {}),
    };
    try {
      const saved = address
        ? await api<SavedAddress>(`/me/addresses/${address.id}`, { method: 'PATCH', body })
        : await api<SavedAddress>('/me/addresses', { method: 'POST', body });
      await onSaved(saved);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('تعذّر حفظ العنوان.', "Couldn't save the address."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="aa-drawer"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="aa-drawer__form" noValidate onSubmit={(e) => void submit(e)}>
        <header className="aa-drawer__head">
          <h2 id={titleId}>{address ? t('حرّر العنوان', 'Edit address') : t('عنوان جديد', 'New address')}</h2>
          <button type="button" className="icon-btn icon-btn--sm" aria-label={t('إغلاق', 'Close')} onClick={onClose}>
            <Icon name="x" size={17} />
          </button>
        </header>

        <div className="aa-drawer__body">
          {serverError ? (
            <div className="aa-drawer__wide">
              <Alert tone="danger">{serverError}</Alert>
            </div>
          ) : null}
          <div className="aa-drawer__wide">
            <TextInput
              label={t('تسمية العنوان', 'Address label')}
              optional
              hint={t('مثل: المنزل، العمل — تظهر على البطاقة وعند الدفع.', 'For example: Home, Work — shown on the card and at checkout.')}
              maxLength={40}
              value={form.label}
              onChange={set('label')}
            />
          </div>
          <TextInput
            label={t('اسم المستلم', 'Recipient name')}
            autoComplete="name"
            maxLength={120}
            value={form.recipientName}
            error={errors.recipientName}
            onChange={set('recipientName')}
            onBlur={blur('recipientName')}
          />
          <TextInput
            label={t('الهاتف', 'Phone')}
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            value={form.phone}
            error={errors.phone}
            onChange={set('phone')}
            onBlur={blur('phone')}
          />
          <Field label={t('البلد', 'Country')}>
            {(props) => (
              <select className="field__control" {...props} value={form.country} onChange={(e) => setRegion('', e.target.value)}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {locale === 'en' ? c.nameEn : c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <RegionSelect country={form.country} value={form.region} error={errors.region} onChange={(v) => setRegion(v)} onBlur={blur('region')} />
          <TextInput
            label={t('المدينة', 'City')}
            autoComplete="address-level2"
            maxLength={80}
            value={form.city}
            error={errors.city}
            onChange={set('city')}
            onBlur={blur('city')}
          />
          <TextInput label={t('الحي', 'Area')} optional maxLength={80} value={form.area} onChange={set('area')} />
          <div className="aa-drawer__wide">
            <TextInput
              label={t('الشارع', 'Street')}
              autoComplete="address-line1"
              maxLength={160}
              value={form.street}
              error={errors.street}
              onChange={set('street')}
              onBlur={blur('street')}
            />
          </div>
          <TextInput label={t('المبنى', 'Building')} optional maxLength={40} value={form.building} onChange={set('building')} />
          <TextInput label={t('الطابق', 'Floor')} optional maxLength={20} value={form.floor} onChange={set('floor')} />
          <div className="aa-drawer__wide">
            <TextInput
              label={t('علامة مميّزة', 'Landmark')}
              optional
              hint={t('ما يساعد المندوب على الوصول: قرب مسجد، مقابل صيدلية…', 'Anything that helps the courier find you: near a mosque, opposite a pharmacy…')}
              maxLength={200}
              value={form.landmark}
              onChange={set('landmark')}
            />
          </div>
          {address?.isDefault || firstAddress ? (
            <p className="aa-drawer__wide field__hint">
              {address?.isDefault
                ? t('هذا عنوانك الافتراضي.', 'This is your default address.')
                : t('أول عنوان تحفظه يصير الافتراضي تلقائياً.', 'The first address you save becomes your default automatically.')}
            </p>
          ) : (
            <label className="aa-check aa-drawer__wide">
              <input type="checkbox" checked={form.isDefault} onChange={set('isDefault')} />
              {t('اجعله العنوان الافتراضي', 'Make this my default address')}
            </label>
          )}
        </div>

        <footer className="aa-drawer__foot">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('إلغاء', 'Cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden /> : null}
            {address ? t('احفظ التعديلات', 'Save changes') : t('احفظ العنوان', 'Save address')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
