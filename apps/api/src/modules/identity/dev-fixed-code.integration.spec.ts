/**
 * رمز الدخول الثابت للتطوير (DEV_FIXED_CODE) — على PostgreSQL حيّ عبر HTTP.
 *
 * ما يُثبَت: بـ NODE_ENV=development و DEV_FIXED_CODE=123456 يصير الرمز نفسه
 * رمز تأكيد البريد ورمز استعادة كلمة المرور، ويُقبل بدل رمز التطبيق في
 * التفعيل والدخول. والرمز الخاطئ يبقى مرفوضاً. الرفض في الإنتاج في env.spec.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../../common/config/env';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;
let saved: NodeJS.ProcessEnv;
const FIXED = '123456';
const SUFFIX = `dfc${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
const call = (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}): Promise<Res> =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    remoteAddress: '10.9.2.1',
    headers: { 'user-agent': 'vitest-agent', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    ...(opts.body !== undefined ? { payload: opts.body as Record<string, unknown> } : {}),
  });

const emailOf = (tag: string) => `${tag}.${SUFFIX}@basta.test`;

async function register(tag: string): Promise<void> {
  const r = await call('POST', '/auth/register', { body: { email: emailOf(tag), password: PASSWORD, fullName: `مستخدم ${tag}` } });
  expect(r.statusCode, r.body).toBe(201);
}

const login = (tag: string, totp?: string, password = PASSWORD) =>
  call('POST', '/auth/login', { body: { email: emailOf(tag), password, ...(totp ? { totp } : {}) } });

async function tokenOf(tag: string): Promise<string> {
  const r = await login(tag);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().tokens.accessToken;
}

beforeAll(async () => {
  saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'development', DEV_FIXED_CODE: FIXED });
  resetEnvCache();
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات الرمز الثابت متخطّاة.\n');
    return;
  }
  const [{ Test }, { FastifyAdapter }, { AppModule }, { configureApp }] = await Promise.all([
    import('@nestjs/testing'),
    import('@nestjs/platform-fastify'),
    import('../../app.module'),
    import('../../app.setup'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
  process.env = saved;
  resetEnvCache();
});

describe('رمز الدخول الثابت في التطوير', () => {
  it('يؤكّد البريد، والخاطئ يبقى مرفوضاً', async () => {
    if (!dbUp) return;
    await register('verify');
    const token = await tokenOf('verify');
    const sent = await call('POST', '/me/account/email-verification', { token });
    expect(sent.statusCode, sent.body).toBe(200);

    const wrong = await call('POST', '/me/account/email-verification/confirm', { token, body: { code: '000000' } });
    expect(wrong.statusCode).toBe(400);
    const ok = await call('POST', '/me/account/email-verification/confirm', { token, body: { code: FIXED } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().verified).toBe(true);
  });

  it('يستعيد كلمة المرور', async () => {
    if (!dbUp) return;
    await register('reset');
    const forgot = await call('POST', '/auth/password/forgot', { body: { email: emailOf('reset') } });
    expect(forgot.statusCode, forgot.body).toBe(200);
    const next = 'كلمة-مرور-جديدة-طويلة';
    const reset = await call('POST', '/auth/password/reset', { body: { email: emailOf('reset'), code: FIXED, newPassword: next } });
    expect(reset.statusCode, reset.body).toBe(200);
    expect((await login('reset', undefined, next)).statusCode).toBe(200);
  });

  it('يفعّل التحقق بخطوتين ويدخل به مرة بعد مرة، والخاطئ يبقى مرفوضاً', async () => {
    if (!dbUp) return;
    await register('totp');
    const token = await tokenOf('totp');
    expect((await call('POST', '/auth/totp/setup', { token })).statusCode).toBe(201);
    const confirm = await call('POST', '/auth/totp/confirm', { token, body: { token: FIXED } });
    expect(confirm.statusCode, confirm.body).toBe(200);

    expect((await login('totp')).statusCode).toBe(401);
    expect((await login('totp', '000000')).statusCode).toBe(401);
    // لا حجز للخطوة الزمنية: الرمز الثابت يُقبل مرتين داخل النافذة نفسها
    expect((await login('totp', FIXED)).statusCode).toBe(200);
    expect((await login('totp', FIXED)).statusCode).toBe(200);
  });
});
