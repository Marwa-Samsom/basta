import { afterEach, describe, expect, it } from 'vitest';
import { FakeCarrier } from './infrastructure/fake-carrier';

/**
 * خط الدفاع الثاني بعد loadEnv: الشركة الوهمية تعلّم كل شحنة مستلمة خلال نحو
 * أربعين دقيقة، والتسليم يحرّر مال البائع. فإن وصلت الإنتاج بأي طريق — سكربت أو
 * عامل لا يمرّ بـ main.ts — يسقط الإقلاع.
 */
describe('شركة الشحن الوهمية والإنتاج', () => {
  const saved = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = saved;
  });

  it('ترفض أن تُنشأ في الإنتاج', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => new FakeCarrier()).toThrow(/ممنوعة في الإنتاج/);
  });

  it('تُنشأ خارج الإنتاج للتطوير والاختبار', () => {
    process.env['NODE_ENV'] = 'development';
    expect(() => new FakeCarrier()).not.toThrow();
  });
});
