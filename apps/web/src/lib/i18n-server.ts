import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, translator, type Locale, type Translate } from './i18n';

/** لغة هذا الطلب — من كوكي زرّ اللغة. لمكوّنات الخادم؛ مكوّنات العميل تأخذها من `useLocale` */
export async function pageLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** `t('السلة', 'Cart')` في مكوّن خادم */
export async function serverT(): Promise<Translate> {
  return translator(await pageLocale());
}
