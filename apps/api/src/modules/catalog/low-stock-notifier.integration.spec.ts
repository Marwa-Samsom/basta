/**
 * تنبيه البائع بنفاد المخزون (SRS V-04) على PostgreSQL حيّ.
 *
 * ما يُثبَت: النزول إلى العتبة يصير تنبيهاً واحداً لبائعه يجمع متغيّراته؛
 * الجولة الثانية لا تكرّره؛ التعبئة ثم النزول ثانيةً تنبّه من جديد؛ المسوّدة
 * لا تنبّه؛ وجولتان متزامنتان على نزول واحد تُدرجان تنبيهاً واحداً — الحجز
 * الشرطيّ هو الحارس، ونزعه يجب أن يُسقط الاختبار الأخير (اختبار طفرة).
 *
 * قاعدة التطوير مشتركة مع ملفات تعمل بالتوازي: الأعداد تُقرأ لبائع الاختبار
 * وحده، لا من عائد الجولة.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { hashPassword } from '../identity/public';
import { InventoryService } from '../inventory/public';
import { NotificationsService } from '../notifications/public';
import { LowStockNotifier } from './application/low-stock-notifier';

const SUFFIX = `lsn${Date.now()}`;
const prisma = new PrismaClient();
// اتصال ثانٍ مستقل: الجولتان المتزامنتان تتسابقان فعلاً في القاعدة
const racer = new PrismaClient();

const make = (db: PrismaClient) => {
  const p = db as unknown as PrismaService;
  const inventory = new InventoryService(p);
  return { inventory, notifier: new LowStockNotifier(p, inventory, new NotificationsService(p)) };
};
const a = make(prisma);

/**
 * حاجز السباق: كل جولة تقرأ المعلَّق ثم تنتظر حتى تقرأه الأخرى، فتصلان
 * الحجز معاً بالصفوف نفسها. بلا الحاجز تنتهي الأولى قبل أن تبدأ الثانية
 * غالباً — فيمرّ الاختبار والحارس منزوع (هكذا كُشف أوّل مرة).
 */
function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  return () => {
    if (++arrived >= parties) open();
    return gate;
  };
}

function racing(db: PrismaClient, wait: () => Promise<void>) {
  const p = db as unknown as PrismaService;
  const inventory = new (class extends InventoryService {
    override async pendingLowStock(limit?: number) {
      const rows = await super.pendingLowStock(limit);
      await wait();
      return rows;
    }
  })(p);
  return new LowStockNotifier(p, inventory, new NotificationsService(p));
}

let dbUp = false;
const created = { vendorId: '', userId: '', productIds: [] as string[], variantIds: [] as string[] };
const ctx = { reason: 'manual_adjust' as const };

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات تنبيه النفاد متخطّاة.\n');
    return;
  }
  await new NotificationsService(prisma as unknown as PrismaService).ensureDefaults();
  const user = await prisma.user.create({
    data: {
      email: `lowstock.${SUFFIX}@basta.test`,
      fullName: 'بائع اختبار النفاد',
      passwordHash: await hashPassword('كلمة-مرور-اختبار'),
      roles: { create: { role: 'vendor_owner' } },
    },
  });
  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: user.id,
      slug: `v-${SUFFIX}`,
      nameAr: 'متجر اختبار النفاد',
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
    const now = new Date();
    await prisma.productVariant.updateMany({
      where: { id: { in: created.variantIds } },
      data: { archivedAt: now, isActive: false },
    });
    await prisma.product.updateMany({
      where: { id: { in: created.productIds } },
      data: { deletedAt: now, status: 'archived' },
    });
    // تنبيهات بائع الاختبار لا تُرسل — الصندوق الصادر لا يمتلئ بها
    await prisma.notification.updateMany({
      where: { userId: created.userId, status: 'queued' },
      data: { status: 'skipped' },
    });
  }
  await Promise.all([prisma.$disconnect(), racer.$disconnect()]);
});

const dbIt: typeof it = ((name: string, fn: never, timeout?: number) =>
  it(
    name,
    async (...args: never[]) => {
      if (!dbUp) return;
      return (fn as (...x: never[]) => unknown)(...args);
    },
    timeout,
  )) as never;

