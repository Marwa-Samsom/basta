/**
 * ST-25 الحساب و SH-03 تأكيد البريد و SH-04 استعادة كلمة المرور — على
 * PostgreSQL حيّ عبر HTTP، بالتطبيق المهيّأ نفسه.
 *
 * ما يُثبَت: الرمز مجزّأ ولمرة واحدة ومحدود المحاولات (ولو تزامنت) وينتهي؛
 * الاستعادة لا تكشف وجود البريد وتُنهي كل الجلسات؛ تغيير كلمة المرور يُنهي
 * الأخرى ويُبقي الحالية؛ ولا يمسّ مستخدمٌ جلسةَ غيره ولا رمزه.
 *
 * الرمز لا يعود في أي ردّ — يُقرأ هنا من صندوق الإشعارات الصادر كما يقرؤه
 * صاحبه من بريده.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;
const SUFFIX = `acct${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  opts: { token?: string; body?: unknown; ua?: string } = {},
): Promise<Res> =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    remoteAddress: '10.9.0.1',
    headers: {
      'user-agent': opts.ua ?? 'vitest-agent',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { payload: opts.body as Record<string, unknown> } : {}),
  });

const emailOf = (tag: string) => `${tag}.${SUFFIX}@basta.test`;

async function register(tag: string): Promise<string> {
  const r = await call('POST', '/auth/register', { body: { email: emailOf(tag), password: PASSWORD, fullName: `مستخدم ${tag}` } });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().userId;
}

async function login(tag: string, password = PASSWORD, ua = 'vitest-agent'): Promise<{ accessToken: string; refreshToken: string }> {
  const r = await call('POST', '/auth/login', { body: { email: emailOf(tag), password }, ua });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().tokens;
}

const sidOf = (accessToken: string): string =>
  JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString()).sid;

/** الرمز كما وصل البريد — من أحدث إشعار للمستخدم بهذا القالب */
async function codeFromOutbox(userId: string, templateCode: string): Promise<string> {
  const n = await prisma.notification.findFirstOrThrow({ where: { userId, templateCode, channel: 'email' }, orderBy: { createdAt: 'desc' } });
  return (n.payloadJson as Record<string, string>)['code']!;
}

const wrongOf = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات الحساب متخطّاة.\n');
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
});

