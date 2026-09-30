import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdirSync } from 'node:fs';
import { loadEnv, type TrustProxy } from './common/config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IMAGE_MAX_BYTES, ProductImageGate, UPLOADS_ROOT, UPLOADS_URL_PREFIX } from './modules/catalog/public';

/**
 * محوّل HTTP بالوسطاء الموثوقين (TRUST_PROXY): منه وحده يُحسب `req.ip` الذي
 * يُعدّ به حدّ المعدّل ويُسجَّل في التدقيق. لا يقرأ أحد X-Forwarded-For بيده.
 */
export function createHttpAdapter(trustProxy: TrustProxy = loadEnv().trustProxy): FastifyAdapter {
  // عدد الوسطاء دالة بمعنى Fastify نفسه (يُصدَّق أقرب n) — أنواع محوّل Nest لا تقبل الرقم
  const trust = typeof trustProxy === 'number' ? (_addr: string, hop: number) => hop < trustProxy : trustProxy;
  return new FastifyAdapter({ trustProxy: trust });
}

/**
 * تهيئة التطبيق المشتركة بين الإقلاع واختبارات الواجهة البرمجية.
 * اختبار يُقلع تطبيقاً مهيّأً بطريقة أخرى يثبت سلوك تطبيق آخر.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  /**
   * الأفعال تُسمّى صراحةً: محوّل Fastify يسمح افتراضياً بـ GET و HEAD و POST
   * وحدها، فكان كل PUT و PATCH و DELETE يرتدّ من المتصفّح بـ ERR_FAILED بعد
   * اجتياز الفحص المسبق — بينما تعمل الطلبات نفسها من curl لأنه لا يفحص.
   * حفظ الحساب البنكي (PUT) كشفها في المرحلة 06.
   */
  /**
   * المصادر المسموحة: موقع الواجهة وحده في الإنتاج (وما يُضاف صراحةً في
   * CORS_ORIGINS). في التطوير أي منفذ محلي — بناء الإنتاج للفحص يعمل على 3100.
   */
  const allowed = [process.env.NEXT_PUBLIC_SITE_URL, ...(process.env.CORS_ORIGINS ?? '').split(',')]
    .map((o) => o?.trim())
    .filter((o): o is string => !!o);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const production = process.env.NODE_ENV === 'production';
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, ok: boolean) => void) => {
      if (!origin) return cb(null, true); // طلبات الخادم إلى الخادم لا تحمل Origin
      cb(null, allowed.length === 0 ? !production : allowed.includes(origin) || (!production && local.test(origin)));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // رمز السلة ومفتاح عدم التكرار ترويستان مخصّصتان — غيابهما هنا يُسقط الدفع من المتصفّح وحده
    allowedHeaders: ['authorization', 'content-type', 'x-cart-token', 'idempotency-key', 'x-order-key'],
  });

  // الحد العام أعلى حدود المسارات؛ كل مسار يضيّقه لنفسه (الاستيراد 5 م.ب)
  await app.register(multipart as never, {
    limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 10, fieldSize: 16 * 1024 },
  });

  // صور المنتجات تمرّ ببوابتها قبل الملف: منتج ظاهر، أو صورة في طلب، أو رابط موقَّع
  // لواجهتي البائع والإدارة — وما سواها (مرفوض، محذوف، مسودّة) 404. قبل تسجيل
  // المجلد: الخطّاف يسري على ما يُسجَّل بعده
  const gate = app.get(ProductImageGate, { strict: false });
  app.getHttpAdapter().getInstance().addHook('onRequest', async (req: { url: string }, reply: { code: (c: number) => { send: (b: unknown) => unknown } }) => {
    if ((await gate.allows(req.url)) === false) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'الصورة غير موجودة.' });
    }
  });

  mkdirSync(UPLOADS_ROOT, { recursive: true });
  await app.register(fastifyStatic as never, {
    root: UPLOADS_ROOT,
    prefix: UPLOADS_URL_PREFIX,
    decorateReply: false,
    index: false,
    dotfiles: 'deny',
    // الصورة لا تتغيّر تحت اسمها — كل رفع مفتاح جديد — فتُخزَّن طويلاً
    maxAge: '30d',
    immutable: true,
  });

  /**
   * ترويسات الأمان — المرحلة 12، OWASP A05. الواجهة البرمجية لا تُعرض في
   * إطار ولا تُفسَّر كصفحة: JSON وصور فقط. والردّ على طلب مصادَق لا يُخزَّن
   * في أي وسيط — بيانات حساب في ذاكرة وكيل مشترك تسريب.
   */
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (req: { headers: Record<string, unknown>; url: string }, reply: { header: (k: string, v: string) => unknown; getHeader: (k: string) => unknown }) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      if (process.env['NODE_ENV'] === 'production') {
        reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      if (req.headers['authorization'] && !reply.getHeader('cache-control')) {
        reply.header('Cache-Control', 'private, no-store');
      }
    });
}
