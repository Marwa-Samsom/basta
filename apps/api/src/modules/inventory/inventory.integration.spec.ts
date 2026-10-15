/**
 * إثبات بوابة خروج المرحلة 05 — البند الثاني — على PostgreSQL حيّ:
 * «طلبان متزامنان على آخر قطعة: واحد ينجح والثاني يُرفض بوضوح — لا مخزون سالب».
 *
 * اختبار تزامن يُشغَّل على مفوّض وهمي لا يثبت شيئاً: القفل يعيش في القاعدة.
 * هنا اتصالات حقيقية متوازية تتسابق على الصف نفسه.
 *
 * البيانات لا تُحذف بعد الاختبار: حركات المخزون للإضافة فقط (ADR-005)،
 * والمتغيّر ذو التاريخ مقيَّد بـ RESTRICT. تُحرَّر الحجوزات وتُؤرشف المنتجات،
 * و npm run verify يبني القاعدة من الصفر قبل كل تشغيل كامل.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DomainError,
  InsufficientStockError,
  ReservationExpiredError,
} from '../../common/errors/domain-error';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { hashPassword } from '../identity/public';
import { InventoryService } from './application/inventory.service';
import { StockBelowReservedError } from './domain/stock';

const SUFFIX = `inv${Date.now()}`;
/** اسم اتصالات المتسابقين — بها نعدّهم في pg_stat_activity دون خلطهم بملفات اختبار تعمل بالتوازي */
const RACERS = `basta-race-${SUFFIX}`;

const prisma = new PrismaClient();
// تجمّع يتّسع للمتسابقين كلهم — التجمّع الافتراضي يسلسل الطلبات فيخفي السباق
const racers = new PrismaClient({
  datasources: {
    db: {
      url: withParams(process.env['DATABASE_URL'] ?? '', {
        connection_limit: '40',
        application_name: RACERS,
      }),
    },
  },
});
const inventory = new InventoryService(racers as unknown as PrismaService);

let dbUp = false;
const created = { vendorId: '', userId: '', productIds: [] as string[], variantIds: [] as string[] };

function withParams(url: string, params: Record<string, string>): string {
  if (!url) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, value);
  return u.toString();
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات تزامن المخزون متخطّاة.\n');
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: `stock.${SUFFIX}@basta.test`,
      fullName: 'بائع اختبار المخزون',
      passwordHash: await hashPassword('كلمة-مرور-اختبار'),
      roles: { create: { role: 'vendor_owner' } },
    },
  });
  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: user.id,
      slug: `v-${SUFFIX}`,
      nameAr: 'متجر اختبار المخزون',
      status: 'approved',
      approvedAt: new Date(),
      settlementCurrency: 'SAR',
      country: 'SA',
    },
  });
  created.userId = user.id;
  created.vendorId = vendor.id;
});

afterAll(async () => {
  if (dbUp && created.variantIds.length > 0) {
    const active = await prisma.stockReservation.findMany({
      where: { variantId: { in: created.variantIds }, status: 'active' },
      select: { id: true },
    });
    await inventory.release(active.map((r) => r.id));
    const now = new Date();
    await prisma.productVariant.updateMany({
      where: { id: { in: created.variantIds } },
      data: { archivedAt: now, isActive: false },
    });
    await prisma.product.updateMany({
      where: { id: { in: created.productIds } },
      data: { deletedAt: now, status: 'archived' },
    });
  }
  await Promise.all([prisma.$disconnect(), racers.$disconnect()]);
});

const dbIt: typeof it = ((name: string, fn: never, timeout?: number) =>
  it(
    name,
    async (...args: never[]) => {
      if (!dbUp) return;
      return (fn as (...a: never[]) => unknown)(...args);
    },
    timeout,
  )) as never;

