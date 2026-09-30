import { afterEach, describe, expect, it } from 'vitest';
import { FakePaymentProvider } from './infrastructure/fake-provider';

/**
 * خط الدفاع الثاني بعد loadEnv: المزوّد الوهمي يقبل `tok_success` بلا خصم،
 * فإن وصل الإنتاج بأي طريق — سكربت أو عامل لا يمرّ بـ main.ts — يسقط الإقلاع.
 */
describe('المزوّد الوهمي والإنتاج', () => {
  const saved = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = saved;
  });

  it('يرفض أن يُنشأ في الإنتاج', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => new FakePaymentProvider()).toThrow(/ممنوع في الإنتاج/);
  });

  it('يُنشأ خارج الإنتاج للتطوير والاختبار', () => {
    process.env['NODE_ENV'] = 'development';
    expect(() => new FakePaymentProvider()).not.toThrow();
  });
});
