/**
 * فصل بيئة الاختبار عن بيئة التطوير — الحارس الذي لا يُرى عطله إلا بعد أن تتلوّث
 * القاعدة التي يُجرَّب عليها يدوياً.
 */
import { describe, expect, it } from 'vitest';
import { databaseName, testDatabaseUrl, testEnv } from './test-env';

const DEV = 'postgresql://basta_app:s3cr%40t-pass-0000@localhost:5432/basta?schema=public';

describe('قاعدة الاختبار', () => {
  it('الخادم والمستخدم وكلمة المرور والمعاملات نفسها، واسم القاعدة بلاحقة _test', () => {
    const url = new URL(testDatabaseUrl(DEV));
    expect(url.host).toBe('localhost:5432');
    expect(url.username).toBe('basta_app');
    expect(url.password).toBe('s3cr%40t-pass-0000');
    expect(url.searchParams.get('schema')).toBe('public');
    expect(databaseName(url.toString())).toBe('basta_test');
  });

  it('لا تتكرّر اللاحقة: إعادة تحميل الإعداد لا تنتج basta_test_test', () => {
    expect(databaseName(testDatabaseUrl(testDatabaseUrl(DEV)))).toBe('basta_test');
  });

  it('الفهرس منفصل، والمالك يتبع مستخدم التشغيل إلى القاعدة نفسها', () => {
    const env = testEnv({
      DATABASE_URL: DEV,
      DATABASE_MIGRATE_URL: DEV.replace('basta_app', 'basta'),
    });
    expect(env['MEILI_INDEX']).toBe('products_test');
    expect(databaseName(env['DATABASE_MIGRATE_URL'] as string)).toBe('basta_test');
    expect(env['SMTP_URL']).toBe('');
  });

  it('بلا DATABASE_URL لا قاعدة تُخترع — اختبارات التكامل تتخطّى نفسها كما كانت', () => {
    expect(testEnv({})).not.toHaveProperty('DATABASE_URL');
  });

  it('هذا التشغيل نفسه لا يصل قاعدة التطوير ولا فهرسها', () => {
    const url = process.env['DATABASE_URL'];
    if (url) expect(databaseName(url)).toMatch(/_test$/);
    expect(process.env['MEILI_INDEX']).toMatch(/_test$/);
  });
});
