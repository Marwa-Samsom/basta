import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * البذور تُنشئ ما غاب ولا تكتب فوق ما وُجد: ما حرّرته الإدارة بعد الإطلاق يبقى
 * بعد تشغيلها ثانيةً. تُشغَّل كما تُشغَّل فعلاً — عملية منفصلة بـ tsx.
 *
 * القيم المبدَّلة هنا مختارة لا يقرؤها ملف اختبار آخر يجري معاً، وتُعاد كما كانت.
 */
const prisma = new PrismaClient();
let dbUp = false;

const API_ROOT = join(__dirname, '..');
const TSX = join(API_ROOT, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const runSeed = () => execFileSync(process.execPath, [TSX, 'prisma/seed.ts'], { cwd: API_ROOT, env: process.env, stdio: 'pipe' });

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبار البذور متخطّى.\n');
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('البذور لا تكتب فوق ما حرّرته الإدارة', () => {
  it('الإعداد والعملة واسم الفئة والسمة تبقى كما حُرّرت بعد تشغيل البذور ثانيةً', async () => {
    if (!dbUp) return;
    const before = {
      setting: await prisma.setting.findUniqueOrThrow({ where: { key: 'cart_expiry_hours' } }),
      currency: await prisma.currency.findUniqueOrThrow({ where: { code: 'EUR' } }),
      category: await prisma.category.findUniqueOrThrow({ where: { slug: 'phones' } }),
      attribute: await prisma.attribute.findUniqueOrThrow({ where: { code: 'warranty_months' } }),
    };
    try {
      // ما تفعله الإدارة من لوحتها
      await prisma.setting.update({ where: { key: 'cart_expiry_hours' }, data: { valueJson: 72 } });
      await prisma.currency.update({ where: { code: 'EUR' }, data: { minPayoutMinorUnits: 9_999n } });
      await prisma.category.update({ where: { slug: 'phones' }, data: { nameEn: 'Mobile phones (edited)' } });
      await prisma.attribute.update({ where: { code: 'warranty_months' }, data: { nameAr: 'الضمان (معدّل)' } });

      runSeed();

      expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'cart_expiry_hours' } })).valueJson).toBe(72);
      expect((await prisma.currency.findUniqueOrThrow({ where: { code: 'EUR' } })).minPayoutMinorUnits).toBe(9_999n);
      expect((await prisma.category.findUniqueOrThrow({ where: { slug: 'phones' } })).nameEn).toBe('Mobile phones (edited)');
      expect((await prisma.attribute.findUniqueOrThrow({ where: { code: 'warranty_months' } })).nameAr).toBe('الضمان (معدّل)');
    } finally {
      await prisma.setting.update({ where: { key: 'cart_expiry_hours' }, data: { valueJson: before.setting.valueJson as never } });
      await prisma.currency.update({ where: { code: 'EUR' }, data: { minPayoutMinorUnits: before.currency.minPayoutMinorUnits } });
      await prisma.category.update({ where: { slug: 'phones' }, data: { nameEn: before.category.nameEn } });
      await prisma.attribute.update({ where: { code: 'warranty_months' }, data: { nameAr: before.attribute.nameAr } });
    }
  }, 120_000);

  it('وما غاب تُنشئه: إعداد محذوف يعود بقيمته المؤسِّسة', async () => {
    if (!dbUp) return;
    const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'coupon_default_funded_by' } });
    await prisma.setting.delete({ where: { key: 'coupon_default_funded_by' } });
    try {
      runSeed();
      expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'coupon_default_funded_by' } })).valueJson).toBe('platform');
    } finally {
      await prisma.setting.upsert({
        where: { key: 'coupon_default_funded_by' },
        update: { valueJson: row.valueJson as never },
        create: { key: 'coupon_default_funded_by', valueJson: row.valueJson as never },
      });
    }
  }, 120_000);
});
