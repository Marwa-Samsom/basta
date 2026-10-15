/**
 * إثبات بوابة خروج المرحلة 03.
 *
 * الحرّاس في migration.sql ليسوا نيّة حسنة — هذه الاختبارات تحاول خرقها فعلياً
 * وتتوقّع أن تُرفض. اختبار لا يحاول الخرق لا يثبت شيئاً.
 *
 * يتخطّى نفسه بلا قاعدة بيانات، فيبقى `npm test` عاملاً قبل تشغيل Docker وبعده.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { privilegeReport, privilegeViolations } from './least-privilege';
import { PrismaService } from './prisma.service';

/** مستخدم التشغيل — ما يتصل به التطبيق */
const prisma = new PrismaClient();
/**
 * مالك المخطط: طبقة المشغّلات تُختبر به، لأن مستخدم التشغيل يُرفض قبلها
 * بالصلاحيات — والحارس يجب أن يصمد ولو سقطت الطبقة الأخرى.
 */
const ownerUrl = process.env['DATABASE_MIGRATE_URL'];
const owner = ownerUrl ? new PrismaClient({ datasourceUrl: ownerUrl }) : prisma;
const TRIGGER = /للإضافة فقط/;
const DENIED = /permission denied|42501/i;
let dbUp = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    dbUp = false;
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات الحرّاس متخطّاة. شغّل: npm run up && npm run db:migrate\n');
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  if (owner !== prisma) await owner.$disconnect();
});

const dbIt: typeof it = ((name: string, fn: never) =>
  it(name, async (...args: never[]) => {
    if (!dbUp) return;
    return (fn as (...a: never[]) => unknown)(...args);
  })) as never;

