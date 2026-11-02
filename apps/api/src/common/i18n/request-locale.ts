import { AsyncLocalStorage } from 'node:async_hooks';
import { localeOf, type Locale } from './locale';

/**
 * لغة الطلب الجاري لكل ما يُكتب في الردّ (المبالغ المنسّقة، الرسائل) — بلا تمريرها في كل
 * دالة. تُضبط في أول الطلب (app.setup)، وما يجري خارج طلب (المهام الدورية، الإشعارات
 * المؤجّلة) يرى العربية.
 *
 * الموقع يرسلها رأسَ `accept-language` من المتصفّح، و `?lang=` من صفحات الخادم: ذاكرة
 * Next تُفرّق بالعنوان لا بالرأس، فنسخة الإنجليزية غير نسخة العربية.
 */
const storage = new AsyncLocalStorage<Locale>();

export const currentLocale = (): Locale => storage.getStore() ?? 'ar';

export function requestLocale(req: { headers: Record<string, string | string[] | undefined>; query?: unknown }): Locale {
  const lang = (req.query as { lang?: unknown } | undefined)?.lang;
  if (lang === 'en' || lang === 'ar') return lang;
  return localeOf(req.headers['accept-language']);
}

/**
 * معامل اللغة يُقرأ ثم يُنزع: فحص المعاملات يرفض ما لا يعرفه (forbidNonWhitelisted)، فكان
 * `/storefront/products?…&lang=en` يرتدّ 400 «في الطلب حقل غير معروف» وتسقط صفحة البحث.
 */
export function takeRequestLocale(req: { headers: Record<string, string | string[] | undefined>; query?: unknown }): Locale {
  const locale = requestLocale(req);
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query === 'object' && 'lang' in query) delete query['lang'];
  return locale;
}

export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}
