import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * صفحة سجل التدقيق تعرف كل نوع كيان يكتبه الخادم، باسم عربي. كانت قائمة التصفية رموزاً
 * إنجليزية خاماً، وناقصة الحملات والطلب والاسترداد ومناطق الشحن ووثائق المتجر وحسابه البنكي
 * — فلا يُصفّى عليها (ACFG-086، 31 أكتوبر 2026).
 */
describe('أنواع الكيان في صفحة السجل', () => {
  const src = join(__dirname, '../..');
  const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
  const written = new Set<string>();
  for (const f of files) {
    const code = readFileSync(join(src, f), 'utf8');
    // record({ entityType: 'X' }) و this.audit(actor, 'action', 'X', …)
    for (const m of code.matchAll(/entityType: '([A-Za-z]+)'/g)) written.add(m[1]!);
    for (const m of code.matchAll(/this\.audit\(\s*[\w.]+,\s*[`'][^`']*[`'],\s*'([A-Za-z]+)'/g)) written.add(m[1]!);
  }
  const page = readFileSync(join(src, '../../web/src/app/admin/audit/page.tsx'), 'utf8');
  const block = /const ENTITY_LABELS[^{]*\{([^}]*)\}/.exec(page)?.[1] ?? '';
  const labels = new Map([...block.matchAll(/^\s*([A-Za-z]+): '([^']+)',/gm)].map((m) => [m[1]!, m[2]!]));

  it('الخادم يكتب أنواعاً معروفة', () => {
    expect(written.size).toBeGreaterThan(15);
    expect(written).toContain('Attribute');
  });

  it('لكل نوع يكتبه الخادم اسم عربي في القائمة', () => {
    const missing = [...written].filter((t) => !/[؀-ۿ]/.test(labels.get(t) ?? ''));
    expect(missing).toEqual([]);
  });
});
