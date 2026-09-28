import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvError, loadEnv, resetEnvCache } from './env';

const LONG = 'x'.repeat(32);

/** بيئة إنتاج سليمة في كل شيء إلا ما يبدّله الاختبار */
function production(overrides: Record<string, string | undefined>): void {
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://x',
    JWT_ACCESS_SECRET: LONG,
    JWT_REFRESH_SECRET: LONG,
    PAYMENT_WEBHOOK_SECRET: LONG,
  });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('بوابة الدفع في الإنتاج', () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
    resetEnvCache();
  });
  afterEach(() => {
    process.env = saved;
    resetEnvCache();
  });

  it('يرفض الإقلاع بالمزوّد الوهمي صراحةً', () => {
    production({ PAYMENT_PROVIDER: 'fake' });
    expect(() => loadEnv()).toThrow(EnvError);
    expect(() => loadEnv()).toThrow(/الوهمي ممنوع في الإنتاج/);
  });

  it('يرفض الإقلاع حين يغيب المزوّد فيسقط افتراضياً إلى الوهمي', () => {
    production({ PAYMENT_PROVIDER: undefined });
    expect(() => loadEnv()).toThrow(/الوهمي ممنوع في الإنتاج/);
  });

  it('يرفض الإقلاع بسرّ إشعارات ناقص أو قصير', () => {
    production({ PAYMENT_WEBHOOK_SECRET: undefined });
    expect(() => loadEnv()).toThrow(/PAYMENT_WEBHOOK_SECRET/);
    resetEnvCache();
    production({ PAYMENT_WEBHOOK_SECRET: 'fake_webhook_secret' });
    expect(() => loadEnv()).toThrow(/PAYMENT_WEBHOOK_SECRET/);
  });

  it('يرفض مزوّداً لا يعرفه في أي بيئة', () => {
    production({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'stripe' });
    expect(() => loadEnv()).toThrow(/مزوّد غير معروف/);
  });

  it('خارج الإنتاج يبقى الوهمي متاحاً للتطوير والاختبار', () => {
    production({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'fake', PAYMENT_WEBHOOK_SECRET: undefined });
    expect(loadEnv().paymentProvider).toBe('fake');
  });
});
