/**
 * التحقق من المتغيّرات عند الإقلاع — لا أثناء أول طلب.
 *
 * سرّ توقيع غائب لا يجوز أن يمرّ كـ `undefined` فيوقّع التطبيق رموزاً
 * بسرّ فارغ. الخيار الصحيح أن يرفض التطبيق الإقلاع أصلاً: عطل صاخب
 * وقت النشر أهون ألف مرة من ثغرة صامتة في الإنتاج.
 */
export class EnvError extends Error {
  constructor(missing: string[]) {
    super(
      `متغيّرات بيئة ناقصة: ${missing.join('، ')}. ` +
        `انسخ .env.example إلى .env واملأها قبل التشغيل.`,
    );
    this.name = 'EnvError';
  }
}

const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

/**
 * المزوّدون الذين يعرف الخادم وصلهم — ADR-012. الوهمي وحده حتى تُوصل بوابة
 * حقيقية، وهو **ممنوع في الإنتاج**: يقبل `tok_success` فيُعلَّم الطلب مدفوعاً
 * بلا خصم. فالإنتاج لا يُقلع أصلاً قبل أن يُضاف مزوّد حقيقي هنا.
 */
export const PAYMENT_PROVIDERS = ['fake'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export interface Env {
  databaseUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessTtl: string;
  jwtRefreshTtl: string;
  nodeEnv: string;
  paymentProvider: PaymentProviderName;
  /** محرّك البحث — اختياري: غيابه يُسقط البحث إلى قاعدة البيانات لا يُسقط المتجر (ADR-014) */
  meiliUrl: string;
  meiliKey: string;
  meiliIndex: string;
}

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;

  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) throw new EnvError([...missing]);

  const production = process.env.NODE_ENV === 'production';

  // الأسرار القصيرة قابلة للكسر بالقوة الغاشمة — ترفض في الإنتاج لا تُقبل بتحذير
  if (production) {
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'PAYMENT_WEBHOOK_SECRET'] as const) {
      if ((process.env[k] ?? '').length < 32) {
        throw new EnvError([`${k} (أقصر من 32 محرفاً)`]);
      }
    }
  }

  const paymentProvider = process.env['PAYMENT_PROVIDER'] || 'fake';
  if (!(PAYMENT_PROVIDERS as readonly string[]).includes(paymentProvider)) {
    throw new EnvError([`PAYMENT_PROVIDER (مزوّد غير معروف: ${paymentProvider})`]);
  }
  if (production && paymentProvider === 'fake') {
    throw new EnvError(['PAYMENT_PROVIDER (المزوّد الوهمي ممنوع في الإنتاج — يقبل الدفع بلا خصم)']);
  }

  cached = {
    databaseUrl: process.env['DATABASE_URL'] as string,
    jwtAccessSecret: process.env['JWT_ACCESS_SECRET'] as string,
    jwtRefreshSecret: process.env['JWT_REFRESH_SECRET'] as string,
    jwtAccessTtl: process.env['JWT_ACCESS_TTL'] ?? '15m',
    jwtRefreshTtl: process.env['JWT_REFRESH_TTL'] ?? '30d',
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    paymentProvider: paymentProvider as PaymentProviderName,
    meiliUrl: process.env['MEILI_URL'] ?? 'http://127.0.0.1:7701',
    meiliKey: process.env['MEILI_KEY'] ?? '',
    meiliIndex: process.env['MEILI_INDEX'] ?? 'products',
  };
  return cached;
}

/** للاختبارات التي تبدّل البيئة بين الحالات. */
export const resetEnvCache = (): void => {
  cached = null;
};
