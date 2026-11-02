'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALE_COOKIE, translator, type Locale, type Translate } from '@/lib/i18n';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** في الجذر: لغة الطلب كما قرأها الخادم من الكوكي — منها تقرأ مكوّنات العميل */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

/** `const t = useT(); t('السلة', 'Cart')` */
export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}

/**
 * يختار الزائر لغة: الكوكي سنة، ثم تُعاد الصفحة كاملة — الخادم يصيّرها بلغتها
 * واتجاهها من أول بايت، كما تفعل عملة العرض.
 */
function chooseLocale(next: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.location.reload();
}

/**
 * زرّ اللغة — يعرض اللغة التي ينقل إليها: «EN» في العربية، و«ع» في الإنجليزية.
 * اسمه بلغة وجهته (`lang`)، فقارئ الشاشة ينطقه كما يعرفه من يبحث عنه.
 */
export function LanguageToggle() {
  const locale = useLocale();
  const next: Locale = locale === 'ar' ? 'en' : 'ar';
  const label = next === 'en' ? 'English' : 'العربية';
  return (
    // مربّع كأخواته في الرأس بلا أيقونة: على عرض 400 لا يتّسع الرأس لزرّ أعرض
    <button type="button" className="icon-btn lang-btn" lang={next} aria-label={label} title={label} onClick={() => chooseLocale(next)}>
      {next === 'en' ? 'EN' : 'ع'}
    </button>
  );
}
