/**
 * إثبات بوابة خروج المرحلة 04.
 *
 * كل اختبار هنا يحاول الخرق ويتوقّع الرفض. اختبار يفترض الحماية
 * لا يثبت شيئاً — هذا ما علّمته ثغرة TRUNCATE في المرحلة 03.
 */
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../common/errors/domain-error';
import { ScopedRepository, type ScopedDelegate } from '../../common/prisma/scoped-repository';
import {
  type Actor,
  ForbiddenActorError,
  hasPermission,
  isAdmin,
  isVendor,
  vendorScopeOf,
} from '../../common/security/actor';
import {
  assertPasswordStrength,
  hashPassword,
  verifyPassword,
  WeakPasswordError,
} from './domain/password';
import { decideRotation, type StoredToken } from './domain/token-family';

// ---------- فاعلون للاختبار ----------
const VENDOR_A = 'vendor-aaa';
const VENDOR_B = 'vendor-bbb';

const vendorA: Actor = {
  userId: 'u-a',
  roles: ['vendor_owner'],
  vendorId: VENDOR_A,
  permissions: [],
};
const vendorB: Actor = {
  userId: 'u-b',
  roles: ['vendor_owner'],
  vendorId: VENDOR_B,
  permissions: [],
};
const customer: Actor = { userId: 'u-c', roles: ['customer'], permissions: [] };
const admin: Actor = {
  userId: 'u-admin',
  roles: ['admin'],
  permissions: ['vendors.approve', 'payouts.approve'],
};

// ---------- مفوّض وهمي يسجّل الشروط التي وصلته فعلاً ----------
function fakeDelegate(rows: Array<{ id: string; vendorId: string }>) {
  const seen: Array<Record<string, unknown>> = [];
  const match = (where: Record<string, unknown>) =>
    rows.filter((r) =>
      Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
    );

  const delegate: ScopedDelegate<{ id: string; vendorId: string }> = {
    async findFirst({ where }) {
      seen.push(where);
      return match(where)[0] ?? null;
    },
    async findMany({ where }) {
      seen.push(where);
      return match(where);
    },
    async count({ where }) {
      seen.push(where);
      return match(where).length;
    },
    async updateMany({ where }) {
      seen.push(where);
      return { count: match(where).length };
    },
    async deleteMany({ where }) {
      seen.push(where);
      return { count: match(where).length };
    },
  };
  return { delegate, seen };
}

