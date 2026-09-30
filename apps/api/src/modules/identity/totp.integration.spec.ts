/**
 * التحقق بخطوتين لكل الحسابات — على PostgreSQL حيّ عبر HTTP.
 *
 * ما يُثبَت:
 *  · من فعّله — عميلاً كان — لا يدخل بكلمة المرور وحدها (كان الشرط للإدارة وحدها)
 *  · بدء التهيئة لا يعيد ضبط تحقق مفعَّل (كانت جلسة مسروقة تعطّله بصمت)
 *  · رموز الاستعادة: عشرة، مجزّأة، كلٌّ لدخول واحد ولو تزامن، ويُبلَّغ صاحبها
 *  · التعطيل بكلمة المرور ورمز معاً؛ الرموز الجديدة تُبطل القديمة
 *  · إعادة الضبط من الإدارة: بصلاحية وسبب، تُنهي الجلسات، ولا تمسّ حساب مدير
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTotpSecret } from './infrastructure/secret-box';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;
const SUFFIX = `tfa${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
const call = (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown; cookie?: string } = {}): Promise<Res> =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    remoteAddress: '10.9.1.1',
    headers: {
      'user-agent': 'vitest-agent',
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
const totpOf = (secret: string) => generateSync({ strategy: 'totp', secret, crypto, base32 });

async function register(tag: string): Promise<string> {
  const r = await call('POST', '/auth/register', { body: { email: emailOf(tag), password: PASSWORD, fullName: `مستخدم ${tag}` } });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().userId;
}

const loginRaw = (tag: string, totp?: string, password = PASSWORD) =>
  call('POST', '/auth/login', { body: { email: emailOf(tag), password, ...(totp ? { totp } : {}) } });

async function login(tag: string, totp?: string): Promise<string> {
  const r = await loginRaw(tag, totp);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().tokens.accessToken;
}

/** السرّ مخزَّن مشفّراً (secret-box) — يُفكّ للمقارنة بما عُرض لصاحبه */
const plainOf = (stored: string | null, userId: string): string | null => (stored ? openTotpSecret(stored, userId) : null);

/** رمز التطبيق لا يُقبل ثانيةً داخل نافذته — الاختبار يصفّر الخطوة ليستعمل رمزاً جديداً */
const freshStep = (userId: string) => prisma.user.update({ where: { id: userId }, data: { totpLastStep: null } });

