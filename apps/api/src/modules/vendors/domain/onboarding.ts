/**
 * منطق تأهيل البائع — بلا قاعدة بيانات وبلا HTTP.
 *
 * القاعدة الحاكمة هنا: **الموانع تُحسب مجتمعة لا واحداً واحداً.** البائع الذي
 * يرفع وثيقة فيُقال له «ينقصك الهوية»، ثم يرفعها فيُقال «ينقصك السجل»، يهجر
 * التسجيل. الشاشة VD-02 تعرض القائمة كاملة وكل مانع يشير إلى حقله.
 */

import {
  ConflictError,
  InvalidInputError,
  InvalidStateTransitionError,
} from '../../../common/errors/domain-error';

// ----------------------------------------------------------------- الوثائق

export const DOCUMENT_TYPES = [
  'commercial_register',
  'national_id',
  'tax_card',
  'bank_proof',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_LABELS: Readonly<Record<DocumentType, string>> = Object.freeze({
  commercial_register: 'السجل التجاري',
  national_id: 'الهوية الشخصية',
  tax_card: 'الشهادة الضريبية',
  bank_proof: 'إثبات الحساب البنكي',
});

export type DocumentStatus = 'pending' | 'accepted' | 'rejected';

export const isDocumentType = (value: string): value is DocumentType =>
  (DOCUMENT_TYPES as readonly string[]).includes(value);

/** وثائق البائع **ليست** صوراً عامة: فيها هوية شخصية وسجل تجاري. */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png']);

export class DocumentRejectedError extends InvalidInputError {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentRejectedError';
  }
}

/**
 * نوع الملف من محتواه لا من امتداده ولا من ترويسة العميل: كلاهما يُزوَّر،
 * والملف المرفوع هنا يُعرَض على مراجع بشري ويُخزَّن سنوات.
 */
export function sniffDocumentMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.subarray(0, 8).equals(png)) return 'image/png';
  return null;
}

export function assertDocumentFile(buffer: Buffer): string {
  if (buffer.length === 0) throw new DocumentRejectedError('الملف فارغ.');
  if (buffer.length > DOCUMENT_MAX_BYTES) {
    throw new DocumentRejectedError(
      `حجم الملف يتجاوز ${DOCUMENT_MAX_BYTES / (1024 * 1024)} ميغابايت. اضغطه أو صوّره بجودة أقل.`,
    );
  }
  const mime = sniffDocumentMime(buffer);
  if (mime === null) {
    throw new DocumentRejectedError('الملف ليس PDF ولا صورة JPEG أو PNG. حوّله ثم أعد الرفع.');
  }
  return mime;
}

// -------------------------------------------------------------- دورة الحياة

/**
 * `pending` هنا معناها «مسوّدة: سجّل ولم يُرسل بعد».
 * فصلُ `in_review` و `rejected` عنها متعمَّد: ثلاث حالات مختلفة فعلاً،
 * ولو خُزّنت في تاريخ فارغ أو سبب رفض غير فارغ لأعاد كل استعلام اشتقاقها.
 */
export type VendorLifecycle =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'banned';

/** البيع مسموح في حالة واحدة. كل ما عداها يمنع النشر واستقبال الطلبات. */
export const canSell = (status: VendorLifecycle): boolean => status === 'approved';

const TRANSITIONS: Readonly<Record<VendorLifecycle, readonly VendorLifecycle[]>> = Object.freeze({
  pending: ['in_review', 'banned'],
  in_review: ['approved', 'rejected', 'banned'],
  rejected: ['in_review', 'banned'],
  approved: ['suspended', 'banned'],
  suspended: ['approved', 'banned'],
  banned: [],
});

export function assertTransition(from: VendorLifecycle, to: VendorLifecycle): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidStateTransitionError(STATUS_LABELS[from], STATUS_LABELS[to]);
  }
}

export const STATUS_LABELS: Readonly<Record<VendorLifecycle, string>> = Object.freeze({
  pending: 'مسوّدة',
  in_review: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  suspended: 'معلَّق',
  banned: 'محظور',
});

// ------------------------------------------------------------------ الرابط

const SLUG_MAX = 40;

/**
 * الرابط يُشتقّ من الاسم الإنجليزي إن وُجد، فهو ما يظهر في `basta.com/s/...`.
 * العربية تُحوَّل حرفياً لا صوتياً: بائع بلا اسم إنجليزي يحصل على رابط صالح
 * يستطيع تغييره، لا على رفض يوقف تسجيله.
 */