/** منتج بمتغيّرات ومخزونها فوق العتبة — منشور أو مسوّدة */
async function product(label: string, stock: number[], status: 'active' | 'draft' = 'active'): Promise<string[]> {
  const productId = randomUUID();
  const variantIds = stock.map(() => randomUUID());
  await prisma.$transaction(async (tx) => {
    await tx.product.create({
      data: {
        id: productId,
        vendorId: created.vendorId,
        slug: `p-${label}-${SUFFIX}-${productId.slice(0, 6)}`,
        nameAr: `منتج ${label}`,
        status,
        ...(status === 'active' ? { publishedAt: new Date() } : {}),
      },
    });
    await tx.productVariant.createMany({
      data: variantIds.map((id, i) => ({
        id,
        productId,
        vendorId: created.vendorId,
        sku: `${label}-${i}-${productId.slice(0, 6)}`.toUpperCase(),
        optionsKey: `k${i}`,
        priceMinorUnits: 1000n,
      })),
    });
    await a.inventory.initialize(
      tx,
      variantIds.map((variantId, i) => ({ variantId, onHand: stock[i]!, lowStockThreshold: 3 })),
      { reason: 'import' },
    );
  });
  created.productIds.push(productId);
  created.variantIds.push(...variantIds);
  return variantIds;
}

/** يفرغ المعلَّق كله — ملفات تعمل بالتوازي قد تسبق صفوفنا في الترتيب */
async function drain(): Promise<void> {
  for (let i = 0; i < 20 && (await a.inventory.pendingLowStock()).length > 0; i++) await a.notifier.run();
}

const inbox = (channel = 'in_app') =>
  prisma.notification.findMany({
    where: { userId: created.userId, templateCode: 'low_stock', channel },
    orderBy: { createdAt: 'asc' },
  });

describe('تنبيه نفاد المخزون', () => {
  dbIt('النزول إلى العتبة ينبّه البائع مرة واحدة ويجمع متغيّراته', async () => {
    const [v1, v2] = await product('grp', [10, 10]);
    const before = (await inbox()).length;

    await a.inventory.adjust({ variantId: v1!, change: { setTo: 2 } }, ctx);
    await a.inventory.adjust({ variantId: v2!, change: { setTo: 0 } }, ctx);
    await drain();

    const after = await inbox();
    expect(after.length - before).toBe(1);
    // النص يُصيَّر عند الإرسال؛ ما أُدرج هو المتغيّرات
    const { items } = after.at(-1)!.payloadJson as { items: string };
    expect(items).toContain('بقي 2');
    expect(items).toContain('نفد');
    // والبريد معه — قناتا القالب كلتاهما
    expect((await inbox('email')).length).toBeGreaterThan(0);

    await drain();
    expect((await inbox()).length).toBe(after.length);
  });

  dbIt('التعبئة ثم النزول ثانيةً تنبّه من جديد', async () => {
    const [v] = await product('again', [10]);
    await a.inventory.adjust({ variantId: v!, change: { setTo: 1 } }, ctx);
    await drain();
    const first = (await inbox()).length;

    await a.inventory.adjust({ variantId: v!, change: { setTo: 20 } }, ctx);
    await drain();
    expect((await inbox()).length).toBe(first);

    await a.inventory.adjust({ variantId: v!, change: { setTo: 0 } }, ctx);
    await drain();
    expect((await inbox()).length).toBe(first + 1);
  });

  dbIt('المسوّدة لا تنبّه ولا تبقى معلَّقة', async () => {
    const before = (await inbox()).length;
    const [v] = await product('draft', [0], 'draft');
    await drain();
    expect((await inbox()).length).toBe(before);
    const pending = await a.inventory.pendingLowStock(10_000);
    expect(pending.some((p) => p.variantId === v)).toBe(false);
  });

  dbIt('جولتان متزامنتان على نزول واحد تُدرجان تنبيهاً واحداً', async () => {
    const [v] = await product('race', [10]);
    await drain();
    const before = (await inbox()).length;

    await a.inventory.adjust({ variantId: v!, change: { setTo: 1 } }, ctx);
    const wait = barrier(2);
    await Promise.all([racing(prisma, wait).run(), racing(racer, wait).run()]);
    await drain();

    expect((await inbox()).length - before).toBe(1);
  });
});
