/**
 * لغة الطلب — زرّ اللغة في الموقع (2 نوفمبر 2026). الواجهة ترسل `accept-language` بلغة
 * الصفحة لا بلغة المتصفّح (apps/web lib/api.ts)، فـ «en» أوّلاً تعني الإنجليزية، وما سواه
 * عربية: العربية لغة الموقع الأولى، ومن لا يرسل الرأس (سكربت، عميل قديم) يسمعها.
 */
export type Locale = 'ar' | 'en';

export function localeOf(acceptLanguage: string | string[] | undefined): Locale {
  const first = (Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage)?.split(',')[0]?.trim().toLowerCase() ?? '';
  return first === 'en' || first.startsWith('en-') ? 'en' : 'ar';
}
