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
  opts: { token?: string; body?: unknown; ua?: string; cookie?: string } = {},
): Promise<Res> =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    remoteAddress: '10.9.0.1',
    headers: {
      'user-agent': opts.ua ?? 'vitest-agent',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { cookie: `basta_rt=${opts.cookie}` } : {}),
    },
    ...(opts.body !== undefined ? { payload: opts.body as Record<string, unknown> } : {}),
  });

/** رمز التحديث من كوكي الردّ — لا يصل في الجسم */
const rtOf = (res: Res): string => {
  const raw = res.headers['set-cookie'];
  const line = (Array.isArray(raw) ? raw : [raw ?? '']).find((c) => c.startsWith('basta_rt='));
  if (!line) throw new Error(`لا كوكي تحديث: ${res.statusCode} ${res.body}`);
  return line.slice('basta_rt='.length).split(';')[0]!;
};

const emailOf = (tag: string) => `${tag}.${SUFFIX}@basta.test`;

async function register(tag: string): Promise<string> {
  const r = await call('POST', '/auth/register', { body: { email: emailOf(tag), password: PASSWORD, fullName: `مستخدم ${tag}` } });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().userId;
}

async function login(tag: string, password = PASSWORD, ua = 'vitest-agent'): Promise<{ accessToken: string; refreshToken: string }> {
  const r = await call('POST', '/auth/login', { body: { email: emailOf(tag), password }, ua });
  expect(r.statusCode, r.body).toBe(200);
  return { accessToken: r.json().tokens.accessToken, refreshToken: rtOf(r) };
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

describe('البريد لا يفرّق بين الحروف — صندوق واحد حساب واحد', () => {
  it('تسجيل البريد نفسه بحروف أخرى يُرفض، والدخول والاستعادة بأي حروف يصلان للحساب نفسه', async () => {
    if (!dbUp) return;
    const lower = emailOf('casefold');
    const upper = lower.toUpperCase();
    const userId = await register('casefold');

    // المهاجم يسجّل الصندوق نفسه بحروف كبيرة — كان حساباً ثانياً
    const twin = await call('POST', '/auth/register', { body: { email: upper, password: PASSWORD, fullName: 'منتحل' } });
    expect(twin.statusCode, twin.body).toBe(409);
    expect(await prisma.user.count({ where: { email: { equals: lower, mode: 'insensitive' } } })).toBe(1);

    // صاحب الحساب يدخل كيفما كتب بريده
    // وبمسافات نسخها معه من رسالة
    const login = await call('POST', '/auth/login', { body: { email: `  ${upper} `, password: PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    expect(sidOf(login.json().tokens.accessToken)).toBeTruthy();

    // ورمز الاستعادة يذهب لحسابه هو
    expect((await call('POST', '/auth/password/forgot', { body: { email: upper } })).statusCode).toBe(200);
    expect(await prisma.notification.count({ where: { userId, templateCode: 'password_reset_code', channel: 'email' } })).toBe(1);
  });

  it('القاعدة ترفض بريداً غير موحَّد ولو كُتب من خارج الخادم', async () => {
    if (!dbUp) return;
    await expect(
      prisma.user.create({ data: { email: `Mixed.${SUFFIX}@Basta.test`, fullName: 'كتابة مباشرة' } }),
    ).rejects.toThrow(/users_email_normalized/);
  });
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
      expect((await call('POST', '/auth/refresh', { cookie: s.refreshToken })).statusCode).toBe(401);
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
    expect((await call('POST', '/auth/refresh', { cookie: other.refreshToken })).statusCode).toBe(401);
    // الجلسة الحالية حيّة، وتدويرها يُبقي معرّفها
    const rotated = await call('POST', '/auth/refresh', { cookie: me.refreshToken });
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
    expect((await call('POST', '/auth/refresh', { cookie: victim.refreshToken })).statusCode).toBe(200);

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
    expect((await call('POST', '/auth/refresh', { cookie: other.refreshToken })).statusCode).toBe(401);
    expect((await call('POST', '/auth/refresh', { cookie: me.refreshToken })).statusCode).toBe(200);
    await login('chpw', NEW);
  });
});

describe('رمز التحديث كوكي HttpOnly — لا يقرؤه سكربت', () => {
  const cookieLine = (res: Res) => {
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw : [raw ?? '']).find((c) => c.startsWith('basta_rt=')) ?? '';
  };

  it('الدخول: الرمز في كوكي HttpOnly محصور بمسارات /auth، ولا أثر له في الجسم', async () => {
    if (!dbUp) return;
    await register('rt-cookie');
    const r = await call('POST', '/auth/login', { body: { email: emailOf('rt-cookie'), password: PASSWORD } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().tokens.accessToken).toBeTruthy();
    expect(r.json().tokens).not.toHaveProperty('refreshToken');
    expect(r.body).not.toContain(rtOf(r));

    const attrs = cookieLine(r).split(';').map((a) => a.trim());
    expect(attrs).toContain('HttpOnly');
    expect(attrs).toContain('SameSite=Strict');
    expect(attrs).toContain('Path=/api/v1/auth');
    expect(attrs).toContain(`Max-Age=${30 * 86_400}`);
  });

  it('التدوير يقرأ الكوكي وحده — الرمز في الجسم لا يُقبل — ويعيد الجديد كوكياً', async () => {
    if (!dbUp) return;
    await register('rt-rotate');
    const s = await login('rt-rotate');
    const inBody = await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } });
    expect(inBody.statusCode).toBe(401);

    const r = await call('POST', '/auth/refresh', { cookie: s.refreshToken });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().accessToken).toBeTruthy();
    expect(r.json()).not.toHaveProperty('refreshToken');
    const next = rtOf(r);
    expect(next).not.toBe(s.refreshToken);
    expect((await call('POST', '/auth/refresh', { cookie: next })).statusCode).toBe(200);
  });

  it('الخروج يُبطل رمز الكوكي ويمسحه', async () => {
    if (!dbUp) return;
    await register('rt-logout');
    const s = await login('rt-logout');
    const out = await call('POST', '/auth/logout', { cookie: s.refreshToken });
    expect(out.statusCode).toBe(204);
    expect(cookieLine(out)).toMatch(/^basta_rt=;.*Max-Age=0/);
    expect((await call('POST', '/auth/refresh', { cookie: s.refreshToken })).statusCode).toBe(401);
  });
});

