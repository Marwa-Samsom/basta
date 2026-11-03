'use client';

import '@/styles/screens/vendor-extra.css';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ClearableInput, EmptyState, Field, PageHead, TextInput } from '@/components/ui';
import { digitsOnly } from '@/lib/digits';
import { useConfirm } from '@/components/confirm';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api';
import { minorUnitDigits } from '@/lib/money';
import { money } from '@/lib/orders';
import { COUNTRIES } from '@/lib/vendor';
import { regionName, samePlace } from '@/lib/places';
import { RegionSelect } from '@/components/region-select';
import { useLocale, useT } from '@/components/locale';
import type { Locale, Translate } from '@/lib/i18n';
import { useReturnTick } from '@/lib/fresh';

type Method = 'flat' | 'by_weight' | 'free_over';

interface Region {
  country: string;
  region: string | null;
  city: string | null;
}

interface Rate {
  id: string;
  method: Method;
  priceMinorUnits: string;
  perKgMinorUnits: string | null;
  freeOverMinorUnits: string | null;
  minDays: number;
  maxDays: number;
  isActive: boolean;
}

interface Zone {
  id: string;
  nameAr: string;
  isActive: boolean;
  regions: Region[];
  rates: Rate[];
}

interface ZonesView {
  currency: string;
  zones: Zone[];
}

const METHODS: { key: Method; label: string; en: string }[] = [
  { key: 'flat', label: 'سعر ثابت', en: 'Flat rate' },
  { key: 'by_weight', label: 'حسب الوزن', en: 'By weight' },
  { key: 'free_over', label: 'مجاني فوق مبلغ', en: 'Free over an amount' },
];

const countryName = (code: string, locale: Locale): string => {
  const c = COUNTRIES.find((x) => x.code === code);
  return (locale === 'en' ? c?.nameEn : c?.nameAr) ?? code;
};
const describe = (r: Region, locale: Locale): string =>
  [r.city, r.region ? regionName(r.country, r.region, locale) : null, countryName(r.country, locale)]
    .filter(Boolean)
    .join(locale === 'en' ? ', ' : '، ');
const keyOf = (r: Region): string => `${r.country}|${r.region ?? ''}|${r.city ?? ''}`;

/** صفّ الإضافة في محرّر التغطية — `touched` حين اختار البائع بلداً أو كتب شيئاً */
interface CoverRow {
  country: string;
  region: string;
  city: string;
  touched: boolean;
}

/**
 * ما كتبه البائع في صفّ الإضافة ولم يضغط «أضف إلى التغطية» يدخل مع الحفظ — كان
 * الحفظ يُرفض بـ«أضف بلداً» والبلد مختار أمامه. صفّ لم يلمسه لا يُضاف: البلد
 * الافتراضي في القائمة ليس نيّة تغطية.
 */
function pendingRow(row: CoverRow, regions: Region[]): Region | null {
  if (!row.touched) return null;
  const region = row.region.trim() || null;
  const city = row.city.trim() || null;
  // البلد وحده نيّة حين لا تغطية غيره؛ مع تغطية قائمة هو ما بقي في القائمة بعد إضافة سابقة
  if (!region && !city && regions.length > 0) return null;
  const next = { country: row.country, region, city };
  return regions.some((r) => keyOf(r) === keyOf(next)) ? null : next;
}

/** «12.5» ← 1250 بخانات العملة، والصفر مقبول (شحن مجاني). بلا عدد عشري في الطريق (ADR-001) */
function toMinor(input: string, currency: string): string | null {
  const digits = minorUnitDigits(currency);
  const m = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .match(/^(\d{1,12})(?:[.,٫](\d+))?$/);
  if (!m) return null;
  if ((m[2] ?? '').length > digits) return null;
  const frac = (m[2] ?? '').padEnd(digits, '0');
  return (BigInt(m[1]!) * 10n ** BigInt(digits) + BigInt(frac || '0')).toString();
}