// ============================================================================
describe('ADR-010 · عزل بيانات البائع', () => {
  const rows = [
    { id: 'p1', vendorId: VENDOR_A },
    { id: 'p2', vendorId: VENDOR_A },
    { id: 'p9', vendorId: VENDOR_B },
  ];

  it('البائع (أ) يتلقّى 404 عند طلب مورد يخصّ البائع (ب)', async () => {
    const { delegate } = fakeDelegate(rows);
    const repo = new ScopedRepository(delegate, vendorScopeOf(vendorA), 'المنتج');

    await expect(repo.findByIdOrFail('p9')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('الرد نفسه لمعرّف غير موجود ولمعرّف يخصّ بائعاً آخر', async () => {
    const { delegate } = fakeDelegate(rows);
    const repo = new ScopedRepository(delegate, vendorScopeOf(vendorA), 'المنتج');

    const a = await repo.findByIdOrFail('p9').catch((e: NotFoundError) => e);
    const b = await repo.findByIdOrFail('لا-وجود-له').catch((e: NotFoundError) => e);

    // تطابق الرمز والرسالة: لا يستنتج المهاجم وجود المورد من الفرق
    expect((a as NotFoundError).code).toBe((b as NotFoundError).code);
    expect((a as NotFoundError).message).toBe((b as NotFoundError).message);
  });

  it('التعديل والحذف على مورد بائع آخر يفشلان بـ 404', async () => {
    const { delegate } = fakeDelegate(rows);
    const repo = new ScopedRepository(delegate, vendorScopeOf(vendorA), 'المنتج');

    await expect(repo.updateOwned('p9', { nameAr: 'مخترَق' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.deleteOwned('p9')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('القائمة لا تسرّب صفوف بائع آخر', async () => {
    const { delegate } = fakeDelegate(rows);
    const repo = new ScopedRepository(delegate, vendorScopeOf(vendorA), 'المنتج');

    const found = await repo.findMany();
    expect(found).toHaveLength(2);
    expect(found.every((r) => r.vendorId === VENDOR_A)).toBe(true);
  });

  it('فلتر المالك يصل إلى طبقة البيانات في كل عملية بلا استثناء', async () => {
    const { delegate, seen } = fakeDelegate(rows);
    const repo = new ScopedRepository(delegate, vendorScopeOf(vendorA), 'المنتج');

    await repo.findMany();
    await repo.findFirst({ where: { id: 'p1' } });
    await repo.count();
    await repo.updateOwned('p1', {});
    await repo.deleteOwned('p2');

    expect(seen).toHaveLength(5);
    // هذا هو جوهر ADR-010: الشرط يُحقن في المستودع لا في المتحكّم
    expect(seen.every((w) => w['vendorId'] === VENDOR_A)).toBe(true);
  });

  it('شرط المستدعي لا يستطيع إلغاء فلتر المالك', async () => {
    const { delegate, seen } = fakeDelegate(rows);
    const repo = new ScopedRepository(delegate, vendorScopeOf(vendorA), 'المنتج');

    // محاولة صريحة لانتحال بائع آخر عبر الشرط
    await repo.findMany({ where: { vendorId: VENDOR_B } });

    expect(seen[0]?.['vendorId']).toBe(VENDOR_A);
  });
});

// ============================================================================
describe('تركيب نطاق البائع', () => {
  it('البائع لا يحصل إلا على نطاق متجره', () => {
    expect(vendorScopeOf(vendorA).vendorId).toBe(VENDOR_A);
  });

  it('طلب البائع نطاقَ متجر آخر مرفوض', () => {
    expect(() => vendorScopeOf(vendorA, VENDOR_B)).toThrow(ForbiddenActorError);
  });

  it('العميل لا يحصل على نطاق بائع إطلاقاً', () => {
    expect(() => vendorScopeOf(customer)).toThrow(ForbiddenActorError);
    expect(() => vendorScopeOf(customer, VENDOR_A)).toThrow(ForbiddenActorError);
  });

  it('الإدارة تحصل على أي نطاق صراحةً — تجاوز مقصود لمراجعة النزاعات', () => {
    expect(vendorScopeOf(admin, VENDOR_B).vendorId).toBe(VENDOR_B);
  });

  it('الإدارة بلا نطاق محدَّد تُرفض — لا افتراض ضمنيّ', () => {
    expect(() => vendorScopeOf(admin)).toThrow(ForbiddenActorError);
  });
});

// ============================================================================
describe('الأدوار والصلاحيات', () => {
  it('العميل لا يملك أي صلاحية إدارية', () => {
    expect(isAdmin(customer)).toBe(false);
    expect(hasPermission(customer, 'payouts.approve')).toBe(false);
  });

  it('البائع ليس إدارياً ولو حمل صلاحية بالاسم', () => {
    const sneaky: Actor = { ...vendorA, permissions: ['payouts.approve'] };
    expect(hasPermission(sneaky, 'payouts.approve')).toBe(false);
  });

  it('الإداري يملك ما مُنح فقط', () => {
    expect(hasPermission(admin, 'payouts.approve')).toBe(true);
    expect(hasPermission(admin, 'commissions.edit')).toBe(false);
  });

  it('موظّف البائع يُعامل كبائع', () => {
    const staff: Actor = { userId: 'u-s', roles: ['vendor_staff'], vendorId: VENDOR_A, permissions: [] };
    expect(isVendor(staff)).toBe(true);
    expect(vendorScopeOf(staff).vendorId).toBe(VENDOR_A);
  });
});

// ============================================================================
describe('كلمات المرور', () => {
  it('يرفض ما دون ثمانية محارف', () => {
    expect(() => assertPasswordStrength('1234567')).toThrow(WeakPasswordError);
    expect(() => assertPasswordStrength('12345678')).not.toThrow();
  });

  it('يرفض المدخل الطويل جداً — منع استنزاف الذاكرة بطلب واحد', () => {
    expect(() => assertPasswordStrength('a'.repeat(2000))).toThrow(WeakPasswordError);
  });

  it('التجزئة لا تكشف كلمة المرور ولا تتكرّر لنفس المدخل', async () => {
    const plain = 'كلمة-مرور-قوية-جداً';
    const h1 = await hashPassword(plain);
    const h2 = await hashPassword(plain);

    expect(h1).not.toContain(plain);
    expect(h1).not.toBe(h2); // ملح مختلف لكل تجزئة
    expect(h1.startsWith('$argon2id$')).toBe(true);
  });

  it('التحقق يقبل الصحيح ويرفض الخطأ', async () => {
    const h = await hashPassword('كلمة-مرور-قوية-جداً');
    expect(await verifyPassword('كلمة-مرور-قوية-جداً', h)).toBe(true);
    expect(await verifyPassword('كلمة-مرور-خاطئة', h)).toBe(false);
  });

  it('التجزئة التالفة تعني رفض الدخول لا خطأً داخلياً', async () => {
    expect(await verifyPassword('أي-شيء', 'ليست-تجزئة')).toBe(false);
    expect(await verifyPassword('أي-شيء', '')).toBe(false);
  });
});

// ============================================================================
describe('تدوير رموز التحديث', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  const base: StoredToken = {
    id: 't1',
    familyId: 'f1',
    tokenHash: 'h',
    expiresAt: new Date('2026-10-12T12:00:00Z'),
    revokedAt: null,
    replacedById: null,
  };

  it('الرمز الصالح يُدوَّر', () => {
    const out = decideRotation(base, now);
    expect(out.kind).toBe('rotate');
  });

  it('الرمز المجهول يُرفض', () => {
    expect(decideRotation(null, now).kind).toBe('invalid');
  });

  it('الرمز المنتهي يُرفض', () => {
    const expired = { ...base, expiresAt: new Date('2026-09-01T00:00:00Z') };
    expect(decideRotation(expired, now).kind).toBe('expired');
  });

  it('إعادة استعمال رمز مُبطَل تُكتشف وتُبطل العائلة', () => {
    const revoked = { ...base, revokedAt: new Date('2026-09-11T00:00:00Z') };
    const out = decideRotation(revoked, now);
    expect(out.kind).toBe('reuse_detected');
    expect(out.kind === 'reuse_detected' && out.familyId).toBe('f1');
  });

  /**
   * الحالة التي تكشف ترتيب الفحوص: رمز مُبطَل ومنتهٍ معاً.
   * لو فُحص الانتهاء أولاً لمرّ كـ«منتهٍ» عادي وضاع دليل السرقة.
   */
  it('الرمز المُبطَل والمنتهي معاً يُعامَل كسرقة لا كانتهاء', () => {
    const both = {
      ...base,
      revokedAt: new Date('2026-09-11T00:00:00Z'),
      expiresAt: new Date('2026-09-01T00:00:00Z'),
    };
    expect(decideRotation(both, now).kind).toBe('reuse_detected');
  });

  it('الرمز المنتهي في هذه اللحظة بالضبط يُرفض', () => {
    const exact = { ...base, expiresAt: now };
    expect(decideRotation(exact, now).kind).toBe('expired');
  });
});
