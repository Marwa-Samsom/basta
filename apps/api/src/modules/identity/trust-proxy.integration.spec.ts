/**
 * العنوان الحقيقي خلف الوسيط — ولا عنوان يكتبه الطالب.
 *
 * تطبيقان بالتهيئة نفسها: أحدهما خلف وسيط موثوق (TRUST_PROXY=1) والآخر بلا
 * وسيط. ما يُثبَت:
 *   · خلف الوسيط: حدّ التخمين لكل زائر لا للوسيط — سكربت واحد لا يقفل الدخول
 *     عن الموقع كله — والتدقيق يسجّل عنوان الزائر لا الوسيط
 *   · عنوان مزوَّر يضعه الزائر في X-Forwarded-For يتجاوزه الحساب: يُصدَّق ما
 *     أضافه الوسيط وحده
 *   · بلا وسيط موثوق: الترويسة لا تُقرأ أصلاً — تبديلها لا يهرب من الحدّ
 *     ولا يكتب في التدقيق
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['THROTTLE_AUTH_LIMIT'] = '10';

const prisma = new PrismaClient();
let behindProxy: NestFastifyApplication;
let direct: NestFastifyApplication;
let dbUp = false;
const SUFFIX = `tp${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const PROXY = '10.20.0.1';
const email = `victim.${SUFFIX}@basta.test`;

const login = (app: NestFastifyApplication, opts: { socket: string; xff?: string }, password = 'wrong-password-123') =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: opts.socket,
    headers: opts.xff ? { 'x-forwarded-for': opts.xff } : {},
    payload: { email, password },
  });

const lastFailedIp = async (id = userId) =>
  (await prisma.auditLog.findFirst({
    where: { action: 'auth.login_failed', entityType: 'User', entityId: id },
    orderBy: { createdAt: 'desc' },
    select: { ip: true },
  }))?.ip;

let userId = '';

/**
 * خلف خادم الواجهة (ممرّ /api/v1 — apps/web/src/app/api/v1/[...path]/route.ts):
 * كل الطلبات من عنوانه، وعنوان الزائر في ترويسة يصدّقها السرّ المشترك وحده.
 * مستخدم مستقل: محاولاته الخاطئة لا تختلط بمحاولات الأقسام الأخرى.
 */
let viaWeb: NestFastifyApplication;
const EDGE_SECRET = 'edge-proxy-secret-for-tests-0123456789';
const WEB_SERVER = '10.40.0.1';
const edgeEmail = `edge.${SUFFIX}@basta.test`;
let edgeUserId = '';