function fromMinor(minor: string | null, currency: string): string {
  if (minor === null) return '';
  const digits = minorUnitDigits(currency);
  if (digits === 0) return minor;
  const s = minor.padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

// ------------------------------------------------------------- التسعيرة

interface RateDraft {
  method: Method;
  price: string;
  perKg: string;
  freeOver: string;
  minDays: string;
  maxDays: string;
}

const emptyDraft = (): RateDraft => ({ method: 'flat', price: '', perKg: '', freeOver: '', minDays: '2', maxDays: '4' });

const draftOf = (r: Rate, currency: string): RateDraft => ({
  method: r.method,
  price: fromMinor(r.priceMinorUnits, currency),
  perKg: fromMinor(r.perKgMinorUnits, currency),
  freeOver: fromMinor(r.freeOverMinorUnits, currency),
  minDays: String(r.minDays),
  maxDays: String(r.maxDays),
});

/**
 * المسوّدة ← جسم الطلب. الحقل الذي لا تقرؤه الطريقة يُرسل null صراحةً: الخادم
 * يرفض سعر كيلو على «ثابت» مثلاً، والتبديل بين الطرق يمسح ما لا يخصّ الجديدة.
 */
function bodyOf(d: RateDraft, currency: string, t: Translate): { body: Record<string, unknown> } | { error: string } {
  const price = toMinor(d.price || '0', currency);
  if (price === null) return { error: t('اكتب السعر رقماً موجباً بخانات العملة.', "Enter the price as a positive number using the currency's decimal places.") };
  let perKg: string | null = null;
  let freeOver: string | null = null;
  if (d.method === 'by_weight') {
    perKg = toMinor(d.perKg, currency);
    if (!perKg || perKg === '0') return { error: t('اكتب سعراً للكيلوغرام أكبر من صفر.', 'Enter a price per kilogram greater than zero.') };
  }
  if (d.method === 'free_over') {
    freeOver = toMinor(d.freeOver, currency);
    if (!freeOver || freeOver === '0') {
      return { error: t('اكتب حدّ الشحن المجاني — مبلغاً أكبر من صفر.', 'Enter the free shipping threshold — an amount greater than zero.') };
    }
  }
  const min = Number(d.minDays);
  const max = Number(d.maxDays);
  if (!/^\d{1,2}$/.test(d.minDays) || !/^\d{1,2}$/.test(d.maxDays) || max < 1 || max > 90) {
    return { error: t('مدّة التوصيل أيام صحيحة بين 0 و 90.', 'Delivery time must be whole days between 0 and 90.') };
  }
  if (max < min) {
    return {
      error: t(
        `نهاية المدى يجب أن تكون مساوية أو أكبر من بدايته (${min} أيام).`,
        `The end of the range must be equal to or greater than its start (${min} ${min === 1 ? 'day' : 'days'}).`,
      ),
    };
  }
  return {
    body: { method: d.method, priceMinorUnits: price, perKgMinorUnits: perKg, freeOverMinorUnits: freeOver, minDays: min, maxDays: max },
  };
}

function AmountField({
  label,
  value,
  onChange,
  currency,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  currency: string;
  suffix?: string;
}) {
  return (
    <Field label={label}>
      {(p) => (
        <span className="vx-amount">
          <ClearableInput {...p} inputMode="decimal" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} />
          <span className="vx-amount__unit num">{suffix ?? currency}</span>
        </span>
      )}
    </Field>
  );
}

/** حقول تسعيرة واحدة — الطريقة تبدّل الحقول (VD-16) */
function RateFields({ draft, onChange, currency }: { draft: RateDraft; onChange: (d: RateDraft) => void; currency: string }) {
  const t = useT();
  const set = (patch: Partial<RateDraft>) => onChange({ ...draft, ...patch });
  const daysBad = /^\d+$/.test(draft.minDays) && /^\d+$/.test(draft.maxDays) && Number(draft.maxDays) < Number(draft.minDays);
  return (
    <>
      <div className="seg vx-rate__seg" role="group" aria-label={t('طريقة التسعير', 'Pricing method')}>
        {METHODS.map((m) => (
          <button key={m.key} type="button" className="seg__opt" aria-pressed={draft.method === m.key} onClick={() => set({ method: m.key })}>
            {t(m.label, m.en)}
          </button>
        ))}
      </div>
      <div className="vx-rate__fields">
        <AmountField
          label={
            draft.method === 'free_over'
              ? t('السعر تحت الحدّ', 'Price below the threshold')
              : draft.method === 'by_weight'
                ? t('رسم أساسي', 'Base fee')
                : t('السعر الثابت', 'Flat price')
          }
          value={draft.price}
          onChange={(v) => set({ price: v })}
          currency={currency}
        />
        {draft.method === 'by_weight' ? (
          <AmountField label={t('السعر لكل كيلوغرام', 'Price per kilogram')} value={draft.perKg} onChange={(v) => set({ perKg: v })} currency={currency} suffix={`${currency} / kg`} />
        ) : null}
        {draft.method === 'free_over' ? (
          <AmountField label={t('مجاني فوق مبلغ', 'Free over')} value={draft.freeOver} onChange={(v) => set({ freeOver: v })} currency={currency} />
        ) : null}
        <TextInput
          label={t('من (أيام)', 'From (days)')}
          className="field__control vx-days"
          inputMode="numeric"
          dir="ltr"
          value={draft.minDays}
          onChange={(e) => set({ minDays: digitsOnly(e.target.value) })}
        />
        <TextInput
          label={t('إلى (أيام)', 'To (days)')}
          className="field__control vx-days"
          inputMode="numeric"
          dir="ltr"
          value={draft.maxDays}
          error={
            daysBad
              ? t(
                  `نهاية المدى يجب أن تكون مساوية أو أكبر من بدايته (${draft.minDays} أيام).`,
                  `The end of the range must be equal to or greater than its start (${draft.minDays} ${Number(draft.minDays) === 1 ? 'day' : 'days'}).`,
                )
              : null
          }
          onChange={(e) => set({ maxDays: digitsOnly(e.target.value) })}
        />
      </div>
      {draft.method === 'by_weight' ? (
        <p className="vx-hint">
          <Icon name="info" size={13} />
          {t(
            'الرسم الأساسي + سعر الكيلو × وزن السلّة مقرّباً لأعلى كيلو (كيلو واحد على الأقل).',
            'Base fee + price per kg × cart weight, rounded up to the next kg (at least 1 kg).',
          )}
        </p>
      ) : draft.method === 'free_over' ? (
        <p className="vx-hint">
          <Icon name="info" size={13} />
          {t(
            'إن بلغت قيمة منتجاتك في السلّة الحدّ فالشحن مجاني، وإلا يدفع المشتري السعر تحت الحدّ.',
            'If your products in the cart reach the threshold, shipping is free; otherwise the buyer pays the price below the threshold.',
          )}
        </p>
      ) : null}
    </>
  );
}

