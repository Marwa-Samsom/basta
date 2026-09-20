/**
 * إثبات بوابة خروج المرحلة 04 على قاعدة بيانات حيّة.
 *
 * الاختبارات الوحدوية تثبت المنطق على مفوّض وهمي. هذه تثبت أن الأمر
 * الواصل إلى PostgreSQL يحمل الفلتر فعلاً — والفرق بينهما هو الفرق بين
 * «المنطق صحيح» و«النظام آمن».
 *
 * تتخطّى نفسها بلا قاعدة بيانات فيبقى npm test عاملاً في كل الأحوال.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../common/errors/domain-error';
import { ScopedRepository } from '../../common/prisma/scoped-repository';
import { vendorScopeOf, type Actor } from '../../common/security/actor';
import { hashPassword, verifyPassword } from './domain/password';
import { generateTotpSecret, verifyTotp, adminNeedsTotpSetup } from './domain/totp';
import { generateOtp, hashOtp, otpExpiryFrom, verifyOtp } from './domain/otp';

const prisma = new PrismaClient();
let dbUp = false;

const SUFFIX = `it${Date.now()}`;
const ids = { userA: '', userB: '', vendorA: '', vendorB: '', productA: '', productB: '' };

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات التكامل متخطّاة.\n');
    return;
  }

  // بائعان حقيقيان لكل منهما منتج — الحالة التي يجب ألّا يخترقها أحد
  const cat = await prisma.category.findFirstOrThrow();

  const mk = async (tag: string) => {
    const user = await prisma.user.create({
      data: {
        email: `${tag}.${SUFFIX}@basta.test`,
        fullName: `بائع ${tag}`,
        passwordHash: await hashPassword('كلمة-مرور-اختبار'),
        roles: { create: { role: 'vendor_owner' } },
      },
    });
    const vendor = await prisma.vendor.create({
      data: {
        ownerUserId: user.id,
        slug: `v-${tag}-${SUFFIX}`,
        nameAr: `متجر ${tag}`,
        status: 'approved',
        // القيد في المخطط: المعتمَد له لحظة اعتماد — تركيبة بلا تاريخ تصف حالة لا توجد
        approvedAt: new Date(),
        settlementCurrency: 'SAR',
        country: 'SA',
      },
    });
    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: cat.id,
        slug: `p-${tag}-${SUFFIX}`,
        nameAr: `منتج ${tag}`,
        status: 'active',
      },
    });
    return { user, vendor, product };
  };

  const a = await mk('a');
  const b = await mk('b');
  ids.userA = a.user.id;
  ids.vendorA = a.vendor.id;
  ids.productA = a.product.id;
  ids.userB = b.user.id;
  ids.vendorB = b.vendor.id;
  ids.productB = b.product.id;
});

afterAll(async () => {
  if (dbUp) {
    await prisma.product.deleteMany({ where: { slug: { contains: SUFFIX } } });
    await prisma.vendor.deleteMany({ where: { slug: { contains: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
  }
  await prisma.$disconnect();
});

const dbIt: typeof it = ((name: string, fn: never) =>
  it(name, async (...args: never[]) => {
    if (!dbUp) return;
    return (fn as (...a: never[]) => unknown)(...args);
  })) as never;

const actorFor = (vendorId: string, userId: string): Actor => ({
  userId,
  roles: ['vendor_owner'],
  vendorId,
  permissions: [],
});

// ============================================================================
describe('ADR-010 على Prisma الحقيقي', () => {
  const repo = (vendorId: string, userId: string) =>
    new ScopedRepository(
      prisma.product as never,
      vendorScopeOf(actorFor(vendorId, userId)),
      'المنتج',
    );

  dbIt('البائع (أ) يرى منتجه ولا يرى منتج (ب)', async () => {
    const r = repo(ids.vendorA, ids.userA);
    await expect(r.findByIdOrFail(ids.productA)).resolves.toBeTruthy();
    await expect(r.findByIdOrFail(ids.productB)).rejects.toBeInstanceOf(NotFoundError);
  });

  dbIt('القائمة لا تحوي إلا منتجات صاحبها', async () => {
    const rows = await repo(ids.vendorA, ids.userA).findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => (p as { vendorId: string }).vendorId === ids.vendorA)).toBe(true);
  });

  dbIt('محاولة تعديل منتج بائع آخر لا تغيّر شيئاً في القاعدة', async () => {
    const before = await prisma.product.findUniqueOrThrow({ where: { id: ids.productB } });

    await expect(
      repo(ids.vendorA, ids.userA).updateOwned(ids.productB, { nameAr: 'مخترَق' }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: ids.productB } });
    expect(after.nameAr).toBe(before.nameAr);
  });

  dbIt('محاولة حذف منتج بائع آخر لا تحذف شيئاً', async () => {
    await expect(
      repo(ids.vendorA, ids.userA).deleteOwned(ids.productB),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await prisma.product.count({ where: { id: ids.productB } })).toBe(1);
  });

  dbIt('حقن vendorId مخالف يُرفض صراحةً لا يُستبدل بصمت', async () => {
    // الاستبدال الصامت كان يعيد بيانات البائع (أ) لطلب يخصّ (ب): يبدو
    // الطلب ناجحاً وهو ليس ما طُلب، فيخفي خطأً برمجياً بقدر ما يحبط اختراقاً
    await expect(
      repo(ids.vendorA, ids.userA).findMany({ where: { vendorId: ids.vendorB } }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  dbIt('تمرير vendorId المطابق مسموح — لا تشدّد بلا سبب', async () => {
    const rows = await repo(ids.vendorA, ids.userA).findMany({
      where: { vendorId: ids.vendorA },
    });
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ============================================================================
describe('كلمات المرور على القاعدة', () => {
  dbIt('التجزئة المخزَّنة لا تحوي النص ولا تُقبل إلا بالأصل', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ids.userA } });
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toContain('كلمة-مرور-اختبار');
    expect(await verifyPassword('كلمة-مرور-اختبار', user.passwordHash!)).toBe(true);
    expect(await verifyPassword('خطأ', user.passwordHash!)).toBe(false);
  });
});

// ============================================================================
describe('التحقق الثنائي', () => {
  dbIt('الإداري بلا 2FA يُعدّ محتاجاً للتهيئة', () => {
    expect(adminNeedsTotpSetup(['admin'], null)).toBe(true);
    expect(adminNeedsTotpSetup(['admin'], new Date())).toBe(false);
    expect(adminNeedsTotpSetup(['customer'], null)).toBe(false);
  });

  dbIt('السرّ المولَّد يقبل رمزه الصحيح ويرفض غيره', async () => {
    const secret = generateTotpSecret();
    const { TOTP, NobleCryptoPlugin, ScureBase32Plugin } = await import('otplib');
    const totp = new TOTP({
      secret,
      period: 30,
      digits: 6,
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin(),
    });
    const token = await totp.generate();

    expect(verifyTotp(token, secret)).toBe(true);
    expect(verifyTotp('000000', secret)).toBe(false);
    expect(verifyTotp('abc', secret)).toBe(false);
    expect(verifyTotp('', secret)).toBe(false);
  });
});

// ============================================================================
describe('رموز التحقق لمرة واحدة', () => {
  const now = new Date('2026-09-12T12:00:00Z');

  dbIt('الرمز المولَّد ستة أرقام ويُقبل مرة واحدة', () => {
    const code = generateOtp();
    expect(code).toMatch(/^\d{6}$/);

    const stored = {
      codeHash: hashOtp(code),
      attempts: 0,
      expiresAt: otpExpiryFrom(now),
      consumedAt: null,
    };
    expect(verifyOtp(stored, code, now).kind).toBe('valid');
    expect(verifyOtp({ ...stored, consumedAt: now }, code, now).kind).toBe('already_used');
  });

  dbIt('الرمز الخاطئ ينقص المحاولات، والخامسة تستنفدها', () => {
    const stored = {
      codeHash: hashOtp('111111'),
      attempts: 0,
      expiresAt: otpExpiryFrom(now),
      consumedAt: null,
    };
    const wrong = verifyOtp(stored, '222222', now);
    expect(wrong.kind).toBe('wrong');
    expect(wrong.kind === 'wrong' && wrong.attemptsLeft).toBe(4);

    expect(verifyOtp({ ...stored, attempts: 5 }, '111111', now).kind).toBe('exhausted');
  });

  dbIt('الرمز المنتهي يُرفض ولو كان صحيحاً', () => {
    const stored = {
      codeHash: hashOtp('111111'),
      attempts: 0,
      expiresAt: new Date(now.getTime() - 1),
      consumedAt: null,
    };
    expect(verifyOtp(stored, '111111', now).kind).toBe('expired');
  });
});

// ============================================================================
describe('سجل التدقيق محميّ على القاعدة', () => {
  dbIt('لا يقبل تعديلاً ولا حذفاً ولو من مسار التطبيق', async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "audit_logs" SET "action" = 'tampered'`),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "audit_logs"`),
    ).rejects.toThrow();
  });
});
