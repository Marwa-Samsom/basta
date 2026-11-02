import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { format, money } from '../../../common/money/money';
import { DEFAULT_TEMPLATES, EVENTS, render } from './templates';

/**
 * لا مراجعة للمنتجات قبل النشر (قرار صاحبة المشروع 15 أكتوبر 2026): لا رسالة للبائع تَعِده بها.
 * بريد اعتماد المتجر كان يقول «وكل منتج يظهر للمشترين بعد مراجعته» (VON-044).
 */
describe('قوالب البائع لا تَعِد بمراجعة المنتجات', () => {
  const vendorFacing = DEFAULT_TEMPLATES.filter((t) => t.code.startsWith('vendor_') || t.code.startsWith('product_'));

  it('بريد الاعتماد يقول إن المنتج يظهر فور نشره', () => {
    const approved = DEFAULT_TEMPLATES.find((t) => t.code === 'vendor_approved' && t.channel === 'email');
    expect(approved?.body).toContain('وتظهر للمشترين فور نشرها');
  });

  it('لا قالب للبائع يذكر مراجعة منتج', () => {
    expect(vendorFacing.length).toBeGreaterThan(3);
    for (const t of vendorFacing) {
      expect(t.body, `${t.code}/${t.channel}`).not.toMatch(/بعد مراجعته|للمراجعة|نراجع منتج|مراجعة المنتج/);
    }
  });
});

/**
 * «ر.س.» تنتهي بنقطة، فالقالب الذي يختم الجملة بنقطة بعد المبلغ كان يعطي
 * «140.26 ر.س..» (BUY-030، 27 أكتوبر 2026) — و«د.أ.» مثلها. نقطة واحدة تكفي، و«US$» تأخذ نقطة القالب.
 */
describe('لا نقطتان بعد مبلغ ينتهي بنقطة', () => {
  const placed = DEFAULT_TEMPLATES.find((t) => t.code === 'order_placed' && t.channel === 'in_app')!;
  const doubleDot = /\.[\u200E\u200F\u2066-\u2069]*\.$/;

  it.each(['SAR', 'JOD'] as const)('«تأكّد طلبك» بـ %s: نقطة واحدة ولو لفّت المبلغَ علامات الاتجاه', (currency) => {
    const amount = format(money(14_026n, currency));
    const text = render(placed.body, { order_number: 'BST-261027-RR3SWDX4', amount });
    expect(text).toBe(`طلبك BST-261027-RR3SWDX4 مؤكَّد — ${amount}`);
    expect(text).not.toMatch(doubleDot);
  });

  it('مبلغ لا ينتهي بنقطة يأخذ نقطة القالب', () => {
    const amount = format(money(4_200n, 'USD'));
    expect(render(placed.body, { order_number: 'BST-1', amount })).toBe(`طلبك BST-1 مؤكَّد — ${amount}.`);
  });

  it('النقطة وسط الجملة وبعد غير المبلغ لا تُمسّ', () => {
    expect(render('{{a}}. ثم {{b}}.', { a: 'س.', b: 'ب' })).toBe('س. ثم ب.');
    expect(render('{{a}} — {{b}}.', { a: 'ر.س.', b: 'ب' })).toBe('ر.س. — ب.');
  });
});

/**
 * كل إشعار داخل الموقع له عنوان في صفحة إشعاراته: «أُلغي الطلب …» كان يظهر للبائع بعنوان «إشعار»
 * وجرس عام وخارج رقاقة «الطلبات»، وفي «حسابي» بنصّه عنواناً لتسعة أنواع (ADM-051، 30 أكتوبر 2026).
 */
describe('صفحتا الإشعارات تعرفان كل إشعار داخل الموقع', () => {
  const page = (path: string) => readFileSync(join(__dirname, '../../../../../web/src/app', path), 'utf8');
  // سطر الحدث في الخريطة بعنوان غير فارغ: «  code: { title: '…'»، أو باللغتين منذ زرّ اللغة
  // «  code: { title: { ar: '…'» (لوحة البائع، 2 نوفمبر 2026)
  const titled = (src: string, code: string) =>
    src.split('\n').some((line) => {
      const l = line.trimStart();
      return (
        (l.startsWith(`${code}: { title: '`) && !l.includes(`title: ''`)) ||
        (l.startsWith(`${code}: { title: { ar: '`) && !l.includes(`ar: ''`))
      );
    });
  const inApp = new Set(DEFAULT_TEMPLATES.filter((t) => t.channel === 'in_app').map((t) => t.code));
  const audienceOf = new Map(EVENTS.map((e) => [e.code, e.audience]));

  it('لوحة البائع: كل حدث للبائع', () => {
    const src = page('vendor/(dashboard)/notifications/page.tsx');
    const missing = [...inApp].filter((c) => audienceOf.get(c) === 'vendor' && !titled(src, c));
    expect(missing).toEqual([]);
  });

  it('«حسابي»: كل حدث لمشترٍ أو بائع', () => {
    const src = page('(account)/account/notifications/page.tsx');
    const missing = [...inApp].filter((c) => audienceOf.get(c) !== 'admin' && !titled(src, c));
    expect(missing).toEqual([]);
  });
});
