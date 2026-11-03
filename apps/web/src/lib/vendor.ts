'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, session } from './api';
import { useReturnTick } from './fresh';
import { documentLocale, intlLocale, type Locale } from './i18n';
import { withNext } from './safe-path';
import type { Blocker } from '@/components/ui';

export type VendorStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'suspended' | 'banned';
export type DocumentType = 'commercial_register' | 'national_id' | 'tax_card' | 'bank_proof';

export interface OnboardingDocument {
  type: DocumentType;
  label: string;
  uploaded: boolean;
  status: 'missing' | 'pending' | 'accepted' | 'rejected';
  rejectReason: string | null;
  originalName: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  downloadPath: string | null;
}

export interface Onboarding {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  country: string;
  businessType: string | null;
  status: VendorStatus;
  rejectionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  settlementCurrency: string;
  settlementCurrencyLocked: boolean;
  /** اختارها البائع صراحةً (VD-04) — وإلا فهي المقترحة من بلده، والإرسال ممنوع حتى يختار */
  settlementCurrencyChosen: boolean;
  descriptionAr: string | null;
  descriptionEn: string | null;
  shippingPolicyAr: string | null;
  returnPolicyAr: string | null;
  documents: OnboardingDocument[];
  bank: { holderName: string; iban: string; bankName: string; swift: string | null } | null;
  blockers: Blocker[];
  canSubmit: boolean;
}

/**
 * حالة التأهيل مصدرها الخادم في كل قراءة — بما فيها الموانع.
 * حسابها في الواجهة يعني نسختين من القاعدة تفترقان أول ما تتغيّر واحدة.
 */
/** رسالة احتياطية بلغة الصفحة حين لا يحمل الخطأ نصّاً */
const loadFailed = (): string =>
  documentLocale() === 'en' ? "Couldn't load your shop status." : 'تعذّر تحميل حالة المتجر.';

export function useOnboarding(): {
  data: Onboarding | null;
  error: string | null;
  loading: boolean;
  /** لا متجر على هذا الحساب بعد — يحوّل إلى التسجيل وحده، والشاشة لا ترسم شيئاً */
  missing: boolean;
  reload: () => Promise<void>;
  set: (next: Onboarding) => void;
} {
  const router = useRouter();
  const [data, setData] = useState<Onboarding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  /**
   * القراءة لا تضبط حالةً قبل أول `await`: الضبط المتزامن داخل التأثير يُطلق
   * دورة تصيير إضافية عند كل تركيب. `loading` يبدأ `true` أصلاً، فالمؤشّر
   * يظهر في أول تصيير بلا ضبط، ولا يُرفع إلا في إعادة تحميل يدوية.
   */
  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const next = await api<Onboarding>('/vendor/onboarding');
      setData(next);
      setError(null);
      setMissing(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
      else setError(err instanceof Error ? err.message : loadFailed());
    } finally {
      setLoading(false);
    }
  }, []);

  const reload = useCallback(() => load(true), [load]);

  /**
   * التحميل الأول داخل التأثير نفسه: كل ضبط للحالة يقع **بعد** `await`، فلا
   * يجري تصيير متتالٍ. و`alive` يمنع الكتابة على مكوّن فُكّ قبل وصول الرد.
   *
   * زائر بلا جلسة (رابط محفوظ أو مكتوب) يذهب إلى الدخول ومعه الصفحة نفسها، كقشرة
   * الإدارة. كانت اللوحة تقف على «مطلوب تسجيل الدخول.» وحده بلا رابط ولا قائمة فيعلق
   * (VOPS-009). لا يُطلب الخادم أصلاً، والمؤشّر يبقى حتى يصل الدخول.
   */
  const returned = useReturnTick();
  useEffect(() => {
    if (!session.read()) {
      router.replace(withNext('/login', `${window.location.pathname}${window.location.search}`));
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const next = await api<Onboarding>('/vendor/onboarding');
        if (!alive) return;
        // الرجوع إلى الصفحة يجلب من جديد بصمت: ما لم يتغيّر يبقى بمرجعه، فلا يُعاد ما بُني عليه
        setData((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
        setError(null);
        setMissing(false);
      } catch (err) {
        // فشل التحديث عند الرجوع لا يمحو ما على الشاشة — الرجوع التالي يعيد المحاولة
        if (!alive || returned) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err instanceof Error ? err.message : loadFailed());
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, returned]);

  /**
   * لا متجر ← التسجيل، بعد الرسم لا أثناءه. كانت كل شاشة تنادي `router.replace` في جسمها،
   * فيحدّث الموجّه وهو يرسم غيره ويرفضه React («Cannot update a component while rendering»،
   * ظهر «1 Issue» في VON-013، 28 أكتوبر 2026).
   */
  useEffect(() => {
    if (missing) router.replace('/vendor/register');
  }, [missing, router]);

  return { data, error, loading, missing, reload, set: setData };
}

/** `nameEn` و`symbolEn` للواجهة الإنجليزية — الرمز العربي يُكتب بالرمز الدولي هناك */
export const CURRENCIES: readonly { code: string; nameAr: string; nameEn: string; symbol: string; symbolEn: string; digits: number }[] = [
  { code: 'JOD', nameAr: 'دينار أردني', nameEn: 'Jordanian Dinar', symbol: 'د.أ', symbolEn: 'JOD', digits: 3 },
  { code: 'SAR', nameAr: 'ريال سعودي', nameEn: 'Saudi Riyal', symbol: '﷼', symbolEn: 'SAR', digits: 2 },
  { code: 'AED', nameAr: 'درهم إماراتي', nameEn: 'UAE Dirham', symbol: 'د.إ', symbolEn: 'AED', digits: 2 },
  { code: 'KWD', nameAr: 'دينار كويتي', nameEn: 'Kuwaiti Dinar', symbol: 'د.ك', symbolEn: 'KWD', digits: 3 },
  { code: 'EGP', nameAr: 'جنيه مصري', nameEn: 'Egyptian Pound', symbol: 'ج.م', symbolEn: 'EGP', digits: 2 },
  { code: 'USD', nameAr: 'دولار أمريكي', nameEn: 'US Dollar', symbol: '$', symbolEn: '$', digits: 2 },
  { code: 'EUR', nameAr: 'يورو', nameEn: 'Euro', symbol: '€', symbolEn: '€', digits: 2 },
];

export const COUNTRIES: readonly { code: string; nameAr: string; nameEn: string }[] = [
  { code: 'JO', nameAr: 'الأردن', nameEn: 'Jordan' },
  { code: 'SA', nameAr: 'السعودية', nameEn: 'Saudi Arabia' },
  { code: 'AE', nameAr: 'الإمارات', nameEn: 'United Arab Emirates' },
  { code: 'KW', nameAr: 'الكويت', nameEn: 'Kuwait' },
  { code: 'EG', nameAr: 'مصر', nameEn: 'Egypt' },
  { code: 'QA', nameAr: 'قطر', nameEn: 'Qatar' },
  { code: 'BH', nameAr: 'البحرين', nameEn: 'Bahrain' },
  { code: 'OM', nameAr: 'عُمان', nameEn: 'Oman' },
];

/** أرقام لاتينية دائماً، وخانات كل عملة كما هي — DESIGN-SYSTEM §7 */
export function formatAmount(amount: number, currency: string, locale: Locale = 'ar'): string {
  const digits = CURRENCIES.find((c) => c.code === currency)?.digits ?? 2;
  return new Intl.NumberFormat(locale === 'en' ? intlLocale(locale) : 'ar-JO-u-nu-latn', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