describe('SH-03 · تأكيد البريد', () => {
  it('الرمز يصل بالبريد مجزّأً في القاعدة، ويؤكّد البريد مرة واحدة، ومهلة إعادة الإرسال تسري', async () => {
    if (!dbUp) return;
    const userId = await register('verify');
    const { accessToken } = await login('verify');

    const before = await call('GET', '/me/account', { token: accessToken });
    expect(before.statusCode).toBe(200);
    expect(before.json().emailVerifiedAt).toBeNull();

    const sent = await call('POST', '/me/account/email-verification', { token: accessToken });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().email).toMatch(/^ve•••@/);
    expect(sent.json().pending.attemptsLeft).toBe(5);
    expect(sent.body).not.toMatch(/"code"/);

    const code = await codeFromOutbox(userId, 'email_verify_code');
    const row = await prisma.otpCode.findFirstOrThrow({ where: { userId, purpose: 'verify' } });
    expect(row.codeHash).not.toContain(code);
    expect(row.channel).toBe('email');

    const again = await call('POST', '/me/account/email-verification', { token: accessToken });
    expect(again.statusCode).toBe(409);
    expect(again.json().details.retryAfterSeconds).toBeGreaterThan(0);

    const wrong = await call('POST', '/me/account/email-verification/confirm', { token: accessToken, body: { code: wrongOf(code) } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().details.attemptsLeft).toBe(4);

    const ok = await call('POST', '/me/account/email-verification/confirm', { token: accessToken, body: { code } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().verified).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { actorUserId: userId, action: 'user.email_verified' } })).toBe(1);

    expect((await call('POST', '/me/account/email-verification', { token: accessToken })).statusCode).toBe(409);
  });

  it('خمس محاولات خاطئة تُبطل الرمز — والصحيح بعدها مرفوض', async () => {
    if (!dbUp) return;
    const userId = await register('exhaust');
    const { accessToken } = await login('exhaust');
    await call('POST', '/me/account/email-verification', { token: accessToken });
    const code = await codeFromOutbox(userId, 'email_verify_code');
    for (let i = 0; i < 5; i++) {
      await call('POST', '/me/account/email-verification/confirm', { token: accessToken, body: { code: wrongOf(code) } });
    }
    const late = await call('POST', '/me/account/email-verification/confirm', { token: accessToken, body: { code } });
    expect(late.statusCode).toBe(400);
    expect(late.json().details.reason).toBe('exhausted');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt).toBeNull();
  });

  it('تخمينات متزامنة لا تتجاوز خمس مقارنات — المحاولة تُحجز قبل المقارنة', async () => {
    if (!dbUp) return;
    const userId = await register('burst');
    const { accessToken } = await login('burst');
    await call('POST', '/me/account/email-verification', { token: accessToken });
    const code = await codeFromOutbox(userId, 'email_verify_code');
    const guesses = Array.from({ length: 20 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const results = await Promise.all(
      guesses.map((g) => call('POST', '/me/account/email-verification/confirm', { token: accessToken, body: { code: g } })),
    );
    const compared = results.filter((r) => r.json().details?.reason === 'wrong').length;
    expect(compared).toBeLessThanOrEqual(5);
    const row = await prisma.otpCode.findFirstOrThrow({ where: { userId, purpose: 'verify' }, orderBy: { createdAt: 'desc' } });
    expect(row.attempts).toBeLessThanOrEqual(5);
  });

  it('الرمز المنتهي مرفوض ولو كان صحيحاً', async () => {
    if (!dbUp) return;
    const userId = await register('expired');
    const { accessToken } = await login('expired');
    await call('POST', '/me/account/email-verification', { token: accessToken });
    const code = await codeFromOutbox(userId, 'email_verify_code');
    await prisma.otpCode.updateMany({ where: { userId, purpose: 'verify' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await call('POST', '/me/account/email-verification/confirm', { token: accessToken, body: { code } });
    expect(r.statusCode).toBe(400);
    expect(r.json().details.reason).toBe('expired');
  });

  it('بلا جلسة: 401', async () => {
    if (!dbUp) return;
    expect((await call('POST', '/me/account/email-verification')).statusCode).toBe(401);
    expect((await call('GET', '/me/account')).statusCode).toBe(401);
  });
});

describe('SH-04 · استعادة كلمة المرور', () => {
  it('الرد واحد للبريد المسجّل وغير المسجّل — ولا رمز يُصدر لغير المسجّل', async () => {
    if (!dbUp) return;
    const userId = await register('forgot');
    const known = await call('POST', '/auth/password/forgot', { body: { email: emailOf('forgot') } });
    const unknown = await call('POST', '/auth/password/forgot', { body: { email: `ghost.${SUFFIX}@basta.test` } });
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(await prisma.otpCode.count({ where: { userId, purpose: 'reset' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId, templateCode: 'password_reset_code', channel: 'email' } })).toBe(1);
    // داخل المهلة: الرد نفسه، ولا رمز ثانٍ
    const soon = await call('POST', '/auth/password/forgot', { body: { email: emailOf('forgot') } });
    expect(soon.body).toBe(known.body);
    expect(await prisma.otpCode.count({ where: { userId, purpose: 'reset' } })).toBe(1);
  });

  it('إعادة التعيين تُنهي كل الجلسات، والرمز لا يُستعمل مرتين، والفشل برسالة واحدة', async () => {
    if (!dbUp) return;
    const userId = await register('reset');
    const s1 = await login('reset', PASSWORD, 'device-one');
    const s2 = await login('reset', PASSWORD, 'device-two');
    await call('POST', '/auth/password/forgot', { body: { email: emailOf('reset') } });
    const code = await codeFromOutbox(userId, 'password_reset_code');
    const NEW = 'عبارة-مرور-جديدة-طويلة';

    const wrong = await call('POST', '/auth/password/reset', { body: { email: emailOf('reset'), code: wrongOf(code), newPassword: NEW } });
    const ghost = await call('POST', '/auth/password/reset', { body: { email: `ghost.${SUFFIX}@basta.test`, code, newPassword: NEW } });
    expect(wrong.statusCode).toBe(400);
    expect(ghost.statusCode).toBe(400);
    expect(ghost.json().message).toBe(wrong.json().message);
    expect(wrong.body).not.toMatch(/محاولة|attempts/);

    const short = await call('POST', '/auth/password/reset', { body: { email: emailOf('reset'), code, newPassword: 'short' } });
    expect(short.statusCode).toBe(400);

    const ok = await call('POST', '/auth/password/reset', { body: { email: emailOf('reset'), code, newPassword: NEW } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    for (const s of [s1, s2]) {
      expect((await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } })).statusCode).toBe(401);
    }
    expect((await call('POST', '/auth/login', { body: { email: emailOf('reset'), password: PASSWORD } })).statusCode).toBe(401);
    await login('reset', NEW);
    // البريد صار مؤكَّداً: الرمز وصله
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt).not.toBeNull();

    const replay = await call('POST', '/auth/password/reset', { body: { email: emailOf('reset'), code, newPassword: 'عبارة-ثالثة-طويلة-جداً' } });
    expect(replay.statusCode).toBe(400);
    await login('reset', NEW);
  });

  it('رمز مستخدم لا يعيد تعيين كلمة مستخدم آخر', async () => {
    if (!dbUp) return;
    const aId = await register('owner-a');
    await register('owner-b');
    await call('POST', '/auth/password/forgot', { body: { email: emailOf('owner-a') } });
    const codeA = await codeFromOutbox(aId, 'password_reset_code');
    const r = await call('POST', '/auth/password/reset', { body: { email: emailOf('owner-b'), code: codeA, newPassword: 'عبارة-مختطَفة-طويلة' } });
    expect(r.statusCode).toBe(400);
    await login('owner-b');
    await login('owner-a');
  });
});

describe('ST-25 · الملف وكلمة المرور والجلسات', () => {
  it('تعديل الاسم والجوال لصاحبه وحده، وحقل غير معلن مرفوض', async () => {
    if (!dbUp) return;
    const userId = await register('profile');
    const { accessToken } = await login('profile');
    const phone = `+9627${String(Date.now()).slice(-8)}`;
    const r = await call('PATCH', '/me/account', { token: accessToken, body: { fullName: 'اسم جديد', phone } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ fullName: 'اسم جديد', phone });
    const cleared = await call('PATCH', '/me/account', { token: accessToken, body: { phone: '' } });
    expect(cleared.json().phone).toBeNull();
    expect((await call('PATCH', '/me/account', { token: accessToken, body: { email: 'x@basta.test' } })).statusCode).toBe(400);
    expect((await call('PATCH', '/me/account', { token: accessToken, body: { userId } })).statusCode).toBe(400);
    expect((await call('PATCH', '/me/account', { token: accessToken, body: { phone: '0790000000' } })).statusCode).toBe(400);
    expect(await prisma.auditLog.count({ where: { actorUserId: userId, action: 'user.profile_update' } })).toBe(2);
  });

  it('الجلسات: الحالية معلَّمة، و«إنهاء الأخرى» يُبقيها وحدها', async () => {
    if (!dbUp) return;
    await register('sessions');
    const other = await login('sessions', PASSWORD, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1');
    const me = await login('sessions', PASSWORD, 'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0');

    const list = await call('GET', '/me/account/sessions', { token: me.accessToken });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as { id: string; current: boolean; userAgent: string }[];
    expect(items).toHaveLength(2);
    expect(items[0]!.current).toBe(true);
    expect(items[0]!.id).toBe(sidOf(me.accessToken));
    expect(items.find((s) => s.id === sidOf(other.accessToken))!.current).toBe(false);

    const r = await call('POST', '/me/account/sessions/revoke-others', { token: me.accessToken });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().revokedSessions).toBe(1);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: other.refreshToken } })).statusCode).toBe(401);
    // الجلسة الحالية حيّة، وتدويرها يُبقي معرّفها
    const rotated = await call('POST', '/auth/refresh', { body: { refreshToken: me.refreshToken } });
    expect(rotated.statusCode).toBe(200);
    expect(sidOf(rotated.json().accessToken)).toBe(sidOf(me.accessToken));
  });

  it('مستخدم لا يرى جلسات غيره ولا يُنهيها — 404', async () => {
    if (!dbUp) return;
    await register('victim');
    await register('intruder');
    const victim = await login('victim');
    const intruder = await login('intruder');

    const seen = (await call('GET', '/me/account/sessions', { token: intruder.accessToken })).json().items as { id: string }[];
    expect(seen.map((s) => s.id)).not.toContain(sidOf(victim.accessToken));

    const r = await call('DELETE', `/me/account/sessions/${sidOf(victim.accessToken)}`, { token: intruder.accessToken });
    expect(r.statusCode).toBe(404);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: victim.refreshToken } })).statusCode).toBe(200);

    // وصاحبها يُنهيها
    const second = await login('victim');
    const own = await call('DELETE', `/me/account/sessions/${sidOf(victim.accessToken)}`, { token: second.accessToken });
    expect(own.statusCode).toBe(204);
  });

  it('تغيير كلمة المرور يطلب الحالية، ويُنهي الأخرى ويُبقي الحالية', async () => {
    if (!dbUp) return;
    const userId = await register('chpw');
    const other = await login('chpw', PASSWORD, 'other-device');
    const me = await login('chpw', PASSWORD, 'this-device');
    const NEW = 'عبارة-مرور-محدّثة-طويلة';

    const bad = await call('POST', '/me/account/password', { token: me.accessToken, body: { currentPassword: 'wrong-password-x', newPassword: NEW } });
    expect(bad.statusCode).toBe(400);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(2);

    const ok = await call('POST', '/me/account/password', { token: me.accessToken, body: { currentPassword: PASSWORD, newPassword: NEW } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ revokedSessions: 1, currentKept: true });
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: other.refreshToken } })).statusCode).toBe(401);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: me.refreshToken } })).statusCode).toBe(200);
    await login('chpw', NEW);
  });
});
