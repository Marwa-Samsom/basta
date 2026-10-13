'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
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
export function useOnboarding(): {
  data: Onboarding | null;
  error: string | null;
  loading: boolean;
  /** لا متجر على هذا الحساب بعد — الشاشة تحوّل إلى التسجيل */
  missing: boolean;
  reload: () => Promise<void>;
  set: (next: Onboarding) => void;
} {
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
      else setError(err instanceof Error ? err.message : 'تعذّر تحميل حالة المتجر.');
    } finally {
      setLoading(false);
    }
  }, []);

  const reload = useCallback(() => load(true), [load]);

  /**
   * التحميل الأول داخل التأثير نفسه: كل ضبط للحالة يقع **بعد** `await`، فلا
   * يجري تصيير متتالٍ. و`alive` يمنع الكتابة على مكوّن فُكّ قبل وصول الرد.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next = await api<Onboarding>('/vendor/onboarding');
        if (!alive) return;
        setData(next);
        setError(null);
        setMissing(false);
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err instanceof Error ? err.message : 'تعذّر تحميل حالة المتجر.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { data, error, loading, missing, reload, set: setData };
}

export const CURRENCIES: readonly { code: string; nameAr: string; symbol: string; digits: number }[] = [
  { code: 'JOD', nameAr: 'دينار أردني', symbol: 'د.أ', digits: 3 },
  { code: 'SAR', nameAr: 'ريال سعودي', symbol: '﷼', digits: 2 },
  { code: 'AED', nameAr: 'درهم إماراتي', symbol: 'د.إ', digits: 2 },
  { code: 'KWD', nameAr: 'دينار كويتي', symbol: 'د.ك', digits: 3 },
  { code: 'EGP', nameAr: 'جنيه مصري', symbol: 'ج.م', digits: 2 },
  { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', digits: 2 },
  { code: 'EUR', nameAr: 'يورو', symbol: '€', digits: 2 },
];

export const COUNTRIES: readonly { code: string; nameAr: string }[] = [
  { code: 'JO', nameAr: 'الأردن' },
  { code: 'SA', nameAr: 'السعودية' },
  { code: 'AE', nameAr: 'الإمارات' },
  { code: 'KW', nameAr: 'الكويت' },
  { code: 'EG', nameAr: 'مصر' },
  { code: 'QA', nameAr: 'قطر' },
  { code: 'BH', nameAr: 'البحرين' },
  { code: 'OM', nameAr: 'عُمان' },
];

/** أرقام لاتينية دائماً، وخانات كل عملة كما هي — DESIGN-SYSTEM §7 */
export function formatAmount(amount: number, currency: string): string {
  const digits = CURRENCIES.find((c) => c.code === currency)?.digits ?? 2;
  return new Intl.NumberFormat('ar-JO-u-nu-latn', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
