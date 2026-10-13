import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvError, loadEnv, parseTrustProxy, resetEnvCache, smtpUrlProblem } from './env';

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

describe('شركة الشحن في الإنتاج', () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
    resetEnvCache();
  });
  afterEach(() => {
    process.env = saved;
    resetEnvCache();
  });

  it('يرفض الإقلاع بالشركة الوهمية — صراحةً أو بغياب المتغيّر', () => {
    for (const SHIPPING_CARRIER of ['fake', undefined]) {
      resetEnvCache();
      production({ SHIPPING_CARRIER });
      expect(() => loadEnv()).toThrow(/شركة الشحن الوهمية ممنوعة في الإنتاج/);
    }
  });

  it('none مقبولة في الإنتاج — التوصيل ذاتي بلا شركة — والرفض يدلّ عليها', () => {
    // الدفع الوهمي ما زال ممنوعاً هنا؛ ما يُفحص أن الشحن لا يُذكر في الرفض
    production({ SHIPPING_CARRIER: 'none' });
    expect(() => loadEnv()).not.toThrow(/SHIPPING_CARRIER/);
    resetEnvCache();
    production({ SHIPPING_CARRIER: 'fake' });
    expect(() => loadEnv()).toThrow(/اضبط none/);
  });

  it('يذكر الدفع والشحن معاً في رسالة واحدة', () => {
    production({ PAYMENT_PROVIDER: 'fake', SHIPPING_CARRIER: 'fake' });
    expect(() => loadEnv()).toThrow(/PAYMENT_PROVIDER.*SHIPPING_CARRIER/);
  });

  it('يرفض شركة لا يعرفها، ويُبقي الوهمية خارج الإنتاج', () => {
    production({ NODE_ENV: 'development', SHIPPING_CARRIER: 'aramex' });
    expect(() => loadEnv()).toThrow(/شركة غير معروفة/);
    resetEnvCache();
    production({ NODE_ENV: 'development', SHIPPING_CARRIER: undefined, PAYMENT_WEBHOOK_SECRET: undefined });
    expect(loadEnv().shippingCarrier).toBe('fake');
  });
});

describe('TRUST_PROXY — من يُصدَّق في X-Forwarded-For', () => {
  it('عدد أو عناوين أو نطاقات — وtrue والعنوان الفاسد مرفوضان', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1,::1')).toEqual(['10.0.0.0/8', '127.0.0.1', '::1']);
    expect(parseTrustProxy('loopback,uniquelocal')).toEqual(['loopback', 'uniquelocal']);
    expect(() => parseTrustProxy('true')).toThrow(/من أي أحد/);
    expect(() => parseTrustProxy('10.0.0.0/40')).toThrow(/غير صالح/);
    expect(() => parseTrustProxy('proxy.example.com')).toThrow(/غير صالح/);
  });
});

describe('مفتاح أسرار التحقق الثنائي', () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
    resetEnvCache();
  });
  afterEach(() => {
    process.env = saved;
    resetEnvCache();
  });

  it('إلزامي في الإنتاج، وبطول 32 بايتاً', () => {
    production({ TOTP_ENCRYPTION_KEY: undefined });
    expect(() => loadEnv()).toThrow(/TOTP_ENCRYPTION_KEY/);
    resetEnvCache();
    production({ TOTP_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') });
    expect(() => loadEnv()).toThrow(/TOTP_ENCRYPTION_KEY \(32 بايتاً/);
    resetEnvCache();
    // مفتاح سليم: لا يُذكر بين مشاكل الإقلاع (الدفع والشحن الوهميان ما زالا يوقفانه)
    production({ TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
    expect(() => loadEnv()).not.toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it('خارج الإنتاج يُشتقّ من سرّ الوصول إن غاب — ثابتاً بين الإقلاعات', () => {
    production({ NODE_ENV: 'development', TOTP_ENCRYPTION_KEY: undefined, PAYMENT_WEBHOOK_SECRET: undefined });
    const first = loadEnv().totpKey;
    resetEnvCache();
    expect(first).toHaveLength(32);
    expect(loadEnv().totpKey.equals(first)).toBe(true);
  });
});

describe('سرّ خادم الواجهة (EDGE_PROXY_SECRET)', () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
    resetEnvCache();
  });
  afterEach(() => {
    process.env = saved;
    resetEnvCache();
  });

  it('اختياري، لكنه إن وُجد في الإنتاج فبطول 32 محرفاً على الأقل', () => {
    // غيابه لا يُذكر — ما يُرفض هنا المزوّد الوهمي الافتراضي وحده
    production({ EDGE_PROXY_SECRET: undefined });
    expect(() => loadEnv()).not.toThrow(/EDGE_PROXY_SECRET/);
    resetEnvCache();
    production({ EDGE_PROXY_SECRET: 'short-edge-secret' });
    expect(() => loadEnv()).toThrow(/EDGE_PROXY_SECRET/);
  });

  it('خارج الإنتاج لا يُفحص طوله', () => {
    production({ NODE_ENV: 'development', EDGE_PROXY_SECRET: 'dev', PAYMENT_WEBHOOK_SECRET: undefined });
    expect(() => loadEnv()).not.toThrow();
  });
});

describe('عنوان SMTP (SMTP_URL)', () => {
  it('اختياري، وإن وُجد فـ smtp:// أو smtps:// بمضيف', () => {
    expect(smtpUrlProblem(undefined)).toBeNull();
    expect(smtpUrlProblem('smtps://me%40gmail.com:app-pass@smtp.gmail.com:465')).toBeNull();
    expect(smtpUrlProblem('smtp://login:key@smtp-relay.brevo.com:587')).toBeNull();
    expect(smtpUrlProblem('https://smtp.gmail.com')).toMatch(/smtp:\/\//);
    expect(smtpUrlProblem('me@gmail.com:pass@smtp.gmail.com')).toMatch(/SMTP_URL/);
  });
});