/** منتج بمتغيّرات جديدة ومخزونها الابتدائي — عبر الخدمة نفسها التي يستعملها الكتالوج */
async function stocked(label: string, quantities: number[], threshold = 0): Promise<string[]> {
  const productId = randomUUID();
  const variantIds = quantities.map(() => randomUUID());

  await prisma.$transaction(async (tx) => {
    await tx.product.create({
      data: {
        id: productId,
        vendorId: created.vendorId,
        slug: `p-${label}-${SUFFIX}-${productId.slice(0, 6)}`,
        nameAr: label,
      },
    });
    await tx.productVariant.createMany({
      data: variantIds.map((id, i) => ({
        id,
        productId,
        vendorId: created.vendorId,
        sku: `${label}-${i}-${productId.slice(0, 8)}`,
        optionsKey: `k${i}`,
        priceMinorUnits: 1000n,
      })),
    });
    await inventory.initialize(
      tx,
      variantIds.map((variantId, i) => ({ variantId, onHand: quantities[i] ?? 0, lowStockThreshold: threshold })),
      { reason: 'manual_adjust', actorUserId: created.userId, note: 'اختبار' },
    );
  });

  created.productIds.push(productId);
  created.variantIds.push(...variantIds);
  return variantIds;
}

async function level(variantId: string) {
  return prisma.inventory.findUniqueOrThrow({ where: { variantId } });
}

/** الثابتان اللذان تحرسهما views التدقيق الليلي — INV-04 و INV-11 */
async function expectNoDrift(variantIds: readonly string[]): Promise<void> {
  const inventoryDrift = await prisma.$queryRaw<unknown[]>`
    SELECT * FROM "audit_inventory_drift" WHERE "variantId" = ANY(${[...variantIds]}::uuid[])`;
  const reservationDrift = await prisma.$queryRaw<unknown[]>`
    SELECT * FROM "audit_reservation_drift" WHERE "variantId" = ANY(${[...variantIds]}::uuid[])`;
  expect(inventoryDrift).toEqual([]);
  expect(reservationDrift).toEqual([]);
}

/**
 * يصنع السباق فعلاً بدل انتظار أن يقع صدفة.
 *
 * النسخة الأولى من اختبار «آخر قطعة» نجحت والقفل منزوع (اختبار الطفرة):
 * الطلب الأول كان يكتمل قبل أن يبدأ الثاني، فبدا الرفض صحيحاً وهو توقيت لا قفل.
 * الدرس 5 بعينه — حارس يُطمئن ولا يحمي.
 *
 * هنا اتصال ثالث يمسك الصف، ويُطلَق المتسابقون، ولا يُفلت الصف حتى يُرى كلٌّ
 * منهم واقفاً على قفل في pg_stat_activity. بالقفل يقفون عند SELECT … FOR UPDATE
 * فيُفصل بينهم بالتسلسل؛ وبلاه يقرؤون قيماً قديمة ويقفون عند UPDATE، فيخرق
 * الثاني قيد القاعدة ويفشل الاختبار كما يجب.
 */
async function race<T>(
  variantId: string,
  contenders: readonly (() => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });

  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "inventory" WHERE "variantId" = ${variantId}::uuid FOR UPDATE`;
      markHeld();
      await released;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );

  await held;
  const settled = Promise.allSettled(contenders.map((start) => start()));
  try {
    await waitForLockWaiters(contenders.length);
  } finally {
    release();
    await holder;
  }
  return settled;
}

async function waitForLockWaiters(expected: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  let waiting = 0;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE application_name = ${RACERS} AND wait_event_type = 'Lock'`;
    waiting = rows[0]?.n ?? 0;
    if (waiting >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `بلغ ${waiting} من ${expected} متسابقين نقطة الانتظار — السباق لم يُصنع، والنتيجة لا تثبت شيئاً.`,
  );
}

