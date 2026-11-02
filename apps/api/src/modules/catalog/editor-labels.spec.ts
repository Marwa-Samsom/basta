import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * محرّر المنتج عربي: نوع الخصيصة بجانب اسمها كان LIST و TEXT و NUMBER و BOOL بخطّ ثابت
 * العرض وتباعد أحرف (ACFG-099، 1 نوفمبر 2026). والتباعد يفصل الحروف العربية المتصلة.
 */
describe('محرّر المنتج يسمّي أنواع الخصائص بالعربية', () => {
  const web = join(__dirname, '../../../../web/src');
  const editor = readFileSync(join(web, 'components/product-editor.tsx'), 'utf8');
  const block = /const KIND[^{]*\{([^}]*)\}/.exec(editor)?.[1] ?? '';
  const kinds = new Map([...block.matchAll(/^\s*(\w+): '([^']+)',/gm)].map((m) => [m[1]!, m[2]!]));

  it('كل نوع باسم عربي', () => {
    expect([...kinds.keys()].sort()).toEqual(['boolean', 'number', 'select', 'text']);
    for (const [kind, label] of kinds) expect(label, kind).toMatch(/[؀-ۿ]/);
  });

  it('بلا تباعد أحرف ولا خطّ ثابت العرض', () => {
    const css = readFileSync(join(web, 'styles/screens/vendor-products.css'), 'utf8');
    const rule = /\.vp-attr__kind \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/letter-spacing|font-mono/);
  });
});
