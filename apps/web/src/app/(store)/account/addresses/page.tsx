'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { Alert, EmptyState, Field, PageHead, TextInput } from '@/components/ui';
import { api, session } from '@/lib/api';
import {
  COUNTRIES,
  addressCount,
  addressLine,
  addressTitle,
  type SavedAddress,
} from '@/lib/addresses';

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
function validate(f: FormState): Errors {
  const e: Errors = {};
  if (f.recipientName.trim().length < 2) e.recipientName = 'اكتب اسم من يستلم الطلب.';
  if (!PHONE.test(f.phone.trim())) e.phone = 'رقم الهاتف غير مكتمل — أرقام فقط، مثل +962 79 123 4567.';
  if (!f.region.trim()) e.region = 'اكتب المحافظة أو المنطقة.';
  if (!f.city.trim()) e.city = 'اكتب المدينة.';
  if (f.street.trim().length < 2) e.street = 'اكتب الشارع — يحتاجه المندوب ليصل.';
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
      setError(e instanceof Error ? e.message : 'تعذّر جلب عناوينك.');
    }
  }, []);

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
      setStatus(`صار «${addressTitle(a)}» العنوان الافتراضي.`);
      await load();
    } catch (e) {
      setItems(before);
      setError(e instanceof Error ? e.message : 'تعذّر تعيين العنوان الافتراضي.');
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
      setError(e instanceof Error ? e.message : 'تعذّر حذف العنوان.');
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
      setStatus(`استُرجع العنوان «${u.label}».`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر استرجاع العنوان.');
    }
  }

  const count = items?.length ?? 0;

  return (
    <div className="aa-page">
      <PageHead
        title="العناوين"
        {...(items && count > 0 ? { count: addressCount(count) } : {})}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setEditing({ address: null })}>
            <Icon name="plus" size={16} />
            أضف عنواناً
          </button>
        }
      />

      <p className="visually-hidden" role="status">
        {status}
      </p>

      {undo ? (
        <div className="aa-undo" role="status">
          <Icon name="trash" size={17} />
          <span className="aa-undo__text">حُذف العنوان «{undo.label}»</span>
          <button type="button" className="aa-undo__btn" onClick={() => void restore()}>
            تراجع
          </button>
        </div>
      ) : null}

      {error ? (
        <Alert tone="danger" title="لم يكتمل الطلب">
          {error}
        </Alert>
      ) : null}

      {!items && !error ? (
        <div className="aa-skel" role="status">
          <span className="visually-hidden">جارٍ جلب عناوينك…</span>
          <span className="skeleton aa-skel__card" aria-hidden />
          <span className="skeleton aa-skel__card" aria-hidden />
        </div>
      ) : null}

      {items && count === 0 ? (
        <EmptyState
          icon="pin"
          title="لا عناوين محفوظة"
          actions={
            <button type="button" className="btn btn--primary" onClick={() => setEditing({ address: null })}>
              أضف عنواناً
            </button>
          }
        >
          أضف عنواناً الآن ليكون جاهزاً عند الدفع، أو أضفه أثناء إتمام الطلب.
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
                        الافتراضي
                      </span>
                    ) : null}
                  </div>
                  <span className="aa-addr__name">{a.recipientName}</span>
                  <span className="aa-addr__lines">
                    {addressLine(a)}
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
                        اجعله الافتراضي
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      aria-label={`حرّر «${title}»`}
                      onClick={() => setEditing({ address: a })}
                    >
                      حرّر
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      aria-label={`احذف «${title}»`}
                      disabled={busyId === a.id}
                      onClick={() => void remove(a)}
                    >
                      <Icon name="trash" size={13} />
                      احذف
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
            setStatus(editing.address ? `حُفظت تعديلات «${addressTitle(saved)}».` : `أُضيف العنوان «${addressTitle(saved)}».`);
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
      if (submitted) setErrors(validate(next));
    };

  /** الخطأ يظهر عند مغادرة الحقل، لا أثناء الكتابة */
  const blur = (key: keyof FormState) => () => {
    const e = validate(form)[key];
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
    const e = validate(form);
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
      setServerError(err instanceof Error ? err.message : 'تعذّر حفظ العنوان.');
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
          <h2 id={titleId}>{address ? 'حرّر العنوان' : 'عنوان جديد'}</h2>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="إغلاق" onClick={onClose}>
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
              label="تسمية العنوان"
              optional
              hint="مثل: المنزل، العمل — تظهر على البطاقة وعند الدفع."
              maxLength={40}
              value={form.label}
              onChange={set('label')}
            />
          </div>
          <TextInput
            label="اسم المستلم"
            autoComplete="name"
            maxLength={120}
            value={form.recipientName}
            error={errors.recipientName}
            onChange={set('recipientName')}
            onBlur={blur('recipientName')}
          />
          <TextInput
            label="الهاتف"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            value={form.phone}
            error={errors.phone}
            onChange={set('phone')}
            onBlur={blur('phone')}
          />
          <Field label="البلد">
            {(props) => (
              <select className="field__control" {...props} value={form.country} onChange={set('country')}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <TextInput
            label="المحافظة / المنطقة"
            maxLength={80}
            value={form.region}
            error={errors.region}
            onChange={set('region')}
            onBlur={blur('region')}
          />
          <TextInput
            label="المدينة"
            autoComplete="address-level2"
            maxLength={80}
            value={form.city}
            error={errors.city}
            onChange={set('city')}
            onBlur={blur('city')}
          />
          <TextInput label="الحي" optional maxLength={80} value={form.area} onChange={set('area')} />
          <div className="aa-drawer__wide">
            <TextInput
              label="الشارع"
              autoComplete="address-line1"
              maxLength={160}
              value={form.street}
              error={errors.street}
              onChange={set('street')}
              onBlur={blur('street')}
            />
          </div>
          <TextInput label="المبنى" optional maxLength={40} value={form.building} onChange={set('building')} />
          <TextInput label="الطابق" optional maxLength={20} value={form.floor} onChange={set('floor')} />
          <div className="aa-drawer__wide">
            <TextInput
              label="علامة مميّزة"
              optional
              hint="ما يساعد المندوب على الوصول: قرب مسجد، مقابل صيدلية…"
              maxLength={200}
              value={form.landmark}
              onChange={set('landmark')}
            />
          </div>
          {address?.isDefault || firstAddress ? (
            <p className="aa-drawer__wide field__hint">
              {address?.isDefault ? 'هذا عنوانك الافتراضي.' : 'أول عنوان تحفظه يصير الافتراضي تلقائياً.'}
            </p>
          ) : (
            <label className="aa-check aa-drawer__wide">
              <input type="checkbox" checked={form.isDefault} onChange={set('isDefault')} />
              اجعله العنوان الافتراضي
            </label>
          )}
        </div>

        <footer className="aa-drawer__foot">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden /> : null}
            {address ? 'احفظ التعديلات' : 'احفظ العنوان'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
