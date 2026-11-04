/**
 * متغيّرات الإشعار بالإنجليزية لمن لغة حسابه الإنجليزية (4 نوفمبر 2026). تُكتب المتغيّرات بالعربية
 * عند الحدث في 47 موضعاً، وتُترجم هنا عند الإرسال وحده — فلا يتغيّر موضع، ولا يُخزَّن الإشعار
 * إلا بما وصل صاحبه.
 *
 * ما يكتبه الكود يُترجم: المبالغ («125.500 د.أ.» ← «JOD 125.500»)، والحالات والأسباب والقرارات
 * وعناوين الوثائق (قاموس الخادم en.ts عبر toEnglish)، وسطور التحويل والمخزون، وموعد التحويل.
 * وما كتبه إنسان يبقى كما كتبه: أسماء المتاجر والمنتجات والأشخاص، والنصوص الحرّة، والمراجع — إلا
 * المتجر يصله إشعاره باسمه الإنجليزي الذي كتبه هو (store_name_en).
 */
import { toEnglish } from '../../../common/i18n/translate';
import { CURRENCY_CODES, format, minorUnitDigits, money } from '../../../common/money/money';

/** علامات الاتجاه التي يلفّ بها Intl المبالغ العربية */
const MARKS = new RegExp(`[${String.fromCodePoint(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

/** «د.أ» ← JOD … الرمز كما يكتبه format بالعربية نفسه، بلا نقطته الأخيرة (العيّنات تكتبه بلا نقطة) */
const symbolOf = (formatted: string): string =>
  formatted.replace(MARKS, '').replace(/[\d.,\s-]+/, ' ').trim().replace(/\.$/, '');
const CURRENCY_BY_SYMBOL: ReadonlyMap<string, string> = new Map(CURRENCY_CODES.map((code) => [symbolOf(format(money(0, code), 'ar')), code]));

/** «‏125.500 د.أ.‏» ← «JOD 125.500»، وما ليس مبلغاً معروفاً يعود null */
export function englishMoney(value: string): string | null {
  const m = /^(-?[\d,]+(?:\.\d+)?)\s*(.+)$/.exec(value.replace(MARKS, '').trim());
  if (!m) return null;
  const code = CURRENCY_BY_SYMBOL.get(m[2]!.trim().replace(/\.$/, ''));
  if (!code) return null;
  const digits = minorUnitDigits(code);
  const [whole = '0', frac = ''] = m[1]!.replace(/,/g, '').split('.');
  const negative = whole.startsWith('-');
  const minor = BigInt(whole.replace('-', '') + frac.padEnd(digits, '0').slice(0, digits));
  return format(money(negative ? -minor : minor, code), 'en');
}

/** سطور المخزون المنخفض: «اسم (SKU): بقي 2»، «…: نفد»، و«وغيرها في صفحة المخزون» */
const LOW_STOCK_MORE = 'وغيرها في صفحة المخزون';
const englishStock = (items: string): string =>
  items
    .split('، ')
    .map((part) =>
      part === LOW_STOCK_MORE ? 'and more on the inventory page' : part.replace(/: بقي (\d+)$/, ': $1 left').replace(/: نفد$/, ': out of stock'),
    )
    .join(', ');

/** وجهة التحويل: عناوين السطور تُترجم، وما ضبطته الإدارة بعدها يبقى (checkout.service payToLines) */
const PAY_TO_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['كليك: ', 'CliQ: '],
  ['البنك: ', 'Bank: '],
  ['المستفيد: ', 'Beneficiary: '],
];
const englishPayTo = (lines: string): string =>
  lines
    .split('\n')
    .map((line) => {
      const label = PAY_TO_LABELS.find(([ar]) => line.startsWith(ar));
      return label ? label[1] + line.slice(label[0].length) : line;
    })
    .join('\n');

/** موعد التحويل بصيغة إنجليزية من لحظته المحفوظة (deadline_at) — بتوقيت عمّان كالعربية */
const DEADLINE_EN = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Amman' });

/** متغيّرات نصّها مما يكتبه الكود — تُطابَق بقاموس الخادم. ما سواها (أسماء، نصوص حرّة) لا يُمسّ */
const CODE_TEXT = new Set(['status', 'reason', 'outcome', 'check', 'kind', 'document', 'sender', 'tracking_label', 'context']);

export function englishVars(vars: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = { ...vars };
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value !== 'string') continue;
    if (key === 'amount') out[key] = englishMoney(value) ?? value;
    else if (key === 'items') out[key] = englishStock(value);
    else if (key === 'pay_to') out[key] = englishPayTo(value);
    else if (key === 'deadline' && vars['deadline_at']) out[key] = DEADLINE_EN.format(new Date(vars['deadline_at']));
    // المتجر يُخاطَب باسمه الإنجليزي إن وصل معه (enqueueVendor) — وإلا فباسمه كما كتبه
    else if (key === 'store_name' && vars['store_name_en']) out[key] = vars['store_name_en'];
    // التحية لمن لا اسم له: «عميلنا» ← «there» — والاسم المكتوب يبقى
    else if (key === 'name' && value === 'عميلنا') out[key] = toEnglish(value);
    else if (CODE_TEXT.has(key)) out[key] = toEnglish(value);
  }
  return out;
}

/** «1 hours» ← «1 hour» — نظيرة arabicCounts للقوالب الإنجليزية: العدد يأتي من متغيّر */
const SINGULAR: Readonly<Record<string, string>> = { hours: 'hour', days: 'day', minutes: 'minute', stores: 'store', rows: 'row' };
export const englishCounts = (text: string): string =>
  text.replace(/\b1 (hours|days|minutes|stores|rows)\b/g, (_, plural: string) => `1 ${SINGULAR[plural]}`);