/** يفعّل التحقق عبر المسار العام نفسه ويعيد السرّ ورموز الاستعادة */
async function enable(tag: string, userId: string): Promise<{ secret: string; codes: string[] }> {
  const token = await login(tag);
  const setup = await call('POST', '/auth/totp/setup', { token });
  expect(setup.statusCode, setup.body).toBe(201);
  const { secret } = setup.json();
  const confirm = await call('POST', '/auth/totp/confirm', { token, body: { token: totpOf(secret) } });
  expect(confirm.statusCode, confirm.body).toBe(200);
  await freshStep(userId);
  return { secret, codes: confirm.json().recoveryCodes };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات التحقق بخطوتين متخطّاة.\n');
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

describe('التحقق بخطوتين لغير المدير', () => {
  it('التفعيل يعطي عشرة رموز مجزّأة، ويُنهي الجلسات، ولا يُعاد بدؤه على تحقق مفعَّل', async () => {
    if (!dbUp) return;
    const userId = await register('enable');
    const before = await loginRaw('enable');
    const oldRefresh = rtOf(before);

    const { codes } = await enable('enable', userId);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);

    const rows = await prisma.totpRecoveryCode.findMany({ where: { userId } });
    expect(rows).toHaveLength(10);
    for (const r of rows) for (const c of codes) expect(r.codeHash).not.toContain(c.replace('-', ''));

    // الجلسة التي سبقت التفعيل لا تتجدّد: كل جهاز يدخل بالرمز من جديد
    const refreshed = await call('POST', '/auth/refresh', { cookie: oldRefresh });
    expect(refreshed.statusCode).toBe(401);

    // الثغرة المغلقة: جلسة (ولو مسروقة) لا تبدأ تهيئة جديدة تصفّر التحقق المفعَّل
    const { secret } = { secret: plainOf((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpSecretEnc, userId)! };
    const token = await login('enable', totpOf(secret));
    const again = await call('POST', '/auth/totp/setup', { token });
    expect(again.statusCode).toBe(409);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.totpEnabledAt).not.toBeNull();
    expect(plainOf(u.totpSecretEnc, u.id)).toBe(secret);
  });

  it('الدخول يطلب الرمز: بلا رمز أو برمز خاطئ يُرفض، وبرمز التطبيق يُقبل', async () => {
    if (!dbUp) return;
    const userId = await register('login');
    const { secret } = await enable('login', userId);

    const none = await loginRaw('login');
    expect(none.statusCode).toBe(401);
    expect(none.json().message).toMatch(/رمز التحقق الثنائي/);
    const wrong = await loginRaw('login', totpOf(secret) === '000000' ? '111111' : '000000');
    expect(wrong.statusCode).toBe(401);

    await login('login', totpOf(secret));
  });

  it('رمز الاستعادة يفتح الحساب مرة واحدة، بأي كتابة، ويُبلَّغ صاحبه ويُدقَّق', async () => {
    if (!dbUp) return;
    const userId = await register('recover');
    const { codes } = await enable('recover', userId);

    await login('recover', codes[0]);
    const reuse = await loginRaw('recover', codes[0]);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().message).toMatch(/رمز الاستعادة/);

    // بلا شرطة وبأحرف صغيرة — كما يكتبه الإنسان من ورقة
    await login('recover', codes[1]!.replace('-', '').toLowerCase());

    const left = await prisma.totpRecoveryCode.count({ where: { userId, usedAt: null } });
    expect(left).toBe(8);
    const audits = await prisma.auditLog.count({ where: { entityId: userId, action: 'auth.recovery_code_used' } });
    expect(audits).toBe(2);
    const notes = await prisma.notification.findMany({ where: { userId, templateCode: 'recovery_code_used', channel: 'email' }, orderBy: { createdAt: 'desc' } });
    expect(notes).toHaveLength(2);
    expect((notes[0]!.payloadJson as Record<string, string>)['left']).toBe('8');
  });

  it('رمز استعادة واحد في خمسة دخولات متزامنة يفتح الحساب مرة واحدة', async () => {
    if (!dbUp) return;
    const userId = await register('race');
    const { codes } = await enable('race', userId);

    const results = await Promise.all(Array.from({ length: 5 }, () => loginRaw('race', codes[3])));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(await prisma.totpRecoveryCode.count({ where: { userId, usedAt: { not: null } } })).toBe(1);
  });

  it('الرموز الجديدة تُبطل القديمة وتحتاج إثباتاً ثانياً', async () => {
    if (!dbUp) return;
    const userId = await register('regen');
    const { secret, codes } = await enable('regen', userId);
    const token = await login('regen', totpOf(secret));
    await freshStep(userId);

    const bare = await call('POST', '/auth/totp/recovery-codes', { token, body: {} });
    expect(bare.statusCode).toBe(400);
    const wrong = await call('POST', '/auth/totp/recovery-codes', { token, body: { code: '000000' } });
    expect(wrong.statusCode).toBe(401);

    const fresh = await call('POST', '/auth/totp/recovery-codes', { token, body: { code: totpOf(secret) } });
    expect(fresh.statusCode, fresh.body).toBe(200);
    const newCodes: string[] = fresh.json().recoveryCodes;
    expect(newCodes).toHaveLength(10);

    expect((await loginRaw('regen', codes[0])).statusCode).toBe(401);
    await login('regen', newCodes[0]);
  });

  it('التعطيل يحتاج كلمة المرور والرمز معاً، وبعده يعود الدخول بكلمة المرور', async () => {
    if (!dbUp) return;
    const userId = await register('disable');
    const { secret } = await enable('disable', userId);
    const token = await login('disable', totpOf(secret));
    await freshStep(userId);

    const noPass = await call('POST', '/auth/totp/disable', { token, body: { password: 'خطأ-خطأ-خطأ', code: totpOf(secret) } });
    expect(noPass.statusCode).toBe(401);
    const noCode = await call('POST', '/auth/totp/disable', { token, body: { password: PASSWORD, code: '000000' } });
    expect(noCode.statusCode).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpEnabledAt).not.toBeNull();

    const ok = await call('POST', '/auth/totp/disable', { token, body: { password: PASSWORD, code: totpOf(secret) } });
    expect(ok.statusCode, ok.body).toBe(204);
    expect(await prisma.totpRecoveryCode.count({ where: { userId } })).toBe(0);
    await login('disable');
  });
});