const ARABIC_TO_LATIN: Readonly<Record<string, string>> = Object.freeze({
  ا: 'a', أ: 'a', إ: 'a', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z',
  ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'h',
  و: 'w', ي: 'y', ى: 'a', ئ: 'y', ء: '', ؤ: 'w',
});

export function vendorSlug(name: string): string {
  const latin = [...name.trim().toLowerCase()]
    .map((ch) => ARABIC_TO_LATIN[ch] ?? ch)
    .join('')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return latin;
}

/**
 * اسم المتجر كما يُحفظ: بلا مسافات في طرفيه، وما تتابع منها في وسطه مسافة واحدة. كان القصّ
 * للطرفين وحدهما، فـ«ركن␣␣الصوف» يُحفظ بمسافتين لا تراهما الصفحة ويظهران في البريد النصي،
 * ويصير الاسم الواحد لعين القارئ اسمين للمقارنة (VON-014، 28 أكتوبر 2026).
 */
export const storeName = (raw: string): string => raw.trim().replace(/\s+/g, ' ');

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

/** أسماء تصطدم بمسارات المنصة نفسها أو تنتحل صفتها. */
const RESERVED_SLUGS = Object.freeze(
  new Set(['admin', 'api', 'vendor', 'basta', 'account', 'cart', 'checkout', 'search', 's', 'p', 'c']),
);

export function assertSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new InvalidInputError(
      'رابط المتجر يقبل الحروف اللاتينية الصغيرة والأرقام والشرطة، ويتراوح بين حرفين و40 حرفاً.',
      { slug },
    );
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new InvalidInputError('هذا الرابط محجوز للمنصة. اختر غيره.', { slug });
  }
}

/** اقتراح بديل عند التصادم: `dar-alqutn` → `dar-alqutn-2` ثم `-3`. */
export function suggestSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new InvalidInputError('تعذّر اقتراح رابط متاح. اكتب رابطاً من عندك.', { base });
}

// ------------------------------------------------------------- الحساب البنكي

/**
 * IBAN يُتحقَّق بخوارزمية mod-97 (ISO 13616) لا بالطول وحده.
 * رقم بخانة مقلوبة يمرّ فحص الطول ويسقط في البنك بعد أسبوعين من البيع.
 */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export const normalizeIban = (raw: string): string => raw.replace(/[\s-]/g, '').toUpperCase();

// -------------------------------------------------------------- عملة التسوية

export const SETTLEMENT_CURRENCIES = Object.freeze([
  'USD',
  'SAR',
  'AED',
  'JOD',
  'KWD',
  'EGP',
  'EUR',
]);

/** العملة الافتراضية من بلد المتجر — تُعرض مختارة في VD-04 ويبقى تغييرها ممكناً. */
const COUNTRY_CURRENCY: Readonly<Record<string, string>> = Object.freeze({
  SA: 'SAR', AE: 'AED', JO: 'JOD', KW: 'KWD', EG: 'EGP', QA: 'USD', BH: 'USD', OM: 'USD',
});

export const defaultCurrencyFor = (country: string): string =>
  COUNTRY_CURRENCY[country.toUpperCase()] ?? 'USD';

export function assertSettlementCurrency(currency: string): void {
  if (!SETTLEMENT_CURRENCIES.includes(currency)) {
    throw new InvalidInputError(`العملة ${currency} غير مدعومة للتسوية.`, { currency });
  }
}

/** حالات التأهيل التي تتغيّر فيها العملة — قبل الإرسال للمراجعة أو بعد رفضه */
const CURRENCY_OPEN_STATES: readonly VendorLifecycle[] = ['pending', 'rejected'];

/** العملة مقفلة في عين البائع: مثبَّتة، أو المتجر تجاوز التأهيل — الواجهة لا تعرض ما سيُرفض */
export const currencyLocked = (lockedAt: Date | null, status: VendorLifecycle): boolean =>
  lockedAt !== null || !CURRENCY_OPEN_STATES.includes(status);

/**
 * ADR-013: عملة التسوية تُثبَّت ولا تُغيَّر بعد تثبيتها.
 * تغييرها لاحقاً يعني محفظة جديدة وتسوية القديمة وأسعاراً أُعيد تفسيرها —
 * فالمنع هنا أرخص من التصحيح هناك.
 *
 * التثبيت كان اختيارياً (lock في الطلب): متجر لم يثبّتها يُعتمد ويبيع ثم يغيّرها،
 * فتُقرأ كل أسعاره وأسعار شحنه بعملة أخرى — 19.900 د.أ مخزّنة 19900 تصير 199.00 ر.س.
 * الآن ثلاثة شروط لا شرط واحد:
 * - غير مثبَّتة (والاعتماد يثبّتها)
 * - المتجر في التأهيل (pending أو rejected): ما يراجعه المدير هو ما يُعتمد
 * - لا شيء مسعَّر بها بعد: متغيّر منتج أو سعر شحن أو طلب
 */
