import { EN_MESSAGES, EN_TEMPLATES } from './en';
import type { Locale } from './locale';

/**
 * رسائل الخادم بالإنجليزية — تُترجم عند الخروج في معالج الأخطاء، لا عند كل `throw`:
 * الرسالة العربية تبقى في مكانها مقروءة كما كُتبت، والقاموس في ملف واحد (./en.ts).
 *
 * الرسالة بلا متغيّرات تُطابَق حرفياً. والقالب (`عملة غير معروفة: ${currency}.`) يُكتب
 * مفتاحه بـ {0} و {1} مكان متغيّراته، وتُعاد المتغيّرات في الإنجليزية بأرقامها — فيجوز
 * تبديل ترتيبها. ما لا يُعرف يبقى عربياً: نصّ عربي صحيح أصدق من ترجمة مخمَّنة،
 * و en-coverage.spec.ts يُسقط الفحص إن أُضيفت رسالة بلا ترجمة.
 */

interface Compiled {
  re: RegExp;
  en: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compiled: Compiled[] = Object.entries(EN_TEMPLATES).map(([ar, en]) => ({
  // {0} وأخواتها تطابق أي نصّ غير فارغ — بأقصر مطابقة كي لا يبتلع متغيّرٌ ما بعده
  re: new RegExp(`^${escape(ar).replace(/\\\{\d+\\\}/g, '([\\s\\S]+?)')}$`),
  en,
}));

/** ترتيب أرقام المتغيّرات كما وردت في المفتاح العربي */
const orderOf = (ar: string): number[] => [...ar.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
const orders = Object.keys(EN_TEMPLATES).map(orderOf);

export function toEnglish(message: string): string {
  const exact = EN_MESSAGES[message];
  if (exact !== undefined) return exact;
  for (let i = 0; i < compiled.length; i++) {
    const { re, en } = compiled[i]!;
    const m = re.exec(message);
    if (!m) continue;
    const values: Record<number, string> = {};
    orders[i]!.forEach((n, k) => {
      const v = m[k + 1] ?? '';
      // متغيّر هو نفسه رسالة معروفة (اسم حقل، حالة): يُترجم أيضاً
      values[n] = EN_MESSAGES[v] ?? v;
    });
    return en.replace(/\{(\d+)\}/g, (_, n: string) => values[Number(n)] ?? '');
  }
  return message;
}

export function localize(message: string, locale: Locale): string {
  return locale === 'en' ? toEnglish(message) : message;
}