describe('تغيير الجهاز — السرّ الجديد منتظِر حتى يُؤكَّد', () => {
  it('مدير مفعَّل يفتح الصفحة: لا يُعطَّل تحققه ولا يدخل بكلمة المرور وحدها', async () => {
    if (!dbUp) return;
    const id = await register('adm2fa');
    await prisma.userRole.create({ data: { userId: id, role: 'admin' } });
    const secret = 'JBSWY3DPEHPK3PXP'.padEnd(32, 'B');
    await prisma.user.update({ where: { id }, data: { totpSecretEnc: secret, totpEnabledAt: new Date() } });
    const token = await login('adm2fa', totpOf(secret));

    // ما تفعله الصفحة عند فتحها — بلا كلمة مرور ولا رمز
    expect((await call('POST', '/auth/totp/setup', { token })).statusCode).toBe(409);
    // وبكلمة مرور صحيحة ورمز خاطئ، أو العكس
    const noCode = await call('POST', '/auth/totp/setup', { token, body: { password: PASSWORD, code: '000000' } });
    expect(noCode.statusCode).toBe(403);
    await freshStep(id);
    const noPass = await call('POST', '/auth/totp/setup', { token, body: { password: 'خطأ-خطأ-خطأ', code: totpOf(secret) } });
    expect(noPass.statusCode).toBe(403);

    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(u.totpEnabledAt).not.toBeNull();
    expect(plainOf(u.totpSecretEnc, u.id)).toBe(secret);
    expect(u.totpPendingSecretEnc).toBeNull();
    const bare = await loginRaw('adm2fa');
    expect(bare.statusCode).toBe(401);
    expect(bare.json().message).toMatch(/رمز التحقق الثنائي/);
  });

  it('تهيئة بُدئت ولم تُؤكَّد لا تمسّ السرّ الساري', async () => {
    if (!dbUp) return;
    const userId = await register('abandon');
    const { secret } = await enable('abandon', userId);
    const token = await login('abandon', totpOf(secret));
    await freshStep(userId);

    const begun = await call('POST', '/auth/totp/setup', { token, body: { password: PASSWORD, code: totpOf(secret) } });
    expect(begun.statusCode, begun.body).toBe(201);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(plainOf(u.totpSecretEnc, u.id)).toBe(secret);
    expect(plainOf(u.totpPendingSecretEnc, u.id)).toBe(begun.json().secret);
    expect(u.totpEnabledAt).not.toBeNull();

    expect((await loginRaw('abandon')).statusCode).toBe(401);
    await freshStep(userId);
    await login('abandon', totpOf(secret));
  });

  it('بعد التأكيد: السرّ الجديد وحده يفتح، والرموز القديمة تُبطل، ويُدقَّق ويُبلَّغ', async () => {
    if (!dbUp) return;
    const userId = await register('rotate');
    const { secret: oldSecret, codes: oldCodes } = await enable('rotate', userId);
    const token = await login('rotate', totpOf(oldSecret));
    await freshStep(userId);

    const begun = await call('POST', '/auth/totp/setup', { token, body: { password: PASSWORD, code: totpOf(oldSecret) } });
    expect(begun.statusCode, begun.body).toBe(201);
    const newSecret: string = begun.json().secret;
    expect(newSecret).not.toBe(oldSecret);

    const wrong = await call('POST', '/auth/totp/confirm', { token, body: { token: totpOf(oldSecret) } });
    expect(wrong.statusCode).toBe(401);
    const ok = await call('POST', '/auth/totp/confirm', { token, body: { token: totpOf(newSecret) } });
    expect(ok.statusCode, ok.body).toBe(200);
    const newCodes: string[] = ok.json().recoveryCodes;
    expect(newCodes).toHaveLength(10);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(plainOf(u.totpSecretEnc, u.id)).toBe(newSecret);
    expect(u.totpPendingSecretEnc).toBeNull();
    expect(u.totpEnabledAt).not.toBeNull();

    await freshStep(userId);
    expect((await loginRaw('rotate', totpOf(oldSecret))).statusCode).toBe(401);
    expect((await loginRaw('rotate', oldCodes[0])).statusCode).toBe(401);
    await login('rotate', totpOf(newSecret));

    expect(await prisma.auditLog.count({ where: { entityId: userId, action: 'auth.totp_rotated' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId, templateCode: 'totp_rotated' } })).toBeGreaterThan(0);
  });
});