const loginViaWeb = (opts: { client?: string; secret?: string }, password = 'wrong-password-123') =>
  viaWeb.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: WEB_SERVER,
    headers: {
      ...(opts.secret ? { 'x-basta-edge-secret': opts.secret } : {}),
      ...(opts.client ? { 'x-basta-client-ip': opts.client } : {}),
    },
    payload: { email: edgeEmail, password },
  });

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  const [{ Test }, { AppModule }, { configureApp, createHttpAdapter }, { hashPassword }] = await Promise.all([
    import('@nestjs/testing'),
    import('../../app.module'),
    import('../../app.setup'),
    import('./public'),
  ]);
  const boot = async (trust: false | number) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(createHttpAdapter(trust));
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  };
  behindProxy = await boot(1);
  direct = await boot(false);
  // configureApp يقرأ السرّ عند التهيئة — لهذا التطبيق وحده
  process.env['EDGE_PROXY_SECRET'] = EDGE_SECRET;
  viaWeb = await boot(false);
  delete process.env['EDGE_PROXY_SECRET'];
  const e = await prisma.user.create({
    data: { email: edgeEmail, fullName: 'زائر خلف الواجهة', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  edgeUserId = e.id;
  const u = await prisma.user.create({
    data: { email, fullName: 'ضحية التخمين', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  userId = u.id;
}, 90_000);

afterAll(async () => {
  await behindProxy?.close();
  await direct?.close();
  await viaWeb?.close();
  await prisma.$disconnect();
});

describe('خلف وسيط موثوق (TRUST_PROXY=1)', () => {
  it('حدّ التخمين لكل زائر: سكربت يُحجب عند الحادية عشرة، وزائر آخر خلف الوسيط نفسه يدخل', async () => {
    if (!dbUp) return;
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await login(behindProxy, { socket: PROXY, xff: '203.0.113.7' })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);

    // زائر آخر يصل من الوسيط نفسه — كان يُحجب معه لأن العنوان كان عنوان الوسيط
    const other = await login(behindProxy, { socket: PROXY, xff: '198.51.100.9' }, PASSWORD);
    expect(other.statusCode, other.body).toBe(200);
  });

  it('التدقيق يسجّل عنوان الزائر لا الوسيط، والمزوَّر في الترويسة يُتجاوز', async () => {
    if (!dbUp) return;
    // الزائر يرسل «1.1.1.1» والوسيط يضيف عنوانه الحقيقي بعده — يُصدَّق ما أضافه الوسيط
    const r = await login(behindProxy, { socket: PROXY, xff: '1.1.1.1, 192.0.2.44' });
    expect(r.statusCode).toBe(401);
    expect(await lastFailedIp()).toBe('192.0.2.44');
  });
});

describe('بلا وسيط موثوق (الافتراضي)', () => {
  it('X-Forwarded-For لا يُقرأ: تبديله في كل محاولة لا يهرب من الحدّ', async () => {
    if (!dbUp) return;
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await login(direct, { socket: '10.30.0.5', xff: `198.18.0.${i + 1}` })).statusCode);
    }
    expect(codes[10]).toBe(429);
  });

  it('ولا يكتب في التدقيق — يُسجَّل عنوان الاتصال', async () => {
    if (!dbUp) return;
    const r = await login(direct, { socket: '10.30.0.6', xff: '8.8.8.8' });
    expect(r.statusCode).toBe(401);
    expect(await lastFailedIp()).toBe('10.30.0.6');
  });
});

describe('خلف خادم الواجهة (EDGE_PROXY_SECRET)', () => {
  it('بالسرّ: حدّ التخمين لكل زائر لا لخادم الواجهة — سكربت يُحجب، وزائر آخر يدخل', async () => {
    if (!dbUp) return;
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await loginViaWeb({ secret: EDGE_SECRET, client: '203.0.113.70' })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);

    // كان يُحجب معه: الطلبان من عنوان خادم الواجهة نفسه
    const other = await loginViaWeb({ secret: EDGE_SECRET, client: '198.51.100.90' }, PASSWORD);
    expect(other.statusCode, other.body).toBe(200);
  });

  it('بالسرّ: التدقيق يسجّل عنوان الزائر لا خادم الواجهة', async () => {
    if (!dbUp) return;
    const r = await loginViaWeb({ secret: EDGE_SECRET, client: '192.0.2.144' });
    expect(r.statusCode).toBe(401);
    expect(await lastFailedIp(edgeUserId)).toBe('192.0.2.144');
  });

  it('بلا السرّ أو بسرّ خاطئ: الترويسة لا تُقرأ — يُسجَّل عنوان الاتصال', async () => {
    if (!dbUp) return;
    const r = await loginViaWeb({ secret: 'not-the-edge-secret-0123456789abcdef', client: '8.8.4.4' });
    expect(r.statusCode).toBe(401);
    expect(await lastFailedIp(edgeUserId)).toBe(WEB_SERVER);
  });

  it('ومن يكلّم الـ API مباشرةً لا يهرب من الحدّ بتبديل العنوان في كل محاولة', async () => {
    if (!dbUp) return;
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const secret = i % 2 === 0 ? undefined : 'guessed-secret-guessed-secret-0000';
      codes.push((await loginViaWeb({ client: `198.18.1.${i + 1}`, ...(secret ? { secret } : {}) })).statusCode);
    }
    expect(codes).toContain(429);
  });
});