describe('ADR-005 · دفتر الأستاذ للإضافة فقط — طبقة المشغّلات (ولو بمالك المخطط)', () => {
  dbIt('يرفض UPDATE على ledger_entries', async () => {
    await expect(
      owner.$executeRawUnsafe(`UPDATE "ledger_entries" SET "memo" = 'tampered'`),
    ).rejects.toThrow(TRIGGER);
  });

  dbIt('يرفض DELETE على ledger_entries', async () => {
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM "ledger_entries"`),
    ).rejects.toThrow(TRIGGER);
  });

  dbIt('يرفض التعديل على سجل التدقيق وحركات المخزون وأسعار الصرف', async () => {
    await expect(
      owner.$executeRawUnsafe(`UPDATE "audit_logs" SET "action" = 'x'`),
    ).rejects.toThrow(TRIGGER);
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM "inventory_movements"`),
    ).rejects.toThrow(TRIGGER);
    await expect(
      owner.$executeRawUnsafe(`UPDATE "exchange_rates" SET "rate" = 1`),
    ).rejects.toThrow(TRIGGER);
  });

  /**
   * TRUNCATE يتجاوز مشغّلات الصفوف كلياً — أمر واحد يمحو الدفتر بلا اعتراض.
   * هذه الثغرة كانت مفتوحة فعلاً حتى كشفها هذا الاختبار.
   */
  dbIt('يرفض TRUNCATE — الثغرة التي تتجاوز مشغّلات الصفوف', async () => {
    for (const table of [
      'ledger_entries',
      'platform_ledger_entries',
      'audit_logs',
      'inventory_movements',
      'exchange_rates',
    ]) {
      await expect(
        owner.$executeRawUnsafe(`TRUNCATE TABLE "${table}"`),
      ).rejects.toThrow(TRIGGER);
    }
  });

  /**
   * الحارس قاعدة مطلقة لا أثر جانبي لوجود بيانات: يُطلَق على الجدول الفارغ
   * كما يُطلَق على الممتلئ. مشغّل الصف كان يمرّ صامتاً على الفارغ.
   */
  dbIt('يرفض الجملة ولو لم تمسّ صفاً واحداً', async () => {
    // WHERE 1=0 لا يطابق شيئاً مهما امتلأ الجدول — منذ المرحلة 10 لم يعد الدفتر فارغاً
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM "ledger_entries" WHERE 1=0`),
    ).rejects.toThrow(TRIGGER);
  });
});

/**
 * الطبقة الثانية: التطبيق لا يحمل مفتاح الحارس. المالك يعطّل المشغّلات بأمر
 * واحد؛ مستخدم التشغيل لا يملك شيئاً، ولا UPDATE/DELETE له على جداول الإضافة
 * فقط — فحقن SQL في مسار مالي لا يعطّل الحارس ولا يمرّ من تحته.
 */
describe('ADR-005 · مستخدم التشغيل — أقلّ صلاحية', () => {
  dbIt('التطبيق لا يتصل بمالك المخطط، ولا يكتب في المخطط، ولا يعدّل جداول الإضافة', async () => {
    const report = await privilegeReport(prisma);
    expect(privilegeViolations(report)).toEqual([]);
    expect(report.ownedTables).toEqual([]);
  });

  dbIt('لا يعطّل الحارس ولا يغيّر المخطط — ليس مالكاً', async () => {
    await expect(
      prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ALL`),
    ).rejects.toThrow(/must be owner|42501/i);
    await expect(prisma.$executeRawUnsafe(`CREATE TABLE "x_probe" ("id" int)`)).rejects.toThrow(DENIED);
  });

  dbIt('يُرفض بالصلاحية قبل أن يبلغ المشغّل: UPDATE وDELETE وTRUNCATE على الدفتر', async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "ledger_entries" SET "memo" = 'x' WHERE 1=0`)).rejects.toThrow(DENIED);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "platform_ledger_entries" WHERE 1=0`)).rejects.toThrow(DENIED);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE TABLE "wallets"`)).rejects.toThrow(DENIED);
  });

  dbIt('الإنتاج يرفض الإقلاع متصلاً بمالك المخطط، ويُقلع بمستخدم التشغيل', async () => {
    if (!ownerUrl) return;
    const saved = { url: process.env['DATABASE_URL'], env: process.env['NODE_ENV'] };
    process.env['NODE_ENV'] = 'production';
    try {
      process.env['DATABASE_URL'] = ownerUrl;
      const asOwner = new PrismaService();
      await expect(asOwner.onModuleInit()).rejects.toThrow(/أوسع صلاحية/);
      await asOwner.$disconnect();

      process.env['DATABASE_URL'] = saved.url;
      const asApp = new PrismaService();
      await expect(asApp.onModuleInit()).resolves.toBeUndefined();
      await asApp.$disconnect();
    } finally {
      process.env['DATABASE_URL'] = saved.url;
      process.env['NODE_ENV'] = saved.env;
    }
  });

  dbIt('ولا يرى سجل المهاجرات', async () => {
    await expect(prisma.$queryRawUnsafe(`SELECT 1 FROM "_prisma_migrations" LIMIT 1`)).rejects.toThrow(DENIED);
  });
});

describe('INV-05 · لا مخزون سالب', () => {
  dbIt('يرفض onHand سالباً', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "inventory" ("variantId","onHand","reserved","lowStockThreshold","backorderAllowed","version","updatedAt")
         VALUES (gen_random_uuid(), -1, 0, 5, false, 0, now())`,
      ),
    ).rejects.toThrow();
  });

  dbIt('يرفض reserved أكبر من onHand', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "inventory" ("variantId","onHand","reserved","lowStockThreshold","backorderAllowed","version","updatedAt")
         VALUES (gen_random_uuid(), 5, 10, 5, false, 0, now())`,
      ),
    ).rejects.toThrow();
  });
});

describe('ADR-011 · عدم تكرار أحداث البوابة', () => {
  dbIt('يرفض حدثاً بالمعرّف نفسه مرتين', async () => {
    const eventId = `evt_test_${Date.now()}`;
    const insert = () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "payment_events" ("id","provider","providerEventId","type","payloadJson","receivedAt")
         VALUES (gen_random_uuid(), 'fake', '${eventId}', 'test', '{}'::jsonb, now())`,
      );
    await insert();
    await expect(insert()).rejects.toThrow();
    await prisma.$executeRawUnsafe(
      `DELETE FROM "payment_events" WHERE "providerEventId" = '${eventId}'`,
    );
  });
});

