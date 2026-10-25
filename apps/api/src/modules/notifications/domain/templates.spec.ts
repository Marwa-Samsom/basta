import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES } from './templates';

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
