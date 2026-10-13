/**
 * الخروج من قفل الإدارة — admin:recover و admin:transfer-owner.
 *
 * ما يُثبَت:
 *   · مدير أضاع الهاتف والرموز معاً: يُمسح تحققه ورموزه، وتُنهى جلساته، ويُكتب في
 *     التدقيق ويُبلَّغ — ودخوله التالي بكلمة المرور يُلزمه بتفعيل التحقق من جديد
 *   · لا يمسّ حساب عميل، ولا يعمل بلا سبب
 *   · الملكية تنتقل إلى مدير بتحقق مفعَّل وحده، والمالك يبقى واحداً
 *
 * اختبار الملكية داخل معاملة يُتراجع عنها: المالك واحد في القاعدة كلها، واختبارات
 * أخرى تقرؤه في اللحظة نفسها.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecoveryRefused, recoverAdminTotp, transferOwnership } from './application/owner-recovery';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;
const SUFFIX = `own${Date.now()}`;
const PASSWORD = 'كلمة-مرور-المالك-الطويلة';

let hashPassword: (p: string) => Promise<string>;

async function makeUser(tag: string, opts: { admin: boolean; totp: boolean }) {
  return prisma.user.create({
    data: {
      email: `${tag}.${SUFFIX}@basta.test`,
      fullName: `حساب ${tag}`,
      passwordHash: await hashPassword(PASSWORD),
      roles: { create: [{ role: opts.admin ? 'admin' : 'customer' }] },
      ...(opts.totp ? { totpSecretEnc: 'sealed-secret-for-test', totpEnabledAt: new Date() } : {}),
    },
  });
}

class Rollback extends Error {}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  const [{ Test }, { AppModule }, { configureApp }, identity] = await Promise.all([
    import('@nestjs/testing'),
    import('../../app.module'),
    import('../../app.setup'),
    import('../identity/public'),
  ]);
  hashPassword = identity.hashPassword;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 90_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('admin:recover — مدير أضاع هاتف المصادقة ورموز الاستعادة معاً', () => {
  it('يُمسح التحقق والرموز، وتُنهى الجلسات، ويُدقَّق ويُبلَّغ — والدخول التالي يُلزمه بالتفعيل', async () => {
    if (!dbUp) return;
    const admin = await makeUser('locked', { admin: true, totp: true });
    await prisma.totpRecoveryCode.createMany({
      data: Array.from({ length: 3 }, () => ({ userId: admin.id, codeHash: randomBytes(16).toString('hex') })),
    });
    await prisma.refreshToken.createMany({
      data: Array.from({ length: 2 }, () => ({
        userId: admin.id,
        tokenHash: randomBytes(24).toString('hex'),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      })),
    });

    const r = await prisma.$transaction((tx) =>
      recoverAdminTotp(tx, { email: admin.email!.toUpperCase(), reason: 'فقد هاتفه ورموز الاستعادة في سفر' }),
    );
    expect(r).toMatchObject({ userId: admin.id, codesRemoved: 3, sessionsEnded: 2 });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after).toMatchObject({ totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null });
    expect(await prisma.totpRecoveryCode.count({ where: { userId: admin.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: admin.id, revokedAt: null } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.totp_recovered', entityId: admin.id } });
    expect(audit.afterJson).toMatchObject({ reason: 'فقد هاتفه ورموز الاستعادة في سفر', via: 'cli' });
    expect(await prisma.notification.count({ where: { userId: admin.id, templateCode: 'totp_reset_by_admin' } })).toBeGreaterThan(0);

    // كلمة المرور تفتح، لكن رمزاً محدوداً لا يفتح إلا تفعيل التحقق — لا مدير بلا تحقق
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: admin.email, password: PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    expect(login.json().requiresTotpSetup).toBe(true);
  });

  it('لا يمسّ حساب عميل، ولا يعمل بلا سبب أو لبريد مجهول', async () => {
    if (!dbUp) return;
    const customer = await makeUser('customer', { admin: false, totp: true });
    const admin = await makeUser('noreason', { admin: true, totp: true });

    await expect(prisma.$transaction((tx) => recoverAdminTotp(tx, { email: customer.email!, reason: 'سبب طويل بما يكفي' }))).rejects.toThrow(
      /ليس حساب إدارة/,
    );
    await expect(prisma.$transaction((tx) => recoverAdminTotp(tx, { email: admin.email!, reason: 'قصير' }))).rejects.toBeInstanceOf(
      RecoveryRefused,
    );
    await expect(
      prisma.$transaction((tx) => recoverAdminTotp(tx, { email: `ghost.${SUFFIX}@basta.test`, reason: 'سبب طويل بما يكفي' })),
    ).rejects.toThrow(/لا حساب/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).totpEnabledAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).totpEnabledAt).not.toBeNull();
  });
});

describe('admin:transfer-owner — الملكية تنتقل ولا تضيع', () => {
  it('إلى مدير بتحقق مفعَّل وحده، والمالك يبقى واحداً، ويُدقَّق — داخل معاملة يُتراجع عنها', async () => {
    if (!dbUp) return;
    const heir = await makeUser('heir', { admin: true, totp: true });
    const unsecured = await makeUser('unsecured', { admin: true, totp: false });
    const customer = await makeUser('notadmin', { admin: false, totp: true });
    const original = await prisma.user.findFirst({ where: { isPlatformOwner: true }, select: { id: true, email: true } });

    const outcome = await prisma
      .$transaction(async (tx) => {
        await expect(transferOwnership(tx, { toEmail: unsecured.email!, reason: 'تسليم الإدارة للشريك' })).rejects.toThrow(/تحققه الثنائي/);
        await expect(transferOwnership(tx, { toEmail: customer.email!, reason: 'تسليم الإدارة للشريك' })).rejects.toThrow(/ليس مديراً/);
        await expect(transferOwnership(tx, { toEmail: heir.email!, reason: 'قصير' })).rejects.toBeInstanceOf(RecoveryRefused);

        const r = await transferOwnership(tx, { toEmail: heir.email!, reason: 'تسليم الإدارة للشريك' });
        expect(r).toEqual({ from: original?.email ?? null, to: heir.email });
        expect((await tx.user.findUniqueOrThrow({ where: { id: heir.id } })).isPlatformOwner).toBe(true);
        expect(await tx.user.count({ where: { isPlatformOwner: true } })).toBe(1);
        if (original) expect((await tx.user.findUniqueOrThrow({ where: { id: original.id } })).isPlatformOwner).toBe(false);
        const audit = await tx.auditLog.findFirstOrThrow({ where: { action: 'admin.ownership_transferred', entityId: heir.id } });
        expect(audit.beforeJson).toEqual({ owner: original?.email ?? null });
        await expect(transferOwnership(tx, { toEmail: heir.email!, reason: 'تسليم الإدارة للشريك' })).rejects.toThrow(/مالك المنصة أصلاً/);
        throw new Rollback();
      })
      .catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(Rollback);

    // لم يُلتزم شيء: المالك الأصلي باقٍ
    expect((await prisma.user.findUniqueOrThrow({ where: { id: heir.id } })).isPlatformOwner).toBe(false);
    if (original) expect((await prisma.user.findUniqueOrThrow({ where: { id: original.id } })).isPlatformOwner).toBe(true);
  });
});
