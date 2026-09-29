import { isIP } from 'node:net';

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

/**
 * من يُصدَّق في X-Forwarded-For — يُمرَّر إلى Fastify فيحسب `req.ip` منه.
 *
 * بلا ضبط لا يُصدَّق أحد: `req.ip` عنوان الاتصال نفسه. خلف وسيط عكسي هذا
 * عنوان الوسيط لكل الزوار، فيشتركون في حدّ التخمين (عشر محاولات لسكربت واحد
 * تقفل الدخول عن الموقع كله) ويُسجَّل عنوان واحد في التدقيق. `true` ممنوعة:
 * تصدّق الترويسة من أي أحد، فيكتب المهاجم العنوان الذي يشاء ويتهرّب من الحدّ.
 *
 *   TRUST_PROXY=1                     عدد الوسطاء أمام الخادم
 *   TRUST_PROXY=10.0.0.0/8,127.0.0.1  عناوين الوسطاء أو نطاقاتهم
 *   TRUST_PROXY=loopback              كلمات proxy-addr: loopback · linklocal · uniquelocal
 */
export type TrustProxy = false | number | string[];

const PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const value = (raw ?? '').trim();
  if (!value || value === 'false' || value === '0') return false;
  if (value === 'true') {
    throw new EnvError(['TRUST_PROXY (true تصدّق X-Forwarded-For من أي أحد — اكتب عدد الوسطاء أو عناوينهم)']);
  }
  if (/^\d+$/.test(value)) return Number(value);
  const entries = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (const e of entries) {
    const [addr, prefix, extra] = e.split('/');
    const validPrefix = prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= (isIP(addr ?? '') === 6 ? 128 : 32));
    if (!PROXY_KEYWORDS.has(e) && (extra !== undefined || !isIP(addr ?? '') || !validPrefix)) {
      throw new EnvError([`TRUST_PROXY (عنوان أو نطاق غير صالح: ${e})`]);
    }
  }
  return entries;
}

export interface Env {
  databaseUrl: string;
  trustProxy: TrustProxy;
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
    trustProxy: parseTrustProxy(process.env['TRUST_PROXY']),
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
