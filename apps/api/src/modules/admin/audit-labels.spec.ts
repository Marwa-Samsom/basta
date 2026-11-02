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

/**
 * وعمود الإجراء بالعربي — كان رموزاً خاماً (product.reject بدل «إيقاف منتج»)، 2 نوفمبر 2026.
 * الإجراءات تُكتب بأشكال شتّى (action:، this.audit، record، ثلاثيّ الشرط)، فيُجمع كل نصّ بشكل
 * «عائلة.إجراء» من عائلات السجل، وتُضاف المبنيّة في الكود.
 */
describe('الإجراءات في صفحة السجل', () => {
  const src = join(__dirname, '../..');
  const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
  const FAMILIES = new Set([
    'admin', 'attribute', 'auth', 'banner', 'campaign', 'commission', 'coupon', 'customer', 'dispute', 'fx', 'notification_template',
    'page', 'payment', 'payout', 'product', 'refund', 'review', 'setting', 'shipping_rate', 'shipping_zone', 'storefront', 'tax', 'user', 'vendor',
  ]);
  // أحداث بوابة الدفع بشكل الإجراء نفسه، ولا تُكتب في السجل
  const NOT_ACTIONS = new Set(['payment.captured', 'payment.failed']);
  const written = new Set<string>();
  for (const f of files) {
    const code = readFileSync(join(src, f), 'utf8');
    for (const m of code.matchAll(/['`]([a-z_]+(?:\.[a-z_]+)+)['`]/g)) {
      if (FAMILIES.has(m[1]!.split('.')[0]!) && !NOT_ACTIONS.has(m[1]!)) written.add(m[1]!);
    }
  }
  // مبنيّة في الكود: `review.${status}` في الإشراف على التقييمات
  for (const s of ['published', 'rejected']) written.add(`review.${s}`);

  const web = join(src, '../../web/src');
  const page = readFileSync(join(web, 'app/admin/audit/page.tsx'), 'utf8');
  const block = /const ACTION_LABELS[^{]*\{([^}]*)\}/.exec(page)?.[1] ?? '';
  const labels = new Map([...block.matchAll(/^\s*'([a-z_.]+)': '([^']+)',/gm)].map((m) => [m[1]!, m[2]!]));

  it('الخادم يكتب إجراءات معروفة', () => {
    expect(written.size).toBeGreaterThan(70);
    expect(written).toContain('attribute.archive');
    expect(written).toContain('product.reject');
  });

  it('لكل إجراء يكتبه الخادم اسم عربي', () => {
    const missing = [...written].filter((a) => !/[؀-ۿ]/.test(labels.get(a) ?? ''));
    expect(missing).toEqual([]);
  });

  it('انتقالات الطلب الفرعي (`sub_order.${to}`) تأخذ اسم حالتها، ولكل حالة اسم', () => {
    expect(page).toMatch(/startsWith\('sub_order\.'\)/);
    const orders = readFileSync(join(web, 'lib/orders.ts'), 'utf8');
    const statusBlock = /export const STATUS_LABEL[^{]*\{([^}]*)\}/.exec(orders)?.[1] ?? '';
    const named = new Set([...statusBlock.matchAll(/^\s*([a-z_]+): '[^']*[؀-ۿ][^']*',/gm)].map((m) => m[1]!));
    const machine = readFileSync(join(src, 'modules/orders/domain/state-machine.ts'), 'utf8');
    const statuses = [.../export type SubOrderStatus =([^;]+);/.exec(machine)![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(statuses.length).toBeGreaterThan(10);
    expect(statuses.filter((s) => !named.has(s))).toEqual([]);
  });
});