describe('تدوير رمز التحديث تحت التزامن', () => {
  const refresh = (refreshToken: string, ua = 'vitest-agent') => call('POST', '/auth/refresh', { cookie: refreshToken, ua });

  it('خمسة تجديدات متزامنة بالرمز نفسه: جلسة واحدة لا خمس، والبقية 409 بلا إنهاء الجلسة', async () => {
    if (!dbUp) return;
    const userId = await register('rot-race');
    const s = await login('rot-race');

    const results = await Promise.all(Array.from({ length: 5 }, () => refresh(s.refreshToken)));
    const ok = results.filter((r) => r.statusCode === 200);
    expect(ok, results.map((r) => `${r.statusCode} ${r.body}`).join('\n')).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(4);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('REFRESH_ROTATED');

    // رمز واحد حيّ في العائلة — خلف الفائز — والجلسة لم تُنهَ
    const live = await prisma.refreshToken.findMany({ where: { userId, revokedAt: null } });
    expect(live).toHaveLength(1);
    const next = rtOf(ok[0]!);
    expect((await refresh(next)).statusCode).toBe(200);
  });

  it('الرمز المدوَّر من جهاز آخر — ولو في المهلة — سرقة: تُنهى العائلة', async () => {
    if (!dbUp) return;
    const userId = await register('rot-thief');
    const s = await login('rot-thief');
    const first = await refresh(s.refreshToken);
    expect(first.statusCode).toBe(200);

    const thief = await refresh(s.refreshToken, 'curl/8.0 attacker');
    expect(thief.statusCode).toBe(401);
    expect(thief.json().message).toMatch(/استعمال مكرّر/);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect((await refresh(rtOf(first))).statusCode).toBe(401);
  });

  it('بعد المهلة ولو من الجهاز نفسه: سرقة', async () => {
    if (!dbUp) return;
    const userId = await register('rot-late');
    const s = await login('rot-late');
    expect((await refresh(s.refreshToken)).statusCode).toBe(200);
    // التدوير «حدث» قبل دقيقة
    await prisma.refreshToken.updateMany({
      where: { userId, replacedById: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const late = await refresh(s.refreshToken);
    expect(late.statusCode).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it('رمز خرج صاحبه به لا يُعدّ تزامناً ولو للتوّ', async () => {
    if (!dbUp) return;
    await register('rot-logout');
    const s = await login('rot-logout');
    expect((await call('POST', '/auth/logout', { token: s.accessToken, cookie: s.refreshToken })).statusCode).toBeLessThan(300);
    expect((await refresh(s.refreshToken)).statusCode).toBe(401);
  });
});

describe('رمز الوصول يُقرأ مع القاعدة — لا ينتظر انتهاءه', () => {
  const me = (token: string) => call('GET', '/me/account', { token });

  it('الخروج يُسقط رمز الوصول في الطلب التالي', async () => {
    if (!dbUp) return;
    await register('live-logout');
    const s = await login('live-logout');
    expect((await me(s.accessToken)).statusCode).toBe(200);
    await call('POST', '/auth/logout', { token: s.accessToken, cookie: s.refreshToken });
    expect((await me(s.accessToken)).statusCode).toBe(401);
  });

  it('تغيير كلمة المرور يُسقط رموز الأجهزة الأخرى فوراً، ويُبقي الحالي', async () => {
    if (!dbUp) return;
    await register('live-chpw');
    const other = await login('live-chpw', PASSWORD, 'other-device');
    const current = await login('live-chpw', PASSWORD, 'this-device');
    const r = await call('POST', '/me/account/password', {
      token: current.accessToken,
      body: { currentPassword: PASSWORD, newPassword: 'عبارة-مرور-جديدة-للجلسات' },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((await me(other.accessToken)).statusCode).toBe(401);
    expect((await me(current.accessToken)).statusCode).toBe(200);
  });

  it('الحساب الموقوف يُرفض في الطلب التالي ولو كان رمزه صالح التوقيع', async () => {
    if (!dbUp) return;
    const userId = await register('live-suspend');
    const s = await login('live-suspend');
    expect((await me(s.accessToken)).statusCode).toBe(200);
    // الإيقاف في القاعدة وحدها — بلا إبطال جلسات — فالحارس نفسه هو ما يُثبَت
    await prisma.user.update({ where: { id: userId }, data: { status: 'suspended' } });
    const after = await me(s.accessToken);
    expect(after.statusCode).toBe(401);
    expect(after.json().message).toMatch(/الحساب غير متاح/);
  });

  it('الصلاحية المسحوبة والدور المسحوب يسريان فوراً', async () => {
    if (!dbUp) return;
    const userId = await register('live-perm');
    const secret = 'JBSWY3DPEHPK3PXP'.padEnd(32, 'D');
    await prisma.userRole.create({ data: { userId, role: 'admin' } });
    await prisma.adminPermission.create({ data: { userId, permission: 'content.manage' } });
    await prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: secret, totpEnabledAt: new Date() } });
    const { NobleCryptoPlugin, ScureBase32Plugin, generateSync } = await import('otplib');
    const code = generateSync({ strategy: 'totp', secret, crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
    const r = await call('POST', '/auth/login', { body: { email: emailOf('live-perm'), password: PASSWORD, totp: code } });
    expect(r.statusCode, r.body).toBe(200);
    const token = r.json().tokens.accessToken as string;
    const templates = () => call('GET', '/admin/notifications/templates', { token });
    expect((await templates()).statusCode).toBe(200);

    // سحب في القاعدة وحدها — بلا إنهاء الجلسة: الرمز ما زال يحمل الصلاحية في مطالباته
    await prisma.adminPermission.deleteMany({ where: { userId } });
    expect((await templates()).statusCode).toBe(403);
    await prisma.userRole.deleteMany({ where: { userId, role: 'admin' } });
    expect((await templates()).statusCode).toBe(403);
    // والجلسة نفسها باقية: ما سُحب هو الصلاحية لا الدخول
    expect((await me(token)).statusCode).toBe(200);
  });
});