/** تسعيرة قائمة أو جديدة في منطقة محفوظة — تُحفظ وحدها */
function RateCard({
  rate,
  currency,
  revision,
  onSave,
  onToggle,
  onCancel,
}: {
  rate: Rate | null;
  currency: string;
  /** بصمة المنطقة — خطأ وقع على بصمة قديمة لم يعد صحيحاً (أُضيفت تسعيرة أخرى مثلاً) فيُخفى */
  revision: string;
  /** يعيد رسالة الخطأ لتظهر في البطاقة، أو null عند النجاح */
  onSave: (body: Record<string, unknown>) => Promise<string | null>;
  onToggle?: (active: boolean) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<RateDraft>(() => (rate ? draftOf(rate, currency) : emptyDraft()));
  const [failure, setFailure] = useState<{ text: string; at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (text: string | null) => setFailure(text ? { text, at: revision } : null);
  const error = failure && failure.at === revision ? failure.text : null;

  const save = async () => {
    const out = bodyOf(draft, currency, t);
    if ('error' in out) {
      fail(out.error);
      return;
    }
    fail(null);
    setBusy(true);
    fail(await onSave(out.body));
    setBusy(false);
  };

  const off = rate !== null && !rate.isActive;
  return (
    <div className={`vx-rate${off ? ' vx-rate--off' : ''}`}>
      <RateFields draft={draft} onChange={setDraft} currency={currency} />
      {error ? (
        <p className="vx-error" role="alert">
          <Icon name="alert" size={14} />
          {error}
        </p>
      ) : null}
      <div className="vx-rate__foot">
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void save()}>
          {rate ? t('احفظ التسعيرة', 'Save rate') : t('أضف التسعيرة', 'Add rate')}
        </button>
        {rate && onToggle ? (
          <span className="vx-zone__state">
            <button
              type="button"
              role="switch"
              className="vx-switch"
              aria-checked={rate.isActive}
              aria-label={t('تسعيرة مفعّلة', 'Rate active')}
              disabled={busy}
              onClick={async () => {
                fail(null);
                setBusy(true);
                fail(await onToggle(!rate.isActive));
                setBusy(false);
              }}
            />
            <span className={`vx-zone__label${rate.isActive ? ' vx-zone__label--on' : ''}`}>
              {rate.isActive ? t('مفعّلة', 'Active') : t('موقوفة — لا تُحسب', 'Inactive — not applied')}
            </span>
          </span>
        ) : null}
        {onCancel ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            {t('إلغاء', 'Cancel')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- المنطقة

function CoverageEditor({
  regions,
  onChange,
  row,
  onRow,
}: {
  regions: Region[];
  onChange: (r: Region[]) => void;
  row: CoverRow;
  onRow: (r: CoverRow) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { country, region, city } = row;
  const set = (patch: Partial<CoverRow>) => onRow({ ...row, ...patch, touched: true });

  const add = () => {
    const next: Region = { country, region: region.trim() || null, city: city.trim() || null };
    if (!regions.some((r) => keyOf(r) === keyOf(next))) onChange([...regions, next]);
    onRow({ ...row, region: '', city: '', touched: false });
  };

  return (
    <div className="vx-editor">
      <span className="vx-label">{t('التغطية', 'Coverage')}</span>
      {regions.length ? (
        <div className="vx-pills">
          {regions.map((r) => (
            <span key={keyOf(r)} className="vx-pill vx-pill--on">
              <Icon name="check" size={12} />
              {describe(r, locale)}
              <button
                type="button"
                className="vx-chip-x"
                aria-label={t(`أزل ${describe(r, locale)} من التغطية`, `Remove ${describe(r, locale)} from coverage`)}
                onClick={() => onChange(regions.filter((x) => keyOf(x) !== keyOf(r)))}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="vx-hint">{t('لا تغطية بعد — أضف بلداً أو محافظة أو مدينة.', 'No coverage yet — add a country, governorate or city.')}</p>
      )}
      <div className="vx-cover-add">
        <Field label={t('البلد', 'Country')}>
          {(p) => (
            <select className="field__control" {...p} value={country} onChange={(e) => set({ country: e.target.value, region: '' })}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {locale === 'en' ? c.nameEn : c.nameAr}
                </option>
              ))}
            </select>
          )}
        </Field>
        <RegionSelect
          country={country}
          value={region}
          onChange={(v) => set({ region: v })}
          emptyLabel={t('كل البلد', 'Whole country')}
          optional
        />
        <TextInput label={t('المدينة', 'City')} optional value={city} onChange={(e) => set({ city: e.target.value })} />
        <button type="button" className="btn btn--secondary" onClick={add}>
          <Icon name="plus" size={15} />
          {t('أضف إلى التغطية', 'Add to coverage')}
        </button>
      </div>
      <p className="vx-hint">
        <Icon name="info" size={13} />
        {t(
          'الدول ثم المناطق ثم المدن — والأدقّ يفوز: سعر المدينة قبل سعر محافظتها قبل سعر البلد. المحافظة من القائمة نفسها التي يختار منها المشتري عنوانه، والمدينة تُطابَق بلا تشكيل ولا همزة. اترك المدينة فارغة لتغطية المحافظة كلها، و«كل البلد» لتغطيته كله.',
          "Countries, then regions, then cities — the most specific wins: a city's price comes before its governorate's, which comes before the country's. Governorates come from the same list buyers pick their address from, and cities are matched ignoring diacritics and hamza. Leave the city empty to cover the whole governorate, and choose “Whole country” to cover all of it.",
        )}
      </p>
    </div>
  );
}

function ZoneEditor({
  zone,
  currency,
  onSaved,
  onDeleted,
  onError,
}: {
  zone: Zone | null;
  currency: string;
  onSaved: (z: Zone, notice: string) => void;
  onDeleted: (id: string) => void;
  onError: (msg: string | null) => void;
}) {
  const t = useT();
  const ask = useConfirm();
  const [name, setName] = useState(zone?.nameAr ?? '');
  const [regions, setRegions] = useState<Region[]>(zone?.regions.map((r) => ({ country: r.country, region: r.region, city: r.city })) ?? []);
  const [draft, setDraft] = useState<RateDraft>(emptyDraft);
  const [cover, setCover] = useState<CoverRow>({ country: zone?.regions[0]?.country ?? 'SA', region: '', city: '', touched: false });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // أي تغيّر في المنطقة — من هذه البطاقات أو من مفتاحها في القائمة — يُسقط أخطاء التسعيرات القديمة
  const revision = useMemo(() => JSON.stringify(zone), [zone]);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    try {
      const out = await fn();
      onError(null);
      return out;
    } catch (e) {
      onError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (name.trim().length < 2) return onError(t('اكتب اسماً للمنطقة — حرفان على الأقل.', 'Enter a zone name — at least 2 characters.'));
    const pending = pendingRow(cover, regions);
    const all = pending ? [...regions, pending] : regions;
    if (all.length === 0) {
      return onError(t('اختر بلداً للتغطية ثم اضغط «أضف إلى التغطية».', 'Choose a country to cover, then press “Add to coverage”.'));
    }
    if (pending) {
      setRegions(all);
      setCover({ ...cover, region: '', city: '', touched: false });
    }
    if (!zone) {
      const out = bodyOf(draft, currency, t);
      if ('error' in out) return onError(out.error);
      const z = await run(() => api<Zone>('/vendor/shipping/zones', { method: 'POST', body: { nameAr: name, regions: all, rates: [out.body] } }));
      if (z) {
        onSaved(
          z,
          t(
            `أُضيفت منطقة «${z.nameAr}» — ${z.regions.length} في تغطيتها.`,
            `Zone “${z.nameAr}” added — ${z.regions.length} ${z.regions.length === 1 ? 'place' : 'places'} in its coverage.`,
          ),
        );
      }
      return;
    }
    const z = await run(() => api<Zone>(`/vendor/shipping/zones/${zone.id}`, { method: 'PATCH', body: { nameAr: name, regions: all } }));
    if (z) {
      onSaved(
        z,
        t(
          `حُفظت «${z.nameAr}» — ${z.regions.length} في تغطيتها.`,
          `“${z.nameAr}” saved — ${z.regions.length} ${z.regions.length === 1 ? 'place' : 'places'} in its coverage.`,
        ),
      );
    }
  };

  const remove = async () => {
    if (!zone) return;
    const sure = await ask({
      title: t(`تحذف «${zone.nameAr}»؟`, `Delete “${zone.nameAr}”?`),
      body: t(
        'المشترون في تغطيتها لن يستطيعوا الشراء منك إلا إن غطّتهم منطقة أخرى. الطلبات القائمة لا تتأثّر.',
        "Buyers in its coverage won't be able to buy from you unless another zone covers them. Existing orders are not affected.",
      ),
      confirmLabel: t('احذف المنطقة', 'Delete zone'),
      danger: true,
    });
    if (!sure) return;
    const ok = await run(() => api(`/vendor/shipping/zones/${zone.id}`, { method: 'DELETE' }));
    if (ok !== null) onDeleted(zone.id);
  };

  /**
   * خطأ التسعيرة يعود إلى بطاقتها ولا يُرفع أعلى الصفحة: إيقاف آخر تسعيرة مفعّلة
   * يُرفض، والرسالة هناك بعيدة عن المفتاح فبدا كأنه لا يستجيب.
   */
  const saveRate = async (path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, notice: string): Promise<string | null> => {
    setBusy(true);
    try {
      const z = await api<Zone>(path, { method, body });
      onError(null);
      onSaved(z, notice);
      return null;
    } catch (e) {
      return (e as Error).message;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vx-editor">
      <section className="vx-card" aria-labelledby="vx-zone-title">
        <div className="vx-card__head">
          <h2 className="vx-card__title" id="vx-zone-title">
            {zone ? zone.nameAr : t('منطقة جديدة', 'New zone')}
          </h2>
          <span className="vx-card__sub">{zone ? t('تحرير المنطقة', 'Edit zone') : t('تُحفظ مفعّلة بتسعيرتها الأولى', 'Saved as active with its first rate')}</span>
        </div>
        <TextInput
          label={t('اسم المنطقة', 'Zone name')}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('الرياض الكبرى', 'Greater Riyadh')}
        />
        <CoverageEditor regions={regions} onChange={setRegions} row={cover} onRow={setCover} />

        {!zone ? (
          <div className="vx-divider vx-editor">
            <span className="vx-label">{t('طريقة التسعير', 'Pricing method')}</span>
            <RateFields draft={draft} onChange={setDraft} currency={currency} />
          </div>
        ) : null}

        <div className="row">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void save()}>
            {t('احفظ المنطقة', 'Save zone')}
          </button>
          {zone ? (
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void remove()}>
              <Icon name="trash" size={15} />
              {t('احذف المنطقة', 'Delete zone')}
            </button>
          ) : null}
        </div>
      </section>

      {zone ? (
        <section className="vx-card" aria-labelledby="vx-rates-title">
          <div className="vx-card__head">
            <h2 className="vx-card__title" id="vx-rates-title">
              {t('التسعيرات', 'Rates')}
            </h2>
            <span className="vx-card__sub">
              {t('يدفع المشتري أرخص تسعيرة مفعّلة تنطبق على سلّته', 'The buyer pays the cheapest active rate that applies to their cart')}
            </span>
            {!adding ? (
              <span className="vx-card__end">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={14} />
                  {t('أضف تسعيرة', 'Add rate')}
                </button>
              </span>
            ) : null}
          </div>
          <div className="vx-rates">
            {zone.rates.map((r) => (
              <RateCard
                key={`${r.id}:${r.method}:${r.priceMinorUnits}:${r.isActive}`}
                rate={r}
                currency={currency}
                revision={revision}
                onSave={(body) => saveRate(`/vendor/shipping/rates/${r.id}`, 'PATCH', body, t('حُفظت التسعيرة.', 'Rate saved.'))}
                onToggle={(active) =>
                  saveRate(
                    `/vendor/shipping/rates/${r.id}`,
                    'PATCH',
                    { isActive: active },
                    active ? t('فُعّلت التسعيرة.', 'Rate activated.') : t('أُوقفت التسعيرة.', 'Rate deactivated.'),
                  )
                }
              />
            ))}
            {adding ? (
              <RateCard
                rate={null}
                currency={currency}
                revision={revision}
                onSave={async (body) => {
                  const failed = await saveRate(`/vendor/shipping/zones/${zone.id}/rates`, 'POST', body, t('أُضيفت التسعيرة.', 'Rate added.'));
                  if (!failed) setAdding(false);
                  return failed;
                }}
                onCancel={() => setAdding(false)}
              />
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- المعاينة

type PreviewResult =
  | { ok: true; minor: bigint; minDays: number; maxDays: number; zone: string }
  | { ok: false; reason: 'uncovered' | 'norate' };

/**
 * نسخة العرض من `quoteShipping` في وحدة التسعير، بقواعدها نفسها: المنطقة
 * المفعّلة الأدقّ (مدينة ثم محافظة ثم بلد)، ثم أرخص تسعيرة مفعّلة فيها.
 * الحكم الملزم عند الدفع للخادم؛ هذه تُري البائع ما سيراه المشتري.
 */
function previewQuote(zones: Zone[], addr: Region, itemsMinor: bigint, grams: number): PreviewResult {
  // بقاعدة الخادم نفسها — «عمّان» و«عمان» مكان واحد (lib/places)
  const score = (r: Region): number => {
    if (r.country.toUpperCase() !== addr.country.toUpperCase()) return -1;
    if (r.city && !samePlace(r.city, addr.city)) return -1;
    if (r.region && !samePlace(r.region, addr.region)) return -1;
    return r.city ? 3 : r.region ? 2 : 1;
  };
  let best: { zone: Zone; score: number } | null = null;
  for (const zone of zones.filter((z) => z.isActive)) {
    const s = Math.max(-1, ...zone.regions.map(score));
    if (s > 0 && (!best || s > best.score)) best = { zone, score: s };
  }
  if (!best) return { ok: false, reason: 'uncovered' };
  const kg = Math.max(1, Math.ceil(grams / 1000));
  const options = best.zone.rates
    .filter((r) => r.isActive)
    .map((r) => {
      const price = BigInt(r.priceMinorUnits);
      if (r.method === 'free_over' && r.freeOverMinorUnits !== null && itemsMinor >= BigInt(r.freeOverMinorUnits)) return { minor: 0n, r };
      if (r.method === 'by_weight') return { minor: price + BigInt(r.perKgMinorUnits ?? '0') * BigInt(kg), r };
      return { minor: price, r };
    })
    .sort((a, b) => (a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0));
  const cheapest = options[0];
  if (!cheapest) return { ok: false, reason: 'norate' };
  return { ok: true, minor: cheapest.minor, minDays: cheapest.r.minDays, maxDays: cheapest.r.maxDays, zone: best.zone.nameAr };
}

function Preview({ zones, currency }: { zones: Zone[]; currency: string }) {
  const t = useT();
  const locale = useLocale();
  const covered = useMemo(() => {
    const seen = new Map<string, Region>();
    for (const z of zones.filter((x) => x.isActive)) for (const r of z.regions) if (r.city && !seen.has(keyOf(r))) seen.set(keyOf(r), r);
    return [...seen.values()].slice(0, 6);
  }, [zones]);
  const first = zones.find((z) => z.isActive)?.regions[0];
  const [addr, setAddr] = useState<Region>({ country: first?.country ?? 'SA', region: first?.region ?? '', city: first?.city ?? '' });
  const [basket, setBasket] = useState('240');
  const [weight, setWeight] = useState('2.4');

  const itemsMinor = BigInt(toMinor(basket || '0', currency) ?? '0');
  const grams = Math.round((Number(weight.replace(',', '.')) || 0) * 1000);
  const result = previewQuote(zones, addr, itemsMinor, grams);
  const place =
    addr.city?.trim() ||
    (addr.region?.trim() ? regionName(addr.country, addr.region.trim(), locale) : '') ||
    countryName(addr.country, locale);

  return (
    <section className="vx-card vx-card--money" aria-labelledby="vx-preview-title">
      <h2 className="vx-card__title" id="vx-preview-title">
        {t('معاينة حيّة', 'Live preview')}
      </h2>
      {covered.length ? (
        <div className="vx-pills" role="group" aria-label={t('مدن مغطّاة', 'Covered cities')}>
          {covered.map((c) => (
            <button
              key={keyOf(c)}
              type="button"
              className="vx-pill"
              aria-pressed={keyOf(c) === keyOf({ country: addr.country, region: addr.region || null, city: addr.city || null })}
              onClick={() => setAddr({ country: c.country, region: c.region ?? '', city: c.city ?? '' })}
            >
              {c.city}
            </button>
          ))}
        </div>
      ) : null}
      <div className="vx-preview__inputs">
        <Field label={t('البلد', 'Country')}>
          {(p) => (
            <select className="field__control" {...p} value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value, region: '' })}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {locale === 'en' ? c.nameEn : c.nameAr}
                </option>
              ))}
            </select>
          )}
        </Field>
        <RegionSelect
          label={t('المحافظة', 'Governorate')}
          country={addr.country}
          value={addr.region ?? ''}
          onChange={(v) => setAddr({ ...addr, region: v })}
          emptyLabel="—"
          optional
        />
        <TextInput label={t('المدينة', 'City')} value={addr.city ?? ''} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
        <AmountField label={t('قيمة السلّة', 'Cart value')} value={basket} onChange={setBasket} currency={currency} />
        <TextInput label={t('الوزن (كغ)', 'Weight (kg)')} className="field__control vx-days" inputMode="decimal" dir="ltr" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </div>
      <p className={`vx-preview__box${result.ok ? '' : ' vx-preview__box--out'}`} role="status">
        {result.ok ? (
          <>
            {t(`المشتري في ${place} يدفع`, result.minor === 0n ? `A buyer in ${place} gets` : `A buyer in ${place} pays`)}{' '}
            {result.minor === 0n ? (
              t('شحناً مجانياً', 'free shipping')
            ) : (
              <span className="money num">{money(result.minor, currency, locale)}</span>
            )}{' '}
            {t('ويستلم خلال', 'and receives the order within')}{' '}
            <span className="num">
              {result.minDays}–{result.maxDays}
            </span>{' '}
            {t(`أيام — من منطقة «${result.zone}».`, `days — from the “${result.zone}” zone.`)}
          </>
        ) : result.reason === 'uncovered' ? (
          <>
            {t(
              `المشتري في ${place} غير مغطّى بأيّ منطقة مفعّلة — لا يستطيع إتمام الشراء منك. أضف مدينته أو محافظته أو بلده إلى التغطية.`,
              `A buyer in ${place} isn't covered by any active zone — they can't complete a purchase from you. Add their city, governorate or country to your coverage.`,
            )}
          </>
        ) : (
          <>
            {t(
              `المنطقة التي تغطّي ${place} بلا تسعيرة مفعّلة — المشتري هناك لا يستطيع إتمام الشراء.`,
              `The zone covering ${place} has no active rate — buyers there can't complete a purchase.`,
            )}
          </>
        )}
      </p>
      <p className="vx-hint">
        <Icon name="info" size={13} />
        {t(
          'الحساب على مناطقك المحفوظة وقواعد الدفع نفسها. التعديلات غير المحفوظة لا تدخل فيه.',
          'Calculated from your saved zones with the same rules as checkout. Unsaved changes are not included.',
        )}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- الصفحة

/**
 * VD-16 — مناطق الشحن.
 *
 * كل منطقة: تغطية (بلد، محافظة، مدينة) وتسعيرات (ثابت، حسب الوزن، مجاني فوق
 * مبلغ) ومدّة توصيل. الخادم يرفض ما يجعل سعر المشتري عشوائياً — تغطيتان
 * متعادلتان في منطقتين مفعّلتين، أو منطقة مفعّلة بلا تسعيرة — ورسالته تظهر
 * هنا كما هي. المبالغ بعملة التسوية، والمعاينة تحسب بقواعد الدفع نفسها.
 */
export default function ShippingZonesPage() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<ZonesView | null>(null);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const returned = useReturnTick();
  useEffect(() => {
    let alive = true;
    api<ZonesView>('/vendor/shipping/zones')
      .then((d) => {
        if (!alive) return;
        setData(d);
        setSelected((s) => s ?? d.zones[0]?.id ?? 'new');
      })
      // فشل التحديث عند الرجوع لا يستبدل المناطق برسالة
      .catch((e: Error) => alive && !returned && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [returned]);

  if (!data) {
    return loadError ? (
      <div className="vm-page">
        <PageHead title={t('مناطق الشحن', 'Shipping zones')} />
        <Alert tone="danger">{loadError}</Alert>
      </div>
    ) : (
      <div className="vm-loading vm-loading--page" role="status">
        <span className="visually-hidden">{t('جارٍ فتح مناطق الشحن…', 'Opening shipping zones…')}</span>
        <span className="skeleton vm-loading__title" />
        <span className="skeleton vm-loading__block" />
        <span className="skeleton vm-loading__panel" />
      </div>
    );
  }

  const { currency, zones } = data;
  const zone = zones.find((z) => z.id === selected) ?? null;
  const active = zones.filter((z) => z.isActive);
  const count = (lvl: 1 | 2 | 3) =>
    new Set(active.flatMap((z) => z.regions).filter((r) => (r.city ? 3 : r.region ? 2 : 1) === lvl).map(keyOf)).size;
  const cover = [
    count(1) ? t(`${count(1)} بلد كامل`, `${count(1)} whole ${count(1) === 1 ? 'country' : 'countries'}`) : null,
    count(2) ? t(`${count(2)} محافظة`, `${count(2)} ${count(2) === 1 ? 'governorate' : 'governorates'}`) : null,
    count(3) ? t(`${count(3)} مدينة`, `${count(3)} ${count(3) === 1 ? 'city' : 'cities'}`) : null,
  ].filter(Boolean);
  const coverEn = cover.length > 1 ? `${cover.slice(0, -1).join(', ')} and ${cover.at(-1)}` : cover.join('');

  const upsert = (z: Zone, msg: string, select = true) => {
    setData({ currency, zones: zones.some((x) => x.id === z.id) ? zones.map((x) => (x.id === z.id ? z : x)) : [...zones, z] });
    if (select) setSelected(z.id);
    setNotice(msg);
  };

  const toggleZone = async (z: Zone) => {
    setToggling(z.id);
    try {
      const next = await api<Zone>(`/vendor/shipping/zones/${z.id}`, { method: 'PATCH', body: { isActive: !z.isActive } });
      upsert(
        next,
        next.isActive
          ? t(`فُعّلت ${next.nameAr}.`, `${next.nameAr} activated.`)
          : t(`أُوقفت ${next.nameAr} — لا شراء من تغطيتها.`, `${next.nameAr} deactivated — no purchases from its coverage.`),
        false,
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="vm-page">
      <PageHead
        title={t('مناطق الشحن', 'Shipping zones')}
        meta={t(`المبالغ بعملة التسوية: ${currency}`, `Amounts in settlement currency: ${currency}`)}
        actions={
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setSelected('new');
              setNotice(null);
              setError(null);
            }}
          >
            <Icon name="plus" size={15} />
            {t('أضف منطقة', 'Add zone')}
          </button>
        }
      />

      <Alert tone="warning">
        <strong>{t('المشترون في مناطق لا تغطّيها لا يستطيعون الشراء منك.', "Buyers in areas you don't cover can't buy from you.")}</strong>{' '}
        {cover.length
          ? t(`مناطقك المفعّلة تغطّي ${cover.join(' و')} حتى الآن.`, `Your active zones cover ${coverEn} so far.`)
          : t('لا منطقة مفعّلة بعد — لا أحد يستطيع الشراء منك الآن.', 'No active zone yet — nobody can buy from you right now.')}
      </Alert>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice && !error ? <Alert tone="success">{notice}</Alert> : null}

      <div className="vx-ship">
        <section className="vx-card vx-card--flush" aria-label={t('المناطق', 'Zones')}>
          {zones.length === 0 ? (
            <EmptyState icon="truck" title={t('لا مناطق بعد', 'No zones yet')}>
              {t('أضف منطقتك الأولى: التغطية والسعر ومدّة التوصيل.', 'Add your first zone: coverage, price and delivery time.')}
            </EmptyState>
          ) : (
            <ul className="vx-zones">
              {zones.map((z) => {
                const rates = z.rates.filter((r) => r.isActive).length;
                return (
                  <li key={z.id} className={`vx-zone${z.id === selected ? ' vx-zone--on' : ''}`}>
                    <button
                      type="button"
                      className="vx-zone__pick"
                      aria-pressed={z.id === selected}
                      onClick={() => {
                        setSelected(z.id);
                        setNotice(null);
                        setError(null);
                      }}
                    >
                      <span className="vx-zone__line">
                        <span className="vx-zone__name">{z.nameAr}</span>
                        <span className="vx-zone__rates">
                          <span className="num">{rates}</span> {t('تسعيرة', rates === 1 ? 'rate' : 'rates')}
                        </span>
                      </span>
                      <span className="vx-zone__cover">{z.regions.map((r) => describe(r, locale)).join(' · ')}</span>
                    </button>
                    <span className="vx-zone__state">
                      <button
                        type="button"
                        role="switch"
                        className="vx-switch"
                        aria-checked={z.isActive}
                        aria-label={t(`${z.nameAr} مفعّلة`, `${z.nameAr} active`)}
                        disabled={toggling === z.id}
                        onClick={() => void toggleZone(z)}
                      />
                      <span className={`vx-zone__label${z.isActive ? ' vx-zone__label--on' : ''}`}>
                        {z.isActive
                          ? t('مفعّلة — المشترون فيها يستطيعون الشراء', 'Active — buyers there can buy')
                          : t('موقوفة — لا شراء من هذه المنطقة', 'Inactive — no purchases from this zone')}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="vx-editor">
          {selected === 'new' || zone ? (
            <ZoneEditor
              key={zone ? zone.id : 'new'}
              zone={zone}
              currency={currency}
              onSaved={upsert}
              onDeleted={(id) => {
                const rest = zones.filter((x) => x.id !== id);
                setData({ currency, zones: rest });
                setSelected(rest[0]?.id ?? 'new');
                setNotice(t('حُذفت المنطقة.', 'Zone deleted.'));
              }}
              onError={(m) => {
                setError(m);
                if (m) setNotice(null);
              }}
            />
          ) : null}
          {zones.length ? <Preview key={zones.length} zones={zones} currency={currency} /> : null}
        </div>
      </div>
    </div>
  );
}