describe('ADR-013 · العملات والخانات العشرية', () => {
  dbIt('البذور زرعت سبع عملات بخاناتها الصحيحة', async () => {
    const rows = await prisma.currency.findMany({
      select: { code: true, minorUnitDigits: true, isBase: true },
    });
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));

    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(byCode['JOD']?.minorUnitDigits).toBe(3);
    expect(byCode['KWD']?.minorUnitDigits).toBe(3);
    expect(byCode['USD']?.minorUnitDigits).toBe(2);
    expect(byCode['SAR']?.minorUnitDigits).toBe(2);
  });

  dbIt('عملة أساسية واحدة لا أكثر', async () => {
    const bases = await prisma.currency.count({ where: { isBase: true } });
    expect(bases).toBe(1);

    await expect(
      prisma.$executeRawUnsafe(`UPDATE "currencies" SET "isBase" = true WHERE "code" = 'SAR'`),
    ).rejects.toThrow();
  });

  dbIt('يرفض خانات عشرية خارج المدى', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "currencies" ("code","nameAr","nameEn","symbol","minorUnitDigits","minPayoutMinorUnits","isActive","isBase","sort")
         VALUES ('XXX','اختبار','Test','X', 9, 100, true, false, 99)`,
      ),
    ).rejects.toThrow();
  });
});

describe('التدقيق الليلي · views موجودة وتعمل', () => {
  dbIt('الأربعة كلها قابلة للاستعلام', async () => {
    for (const view of [
      'audit_wallet_drift',
      'audit_inventory_drift',
      'audit_reservation_drift',
      'audit_order_total_drift',
    ]) {
      const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${view}" LIMIT 1`);
      expect(Array.isArray(rows)).toBe(true);
    }
  });

  dbIt('لا انحراف على قاعدة نظيفة', async () => {
    // على قاعدة مبذورة حديثاً يجب ألّا يعود أي صف — الصف يعني خللاً
    for (const view of ['audit_wallet_drift', 'audit_inventory_drift', 'audit_reservation_drift']) {
      const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${view}"`);
      expect(rows).toHaveLength(0);
    }
  });
});

describe('العمولة — نسبة عامة أو لمتجر (قرار 14 أكتوبر 2026)', () => {
  dbIt('قاعدة عامة واحدة سارية بـ 10%، ولا قاعدة فئة سارية', async () => {
    const global = await prisma.commissionRule.findFirst({
      where: { scope: 'global', effectiveTo: null },
    });
    expect(global?.rateBps).toBe(1000);

    const perCategory = await prisma.commissionRule.count({
      where: { scope: { notIn: ['global', 'vendor'] }, effectiveTo: null },
    });
    expect(perCategory).toBe(0);
  });

  dbIt('ترفض قاعدة فئة سارية — المستوى أُلغي، والمنتهية تبقى سجلاً', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "commission_rules" ("id","scope","rateBps","effectiveFrom","createdAt")
         VALUES (gen_random_uuid(), 'category', 500, now(), now())`,
      ),
    ).rejects.toThrow();
  });

  dbIt('يرفض نسبة عمولة خارج المدى', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "commission_rules" ("id","scope","rateBps","effectiveFrom","createdAt")
         VALUES (gen_random_uuid(), 'global', 20000, now(), now())`,
      ),
    ).rejects.toThrow();
  });
});

describe('الإعدادات المؤسِّسة', () => {
  dbIt('القيم التي حسمتها المرحلة 01 مزروعة', async () => {
    const rows = await prisma.setting.findMany();
    const s = Object.fromEntries(rows.map((r) => [r.key, r.valueJson]));

    expect(s['hold_period_days']).toBe(14); // ADR-007
    expect(s['reservation_ttl_minutes']).toBe(15); // ADR-006
    expect(s['vendor_accept_timeout_hours']).toBe(48); // Q-07
    expect(s['default_commission_bps']).toBe(1000); // Q-01
    expect(s['fx_spread_bps']).toBe(200); // Q-13
    expect(s['base_currency']).toBe('USD'); // ADR-013
    expect(s['coupon_default_funded_by']).toBe('platform'); // Q-06
  });
});