export function assertCurrencyChangeable(state: {
  lockedAt: Date | null;
  status: VendorLifecycle;
  priced: boolean;
}): void {
  if (state.lockedAt !== null) {
    throw new ConflictError(
      'عملة التسوية مثبَّتة ولا يمكن تغييرها. راسل الدعم إن كان التثبيت خطأً.',
      { lockedAt: state.lockedAt.toISOString() },
    );
  }
  if (!CURRENCY_OPEN_STATES.includes(state.status)) {
    throw new ConflictError('عملة التسوية تتغيّر قبل إرسال الطلب للمراجعة فقط. راسل الدعم إن احتجت تغييرها.', {
      status: state.status,
    });
  }
  if (state.priced) {
    throw new ConflictError(
      'أسعار منتجاتك أو شحنك مكتوبة بالعملة الحالية — تغييرها يغيّر معنى كل سعر. احذف المسعَّر أولاً أو راسل الدعم.',
    );
  }
}

// -------------------------------------------------------------------- الموانع

export interface Blocker {
  /** رمز ثابت تقرأه الواجهة لتربط المانع بحقله */
  readonly code: string;
  readonly message: string;
  readonly field: string;
}

export interface OnboardingSnapshot {
  readonly nameAr: string;
  readonly slug: string;
  readonly country: string;
  /** اختار البائع عملة التسوية صراحةً (VD-04) — المقترحة من البلد لا تكفي */
  readonly currencyChosen: boolean;
  readonly documents: readonly { type: string; status: string; rejectReason: string | null }[];
  readonly bank: { iban: string; holderName: string } | null;
}

/**
 * كل ما يمنع إرسال الطلب للمراجعة، مجتمعاً ومرتّباً كترتيب الشاشة.
 * القائمة الفارغة هي الإذن بالإرسال — لا فحص ثانٍ في مكان آخر.
 */
export function submissionBlockers(snapshot: OnboardingSnapshot): readonly Blocker[] {
  const blockers: Blocker[] = [];

  if (snapshot.nameAr.trim().length < 2) {
    blockers.push({
      code: 'name_missing',
      message: 'اسم المتجر بالعربية مطلوب.',
      field: 'nameAr',
    });
  }

  // الاعتماد يثبّتها ولا تتغيّر بعده — فلا تُرسل بعملة لم يرها صاحبها
  if (!snapshot.currencyChosen) {
    blockers.push({
      code: 'currency_unchosen',
      message: 'اختر عملة التسوية — تُسعَّر بها منتجاتك وتُحوَّل بها مستحقاتك، ولا تتغيّر بعد اعتماد متجرك.',
      field: 'settlementCurrency',
    });
  }

  for (const type of DOCUMENT_TYPES) {
    const doc = snapshot.documents.find((d) => d.type === type);
    if (!doc) {
      blockers.push({
        code: `document_missing:${type}`,
        message: `${DOCUMENT_LABELS[type]}: لم تُرفع بعد.`,
        field: `documents.${type}`,
      });
      continue;
    }
    if (doc.status === 'rejected') {
      blockers.push({
        code: `document_rejected:${type}`,
        message: `${DOCUMENT_LABELS[type]}: ${doc.rejectReason ?? 'مرفوضة'} — ارفعها من جديد.`,
        field: `documents.${type}`,
      });
    }
  }

  if (!snapshot.bank) {
    blockers.push({
      code: 'bank_missing',
      message: 'بيانات الحساب البنكي مطلوبة لاستلام مستحقاتك.',
      field: 'bank.iban',
    });
  } else if (!isValidIban(snapshot.bank.iban)) {
    blockers.push({
      code: 'bank_iban_invalid',
      message: 'رقم الآيبان غير صحيح. راجعه كما هو مكتوب في كشف حسابك.',
      field: 'bank.iban',
    });
  } else if (snapshot.bank.holderName.trim().length < 3) {
    blockers.push({
      code: 'bank_holder_missing',
      message: 'اسم صاحب الحساب مطلوب كما هو لدى البنك.',
      field: 'bank.holderName',
    });
  }

  return blockers;
}
