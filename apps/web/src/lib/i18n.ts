/**
 * لغة الموقع — قرار صاحبة المشروع 2 نوفمبر 2026: زرّ في الرأس يقلب الموقع كله بين
 * العربية والإنجليزية، والعرض الأصلي وعد باللغتين.
 *
 * الاختيار كوكي لا تخزين محلي، كعملة العرض: الصفحة تُصيَّر في الخادم بلغتها واتجاهها
 * (`<html lang dir>`)، فلا ترمش عربيةً ثم تنقلب. بلا كوكي: العربية.
 *
 * النصّ يُكتب باللغتين حيث يُستعمل — `t('السلة', 'Cart')` — فالعربي يبقى مقروءاً في
 * مكانه، وما لم يُترجم بعد يبقى عربياً لا مفتاحاً فارغاً. الترجمة تمشي قسماً قسماً.
 */
export type Locale = 'ar' | 'en';

export const LOCALE_COOKIE = 'basta.lang';
export const DEFAULT_LOCALE: Locale = 'ar';

export const isLocale = (value: unknown): value is Locale => value === 'ar' || value === 'en';

export const dirOf = (locale: Locale): 'rtl' | 'ltr' => (locale === 'ar' ? 'rtl' : 'ltr');

/** نصّ باللغتين — لقوائم ثابتة (أقسام اللوحة، روابط التذييل) تُعرَّف خارج المكوّن */
export interface Bilingual {
  ar: string;
  en: string;
}

export type Translate = (ar: string, en: string) => string;

export const translator =
  (locale: Locale): Translate =>
  (ar, en) =>
    locale === 'en' ? en : ar;

export const pick = (locale: Locale, text: Bilingual): string => text[locale];

/** لغة Intl للتواريخ والأعداد: الأرقام لاتينية في اللغتين — DESIGN-SYSTEM §7 */
export const intlLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-u-nu-latn' : 'en-GB');
