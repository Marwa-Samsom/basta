/**
 * المرحلة 12 — الفحص الأمني الحيّ (OWASP Top 10). كل بند يحاول الخرق فعلاً
 * ولا يفترض الحماية (الدرس 1).
 *
 * هذا الملف يُقلع التطبيق **بحدّ التخمين الحقيقي** (10) — بقية الملفات ترفعه
 * لأنها تدخل عشرات المرات من العنوان نفسه. لذلك تُستورد الوحدات ديناميكياً
 * بعد ضبط البيئة: الحدّ يُقرأ عند تحميل الوحدة.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['THROTTLE_AUTH_LIMIT'] = '10';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;
const SUFFIX = `sec${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();
const adminSecret = generateSecret();
let customerToken = '';

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, opts: { token?: string; body?: unknown; ip?: string } = {}): Promise<Res> =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    remoteAddress: opts.ip ?? '10.0.0.1',
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as Record<string, unknown> } : {}),
  });

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  const [{ Test }, { FastifyAdapter }, { AppModule }, { configureApp }, { hashPassword }] = await Promise.all([
    import('@nestjs/testing'),
    import('@nestjs/platform-fastify'),
    import('../../app.module'),
    import('../../app.setup'),
    import('./public'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await prisma.user.create({
    data: {
      email: `admin.${SUFFIX}@basta.test`, fullName: 'مدير أمني', passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'admin' } }, totpSecretEnc: adminSecret, totpEnabledAt: new Date(),
    },
  });
  await prisma.user.create({
    data: { email: `cust.${SUFFIX}@basta.test`, fullName: 'عميل', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  const login = await call('POST', '/auth/login', { ip: '10.0.0.50', body: { email: `cust.${SUFFIX}@basta.test`, password: PASSWORD } });
  customerToken = login.json().tokens.accessToken;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('A07 · التخمين وسرقة الجلسة', () => {
  it('المحاولة الحادية عشرة من العنوان نفسه تُرفض 429 — وعنوان آخر لا يتأثر', async () => {
    if (!dbUp) return;
    const codes: number[] = [];
    let last = '';
    for (let i = 0; i < 11; i++) {
      const r = await call('POST', '/auth/login', { ip: '10.0.0.66', body: { email: `nobody${i}@basta.test`, password: 'wrong-password-123' } });
      codes.push(r.statusCode);
      last = r.body;
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    // الرسالة تصل صفحة الدخول كما هي: عربية وتقول كم ينتظر، لا «ThrottlerException»
    expect(last).toMatch(/محاولات كثيرة من هذا الجهاز. انتظر 15 دقيقة/);
    expect(last).not.toMatch(/Throttler/);
    const other = await call('POST', '/auth/login', { ip: '10.0.0.67', body: { email: 'x@basta.test', password: 'wrong-password-123' } });
    expect(other.statusCode).toBe(401);
  });

  it('حدّ التخمين لا يخنق التصفّح: 200 طلب متجر من عنوان واحد تمرّ', async () => {
    if (!dbUp) return;
    const results = await Promise.all(Array.from({ length: 200 }, () => call('GET', '/attributes', { ip: '10.0.0.70' })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });

  it('رمز التحقق الثنائي لا يُقبل مرتين — ولو في نافذته', async () => {
    if (!dbUp) return;
    const totp = generateSync({ strategy: 'totp', secret: adminSecret, crypto: totpCrypto, base32: totpBase32 });
    const body = { email: `admin.${SUFFIX}@basta.test`, password: PASSWORD, totp };
    const first = await call('POST', '/auth/login', { ip: '10.0.0.80', body });
    expect(first.statusCode, first.body).toBe(200);
    const replay = await call('POST', '/auth/login', { ip: '10.0.0.81', body });
    expect(replay.statusCode).toBe(401);
    // الخطوة المستعملة محفوظة، وكل رمز لا يتجاوزها يُرفض من التحقق نفسه
    const u = await prisma.user.findUniqueOrThrow({ where: { email: `admin.${SUFFIX}@basta.test` } });
    expect(u.totpLastStep).toBeGreaterThan(0);
  });

  it('رمز وصول معدَّل أو بلا توقيع يُرفض', async () => {
    if (!dbUp) return;
    const [h, p] = customerToken.split('.');
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, roles: ['admin'], permissions: ['payouts.approve'] })).toString('base64url');
    expect((await call('GET', '/auth/me', { token: `${h}.${forged}.${customerToken.split('.')[2]}` })).statusCode).toBe(401);
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${forged}.`;
    expect((await call('GET', '/auth/me', { token: none })).statusCode).toBe(401);
    // توقيع بسرّ مخمَّن
    const sig = createHmac('sha256', 'secret').update(`${h}.${forged}`).digest('base64url');
    expect((await call('GET', '/auth/me', { token: `${h}.${forged}.${sig}` })).statusCode).toBe(401);
    expect((await call('GET', '/auth/me', { token: customerToken })).statusCode).toBe(200);
  });
});

describe('A01 · التحكم بالوصول', () => {
  it('عميل لا يصل مسار إدارة ولا مسار بائع', async () => {
    if (!dbUp) return;
    for (const url of ['/admin/dashboard', '/admin/finance/payouts', '/admin/users', '/vendor/orders', '/vendor/finance/wallets']) {
      expect((await call('GET', url, { token: customerToken })).statusCode, url).toBe(403);
    }
    expect((await call('GET', '/admin/dashboard')).statusCode).toBe(401);
  });
});

describe('A03 و A08 · الحقن وسلامة المدخلات', () => {
  it('حقل غير معلن يُرفض — لا إسناد جماعي يرفع صلاحية', async () => {
    if (!dbUp) return;
    const r = await call('POST', '/auth/register', {
      ip: '10.0.0.90',
      body: { email: `mass.${SUFFIX}@basta.test`, password: PASSWORD, fullName: 'اختبار', roles: ['admin'] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('نصّ بحث بصيغة حقن SQL يُعامل نصاً', async () => {
    if (!dbUp) return;
    const r = await call('GET', `/storefront/products?q=${encodeURIComponent("' OR 1=1; DROP TABLE users; --")}`);
    expect(r.statusCode).toBe(200);
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });
});

describe('A05 · الإعداد الآمن', () => {
  it('ترويسات الأمان على كل ردّ، والردّ المصادَق لا يُخزَّن', async () => {
    if (!dbUp) return;
    const pub = await call('GET', '/attributes');
    expect(pub.headers['x-content-type-options']).toBe('nosniff');
    expect(pub.headers['x-frame-options']).toBe('DENY');
    expect(String(pub.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    const priv = await call('GET', '/auth/me', { token: customerToken });
    expect(priv.headers['cache-control']).toBe('private, no-store');
  });

  it('الخطأ غير المتوقَّع لا يكشف تفاصيل داخلية', async () => {
    if (!dbUp) return;
    const r = await call('GET', '/storefront/products/%E0%A4%A');
    expect([400, 404]).toContain(r.statusCode);
    expect(r.body).not.toMatch(/prisma|stack|at \w+ \(/i);
  });
});