// ============================================================================
describe('بوابة 05 · آخر قطعة', () => {
  dbIt('طلبان متزامنان على آخر قطعة: واحد ينجح والثاني يُرفض برسالة تسمّي المنتج', async () => {
    const [variantId] = await stocked('قميص-آخر-قطعة', [1]);
    const id = variantId as string;

    const results = await race(id, [
      () => inventory.reserve({ lines: [{ variantId: id, qty: 1, label: 'قميص قطني' }] }),
      () => inventory.reserve({ lines: [{ variantId: id, qty: 1, label: 'قميص قطني' }] }),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    const error = lost[0]?.reason as DomainError;
    expect(error).toBeInstanceOf(InsufficientStockError);
    expect(error.httpStatus).toBe(409);
    expect(error.message).toContain('«قميص قطني»');

    const row = await level(id);
    expect(row).toMatchObject({ onHand: 1, reserved: 1 });
    await expectNoDrift([id]);
  });

  dbIt('25 طلباً متزامناً على 10 قطع: عشرة تنجح بالضبط، ولا مخزون سالب', async () => {
    const [variantId] = await stocked('سباق-عشرة', [10]);
    const id = variantId as string;

    const results = await race(
      id,
      Array.from(
        { length: 25 },
        () => () => inventory.reserve({ lines: [{ variantId: id, qty: 1, label: 'سباق' }] }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(failures).toHaveLength(15);
    // كل فشل رفض مجال واضح — لا انقطاع اتصال ولا تعطّل متبادل يُحسب «رفضاً»
    expect(failures.every((f) => f.reason instanceof InsufficientStockError)).toBe(true);

    const row = await level(id);
    expect(row).toMatchObject({ onHand: 10, reserved: 10 });
    await expectNoDrift([id]);
  }, 30_000);

  dbIt('سلّتان تقفلان متغيّرين بترتيبين متعاكسين لا تتعطّلان تبادلياً', async () => {
    const [x, y] = (await stocked('ترتيب-القفل', [50, 50])) as [string, string];

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        inventory.reserve({
          lines:
            i % 2 === 0
              ? [
                  { variantId: x, qty: 1, label: 'س' },
                  { variantId: y, qty: 1, label: 'ص' },
                ]
              : [
                  { variantId: y, qty: 1, label: 'ص' },
                  { variantId: x, qty: 1, label: 'س' },
                ],
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect((await level(x)).reserved).toBe(20);
    expect((await level(y)).reserved).toBe(20);
    await expectNoDrift([x, y]);
  }, 30_000);

  dbIt('سطر ناقص واحد يُسقط حجز السلّة كلها — لا نصف حجز', async () => {
    const [plenty, scarce] = (await stocked('كل-أو-لا-شيء', [5, 1])) as [string, string];

    await expect(
      inventory.reserve({
        lines: [
          { variantId: plenty, qty: 2, label: 'متوفّر' },
          { variantId: scarce, qty: 2, label: 'شحيح' },
        ],
      }),
    ).rejects.toThrow('«شحيح»');

    expect((await level(plenty)).reserved).toBe(0);
    expect(await prisma.stockReservation.count({ where: { variantId: { in: [plenty, scarce] } } })).toBe(0);
  });
});

// ============================================================================
describe('دورة حياة الحجز — ADR-006', () => {
  dbIt('التثبيت يُنقص onHand و reserved معاً ويكتب حركة sale، ولا يُثبَّت مرتين', async () => {
    const [variantId] = await stocked('تثبيت', [5]);
    const id = variantId as string;
    const orderId = randomUUID();

    const { reservations } = await inventory.reserve({ lines: [{ variantId: id, qty: 3, label: 'تثبيت' }] });
    const ids = reservations.map((r) => r.id);
    await expect(inventory.commit(ids, { orderId })).resolves.toBe(1);

    expect(await level(id)).toMatchObject({ onHand: 2, reserved: 0 });
    const sale = await prisma.inventoryMovement.findFirstOrThrow({ where: { variantId: id, reason: 'sale' } });
    expect(sale).toMatchObject({ delta: -3, refType: 'order', refId: orderId });

    await expect(inventory.commit(ids, { orderId })).rejects.toBeInstanceOf(ReservationExpiredError);
    expect(await level(id)).toMatchObject({ onHand: 2, reserved: 0 });
    await expectNoDrift([id]);
  });

  dbIt('التحرير عديم الأثر عند التكرار', async () => {
    const [variantId] = await stocked('تحرير', [4]);
    const id = variantId as string;
    const { reservations } = await inventory.reserve({ lines: [{ variantId: id, qty: 2, label: 'تحرير' }] });
    const ids = reservations.map((r) => r.id);

    await expect(inventory.release(ids)).resolves.toBe(1);
    await expect(inventory.release(ids)).resolves.toBe(0);
    expect(await level(id)).toMatchObject({ onHand: 4, reserved: 0 });
    await expectNoDrift([id]);
  });

  dbIt('مهمة الانتهاء تحرّر المنتهي وحده، وتشغيلها مرتين لا يُنقص مرتين', async () => {
    const [variantId] = await stocked('انتهاء', [6]);
    const id = variantId as string;
    const past = new Date(Date.now() - 60 * 60_000);

    const stale = await inventory.reserve({ lines: [{ variantId: id, qty: 2, label: 'قديم' }], now: past });
    const fresh = await inventory.reserve({ lines: [{ variantId: id, qty: 1, label: 'حديث' }] });
    expect((await level(id)).reserved).toBe(3);

    const now = new Date();
    await inventory.expireDue(now);
    await Promise.all([inventory.expireDue(now), inventory.expireDue(now)]);

    const staleRow = await prisma.stockReservation.findUniqueOrThrow({ where: { id: stale.reservations[0]?.id ?? '' } });
    const freshRow = await prisma.stockReservation.findUniqueOrThrow({ where: { id: fresh.reservations[0]?.id ?? '' } });
    expect(staleRow.status).toBe('expired');
    expect(freshRow.status).toBe('active');
    expect(await level(id)).toMatchObject({ onHand: 6, reserved: 1 });
    await expectNoDrift([id]);
  });
});

// ============================================================================
describe('التعديل اليدوي تحت التزامن', () => {
  dbIt('خفض المخزون تحت المحجوز مرفوض بسببه', async () => {
    const [variantId] = await stocked('تحت-المحجوز', [5]);
    const id = variantId as string;
    await inventory.reserve({ lines: [{ variantId: id, qty: 3, label: 'محجوز' }] });

    await expect(
      inventory.adjust({ variantId: id, change: { setTo: 2 } }, { reason: 'manual_adjust' }),
    ).rejects.toBeInstanceOf(StockBelowReservedError);
    expect(await level(id)).toMatchObject({ onHand: 5, reserved: 3 });
  });

  dbIt('جرد إلى الصفر يتسابق مع حجز آخر قطعة: أحدهما يُرفض والثوابت تصمد', async () => {
    const [variantId] = await stocked('جرد-وحجز', [1]);
    const id = variantId as string;

    const outcomes = await race<unknown>(id, [
      () => inventory.adjust({ variantId: id, change: { setTo: 0 } }, { reason: 'damage' }),
      () => inventory.reserve({ lines: [{ variantId: id, qty: 1, label: 'آخر قطعة' }] }),
    ]);

    // لا يمكن أن ينجحا معاً: الحجز الناجح يمنع الجرد، والجرد الناجح يترك حجزاً بلا مخزون
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    // والخاسر يُرفض بقاعدة مجال تشرح السبب — لا بقيد قاعدة بيانات يصل للمستخدم خطأ 500
    const loser = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(loser?.reason).toBeInstanceOf(DomainError);
    const row = await level(id);
    expect(row.reserved).toBeLessThanOrEqual(row.onHand);
    expect(row.onHand).toBeGreaterThanOrEqual(0);
    await expectNoDrift([id]);
  });

  dbIt('قيد القاعدة حزام أخير: reserved فوق onHand مرفوض ولو تجاوز الكود', async () => {
    const [variantId] = await stocked('قيد-القاعدة', [2]);
    await expect(
      prisma.$executeRaw`UPDATE "inventory" SET "reserved" = "onHand" + 1 WHERE "variantId" = ${variantId}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE "inventory" SET "onHand" = -1 WHERE "variantId" = ${variantId}::uuid`,
    ).rejects.toThrow();
  });

  dbIt('العتبة تُرصد عند النزول وتُمسح عند التجديد — مصدر تنبيه البائع', async () => {
    const [variantId] = await stocked('عتبة', [10], 3);
    const id = variantId as string;
    expect((await level(id)).lowStockSince).toBeNull();

    await inventory.adjust({ variantId: id, change: { delta: -7 } }, { reason: 'damage' });
    const low = await level(id);
    expect(low.onHand).toBe(3);
    expect(low.lowStockSince).not.toBeNull();
    expect((await inventory.lowStock([id])).map((l) => l.variantId)).toEqual([id]);

    await inventory.adjust({ variantId: id, change: { setTo: 20 } }, { reason: 'manual_adjust' });
    expect((await level(id)).lowStockSince).toBeNull();
    await expectNoDrift([id]);
  });
});