describe('إعادة الضبط من الإدارة', () => {
  /** مدير كامل التحقق — بصلاحيات تُمرَّر — كما تفعل اختبارات الإدارة */
  async function admin(tag: string, permissions: string[]): Promise<string> {
    const id = await register(tag);
    await prisma.userRole.create({ data: { userId: id, role: 'admin' } });
    if (permissions.length) await prisma.adminPermission.createMany({ data: permissions.map((permission) => ({ userId: id, permission })) });
    const secret = 'JBSWY3DPEHPK3PXP'.padEnd(32, 'A');
    await prisma.user.update({ where: { id }, data: { totpSecretEnc: secret, totpEnabledAt: new Date() } });
    return login(tag, totpOf(secret));
  }

  it('بصلاحية وسبب: يمسح التحقق والرموز ويُنهي الجلسات ويُبلّغ، ولا يمسّ حساب مدير', async () => {
    if (!dbUp) return;
    const victimId = await register('lost');
    const { secret } = await enable('lost', victimId);
    const victimSession = await loginRaw('lost', totpOf(secret));
    const victimRefresh = rtOf(victimSession);

    const support = await admin('support', ['customers.manage']);
    const outsider = await admin('outsider', ['reports.view']);

    const forbidden = await call('POST', `/admin/customers/${victimId}/reset-2fa`, { token: outsider, body: { reason: 'سبب طويل بما يكفي للتدقيق' } });
    expect(forbidden.statusCode).toBe(403);
    const short = await call('POST', `/admin/customers/${victimId}/reset-2fa`, { token: support, body: { reason: 'قصير' } });
    expect(short.statusCode).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: victimId } })).totpEnabledAt).not.toBeNull();

    const detail = await call('GET', `/admin/customers/${victimId}`, { token: support });
    expect(detail.json().totpResettable).toBe(true);

    const reason = 'تحقّقنا من هويته بالمكالمة ورقم آخر طلب';
    const ok = await call('POST', `/admin/customers/${victimId}/reset-2fa`, { token: support, body: { reason } });
    expect(ok.statusCode, ok.body).toBe(204);

    expect(await prisma.totpRecoveryCode.count({ where: { userId: victimId } })).toBe(0);
    expect((await call('POST', '/auth/refresh', { cookie: victimRefresh })).statusCode).toBe(401);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: victimId, action: 'customer.totp_reset' } });
    expect((audit.afterJson as Record<string, string>)['reason']).toBe(reason);
    expect(await prisma.notification.count({ where: { userId: victimId, templateCode: 'totp_reset_by_admin' } })).toBeGreaterThan(0);
    await login('lost');

    // حساب مدير: لا يُعاد ضبط تحققه من هنا ولو بالصلاحية
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: emailOf('outsider') } })).id;
    const onAdmin = await call('POST', `/admin/customers/${adminId}/reset-2fa`, { token: support, body: { reason } });
    expect(onAdmin.statusCode).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).totpEnabledAt).not.toBeNull();
  });
});

describe('سرّ التحقق الثنائي لا يُقرأ من القاعدة', () => {
  it('التهيئة والتأكيد يخزّنان السرّ مشفّراً، والدخول يعمل به', async () => {
    if (!dbUp) return;
    const userId = await register('sealed');
    const token = await login('sealed');
    const setup = await call('POST', '/auth/totp/setup', { token });
    const { secret } = setup.json();
    // المنتظر مشفّر قبل التأكيد…
    const pending = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpPendingSecretEnc!;
    expect(pending).toMatch(/^v1\./);
    expect(pending).not.toContain(secret);

    expect((await call('POST', '/auth/totp/confirm', { token, body: { token: totpOf(secret) } })).statusCode).toBe(200);
    // …والساري بعده
    const stored = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpSecretEnc!;
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain(secret);

    await freshStep(userId);
    expect((await loginRaw('sealed', totpOf(secret))).statusCode).toBe(200);
  });

  it('سرّ قديم مكتوب نصّاً يعمل ويُشفَّر عند أول دخول ناجح', async () => {
    if (!dbUp) return;
    const userId = await register('legacy');
    const { secret } = await enable('legacy', userId);
    await prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: secret, totpLastStep: null } });

    expect((await loginRaw('legacy', totpOf(secret))).statusCode).toBe(200);
    const stored = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpSecretEnc!;
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain(secret);
  });
});
