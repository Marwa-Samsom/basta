import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localeOf } from './locale';
import { localize, toEnglish } from './translate';

/**
 * كل رسالة عربية يرميها الخادم للمستخدم لها ترجمة — يقرأ المصدر كما يقرؤه المطوّر: الوسيط
 * الأول لكل `new XxxError(…)` و `new XxxException(…)` و `super(…)`، ورسائل `message:` في
 * المتحكّمات وملفات الـ DTO. رسالة جديدة بلا ترجمة تُسقط هذا الفحص باسمها وملفها.
 */
const SRC = join(__dirname, '..', '..');
const ARABIC = /[؀-ۿ]/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) ? [p] : [];
  });
}

interface Found {
  text: string;
  file: string;
}

function messages(): Found[] {
  const out = new Map<string, Found>();
  const add = (text: string, file: string) => {
    if (ARABIC.test(text) && !out.has(text)) out.set(text, { text, file: relative(SRC, file).replace(/\\/g, '/') });
  };
  for (const file of sources(SRC)) {
    if (file.includes(`${join('common', 'i18n')}`)) continue;
    const src = readFileSync(file, 'utf8');
    const literal = String.raw`(['"\`])((?:\\.|(?!\1)[\s\S])*?)\1`;
    for (const m of src.matchAll(new RegExp(String.raw`new\s+[A-Z]\w*(?:Error|Exception)\(\s*${literal}`, 'g'))) add(m[2]!, file);
    for (const m of src.matchAll(new RegExp(String.raw`super\(\s*${literal}`, 'g'))) add(m[2]!, file);
    if (/controllers?\.ts$|dto/.test(file)) {
      for (const m of src.matchAll(new RegExp(String.raw`message:\s*${literal}`, 'g'))) add(m[2]!, file);
    }
  }
  return [...out.values()];
}

/** القالب بقيم نموذجية لاتينية مكان متغيّراته: `${currency}` ← X0 */
const sample = (text: string) => {
  let i = 0;
  return text.replace(/\$\{[^}]*\}/g, () => `X${i++}`);
};

describe('رسائل الخادم بالإنجليزية', () => {
  it('كل رسالة عربية في المصدر لها ترجمة لا عربية فيها', () => {
    const missing = messages()
      .map((f) => ({ ...f, en: toEnglish(sample(f.text)) }))
      .filter((f) => ARABIC.test(f.en))
      .map((f) => `${f.file}: ${f.text}`);
    expect(missing, `بلا ترجمة (${missing.length}):\n${missing.slice(0, 40).join('\n')}`).toEqual([]);
  });

  it('القالب يعيد متغيّراته بأماكنها، والعربية تبقى كما هي', () => {
    const ar = 'حدث خلل غير متوقّع ولم يكتمل طلبك. أعد المحاولة، وإن تكرّر أبلغنا بالرقم req-7.';
    expect(localize(ar, 'ar')).toBe(ar);
    expect(localize(ar, 'en')).toContain('req-7');
    expect(localize('نصّ لا يعرفه القاموس', 'en')).toBe('نصّ لا يعرفه القاموس');
  });

  it('لغة الطلب من accept-language: en أولاً إنجليزية، وما سواه عربية', () => {
    expect(localeOf('en')).toBe('en');
    expect(localeOf('en-GB,en;q=0.9')).toBe('en');
    expect(localeOf('ar')).toBe('ar');
    expect(localeOf('fr,en;q=0.5')).toBe('ar');
    expect(localeOf(undefined)).toBe('ar');
  });
});
