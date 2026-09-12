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

const prisma = new PrismaClient();
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
});

const dbIt: typeof it = ((name: string, fn: never) =>
  it(name, async (...args: never[]) => {
    if (!dbUp) return;
    return (fn as (...a: never[]) => unknown)(...args);
  })) as never;

describe('ADR-005 · دفتر الأستاذ للإضافة فقط', () => {
  dbIt('يرفض UPDATE على ledger_entries', async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "ledger_entries" SET "memo" = 'tampered'`),
    ).rejects.toThrow();
  });

  dbIt('يرفض DELETE على ledger_entries', async () => {
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "ledger_entries"`),
    ).rejects.toThrow();
  });

  dbIt('يرفض التعديل على سجل التدقيق وحركات المخزون وأسعار الصرف', async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "audit_logs" SET "action" = 'x'`),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "inventory_movements"`),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "exchange_rates" SET "rate" = 1`),
    ).rejects.toThrow();
  });

  /**
   * TRUNCATE يتجاوز مشغّلات الصفوف كلياً — أمر واحد يمحو الدفتر بلا اعتراض.
   * هذه الثغرة كانت مفتوحة فعلاً حتى كشفها هذا الاختبار.
   */
  dbIt('يرفض TRUNCATE — الثغرة التي تتجاوز مشغّلات الصفوف', async () => {
    for (const table of [
      'ledger_entries',
      'audit_logs',
      'inventory_movements',
      'exchange_rates',
    ]) {
      await expect(
        prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}"`),
      ).rejects.toThrow();
    }
  });

  /**
   * الحارس قاعدة مطلقة لا أثر جانبي لوجود بيانات: يُطلَق على الجدول الفارغ
   * كما يُطلَق على الممتلئ. مشغّل الصف كان يمرّ صامتاً على الفارغ.
   */
  dbIt('يرفض الجملة ولو كان الجدول فارغاً', async () => {
    const count = await prisma.ledgerEntry.count();
    expect(count).toBe(0);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "ledger_entries" WHERE 1=0`),
    ).rejects.toThrow();
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

describe('Q-01 · قواعد العمولة المبذورة', () => {
  dbIt('قاعدة عامة واحدة بـ 10% وست قواعد فئوية', async () => {
    const global = await prisma.commissionRule.findFirst({
      where: { scope: 'global', effectiveTo: null },
    });
    expect(global?.rateBps).toBe(1000);

    const perCategory = await prisma.commissionRule.count({
      where: { scope: 'category', effectiveTo: null },
    });
    expect(perCategory).toBeGreaterThanOrEqual(6);
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
