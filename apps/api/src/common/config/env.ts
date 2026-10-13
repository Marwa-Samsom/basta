import { hkdfSync } from 'node:crypto';
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
 * شركات الشحن التي يعرف الخادم وصلها.
 *
 * - `fake` للتطوير والاختبار، وهي **ممنوعة في الإنتاج** كالدفع الوهمي: مهمتها تقدّم
 *   كل شحنة خطوة كل عشر دقائق حتى «سُلّم» (نحو أربعين دقيقة)، والتسليم يبدأ فترة
 *   الإرجاع ثم يحرّر مال البائع — تسليم لم يحدث يحرّر مالاً عن بضاعة لم تصل.
 * - `none` بلا شركة: التوصيل ذاتي وحده. البائع يكتب مرجع توصيله ويؤكّد التسليم بنفسه،
 *   ولا مهمة تعلّم شيئاً مستلَماً. المشتري يرى «تم التسليم» ويفتح نزاعاً خلال فترة
 *   التعليق إن لم يصله شيء، فلا يُحرَّر المال قبلها. للإطلاق قبل ربط شركة حقيقية.
 */
export const SHIPPING_CARRIERS = ['fake', 'none'] as const;
export type ShippingCarrierName = (typeof SHIPPING_CARRIERS)[number];

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
  shippingCarrier: ShippingCarrierName;
  /** مفتاح تشفير أسرار التحقق الثنائي — 32 بايتاً (identity/infrastructure/secret-box) */
  totpKey: Buffer;
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
    // اختياري — لكن من يعرفه يكتب لكل طلب العنوان الذي يُحسب عليه حدّ التخمين (app.setup)
    const edge = process.env['EDGE_PROXY_SECRET'];
    if (edge && edge.length < 32) throw new EnvError(['EDGE_PROXY_SECRET (أقصر من 32 محرفاً)']);
  }

  // المزوّدان الوهميان يُفحصان معاً: إقلاع إنتاج يرى كل ما ينقصه في رسالة واحدة
  const problems: string[] = [];
  const paymentProvider = process.env['PAYMENT_PROVIDER'] || 'fake';
  if (!(PAYMENT_PROVIDERS as readonly string[]).includes(paymentProvider)) {
    problems.push(`PAYMENT_PROVIDER (مزوّد غير معروف: ${paymentProvider})`);
  } else if (production && paymentProvider === 'fake') {
    problems.push('PAYMENT_PROVIDER (المزوّد الوهمي ممنوع في الإنتاج — يقبل الدفع بلا خصم)');
  }
  const shippingCarrier = process.env['SHIPPING_CARRIER'] || 'fake';
  if (!(SHIPPING_CARRIERS as readonly string[]).includes(shippingCarrier)) {
    problems.push(`SHIPPING_CARRIER (شركة غير معروفة: ${shippingCarrier})`);
  } else if (production && shippingCarrier === 'fake') {
    problems.push(
      'SHIPPING_CARRIER (شركة الشحن الوهمية ممنوعة في الإنتاج — تعلّم كل شحنة مستلمة فتحرّر مال البائع. اضبط none للتوصيل الذاتي حتى تُربط شركة حقيقية)',
    );
  }
  const totpKey = totpKeyOf(production);
  if (typeof totpKey === 'string') problems.push(totpKey);
  const smtpProblem = smtpUrlProblem(process.env['SMTP_URL']);
  if (smtpProblem) problems.push(smtpProblem);
  if (problems.length > 0) throw new EnvError(problems);

  cached = {
    databaseUrl: process.env['DATABASE_URL'] as string,
    trustProxy: parseTrustProxy(process.env['TRUST_PROXY']),
    jwtAccessSecret: process.env['JWT_ACCESS_SECRET'] as string,
    jwtRefreshSecret: process.env['JWT_REFRESH_SECRET'] as string,
    jwtAccessTtl: process.env['JWT_ACCESS_TTL'] ?? '15m',
    jwtRefreshTtl: process.env['JWT_REFRESH_TTL'] ?? '30d',
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    paymentProvider: paymentProvider as PaymentProviderName,
    shippingCarrier: shippingCarrier as ShippingCarrierName,
    totpKey: totpKey as Buffer,
    meiliUrl: process.env['MEILI_URL'] ?? 'http://127.0.0.1:7701',
    meiliKey: process.env['MEILI_KEY'] ?? '',
    meiliIndex: process.env['MEILI_INDEX'] ?? 'products',
  };
  return cached;
}

/**
 * عنوان SMTP للبريد (notifications/infrastructure/channels) — اختياري: بدونه يُكتب
 * البريد ملفات في الصندوق المحلي. عنوان فاسد يُرفض عند الإقلاع لا عند أول رسالة،
 * فلا تفشل رموز الاستعادة كلها بصمت في الصندوق الصادر.
 */
export function smtpUrlProblem(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') return 'SMTP_URL (يبدأ بـ smtp:// أو smtps://)';
    if (!u.hostname) return 'SMTP_URL (بلا مضيف)';
    return null;
  } catch {
    return 'SMTP_URL (عنوان غير صالح — رمّز @ و: في المستخدم وكلمة المرور بـ %40 و %3A)';
  }
}

/**
 * مفتاح أسرار التحقق الثنائي. السرّ يولّد رموز الدخول: قراءته من القاعدة (نسخة
 * احتياطية مسرّبة، حقن SQL، مشغّل قاعدة) كانت تعطي رموز كل مدير — فيُخزَّن مشفّراً
 * بمفتاح لا يعيش في القاعدة.
 *
 * الإنتاج: TOTP_ENCRYPTION_KEY إلزامي، 32 بايتاً بترميز base64 (openssl rand -base64 32).
 * خارجه: يُشتقّ من JWT_ACCESS_SECRET إن غاب — كي لا تنكسر بيئات التطوير القائمة.
 * يعيد رسالة المشكلة بدل المفتاح إن وُجدت.
 */
function totpKeyOf(production: boolean): Buffer | string {
  const raw = process.env['TOTP_ENCRYPTION_KEY'];
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    return key.length === 32 ? key : 'TOTP_ENCRYPTION_KEY (32 بايتاً بترميز base64 — openssl rand -base64 32)';
  }
  if (production) return 'TOTP_ENCRYPTION_KEY (مفتاح تشفير أسرار التحقق الثنائي — openssl rand -base64 32)';
  return Buffer.from(hkdfSync('sha256', process.env['JWT_ACCESS_SECRET'] as string, 'basta', 'totp-secret-box/dev', 32));
}

/** للاختبارات التي تبدّل البيئة بين الحالات. */
export const resetEnvCache = (): void => {
  cached = null;
};
