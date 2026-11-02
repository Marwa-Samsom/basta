import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OperationsService } from '../src/modules/admin/application/operations.service';
import { CartService } from '../src/modules/cart/application/cart.service';
import { DisplayCurrencyService } from '../src/modules/pricing/application/display-currency.service';

/**
 * إعداد عددي تالف في القاعدة يعود إلى افتراضيّه في كل قارئ — 2 نوفمبر 2026، من SYS-002.
 * «مهلة حجز المخزون» كانت تحتمل «خمسة»، أمّا «هامش الصرف» و«انتهاء السلة» فكانا يُقرآن بـ Number()
 * وحده فيصيران NaN: أسعار العملات الأخرى ومجموع الطلب، وكل سلة جديدة، و«NaN%» في لوحة العملات،
 * وتقرير هامش الصرف يسقط بتحويل ::int.
 */
const CORRUPT = 'خمسة';
const none = {} as never;

describe('إعداد عددي تالف يعود إلى افتراضيّه', () => {
  it('هامش الصرف في المتجر: التحويل بين العملات رقمٌ لا NaN', async () => {
    const prisma = {
      currency: {
        findMany: async () => [
          { code: 'JOD', nameAr: 'دينار أردني', symbol: 'د.أ' },
          { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س' },
        ],
      },
      exchangeRate: { findMany: async () => [{ quoteCode: 'JOD', rate: 0.709 }, { quoteCode: 'SAR', rate: 3.75 }] },
      setting: {
        findMany: async () => [
          { key: 'fx_spread_bps', valueJson: CORRUPT },
          { key: 'default_display_currency', valueJson: 'JOD' },
        ],
      },
    };
    const fx = await new DisplayCurrencyService(prisma as never).resolve('SAR');
    expect(fx.currency).toBe('SAR');
    const sar = fx.convert(10_000n, 'JOD');
    expect(typeof sar).toBe('bigint');
    expect(sar! > 0n).toBe(true);
    expect(Number.isFinite(fx.usdBound(10_000))).toBe(true);
  });

  it('انتهاء السلة: 168 ساعة', async () => {
    const prisma = { setting: { findUnique: async () => ({ valueJson: CORRUPT }) } };
    const cart = new CartService(prisma as never, none, none) as unknown as { expiryHours(): Promise<number> };
    expect(await cart.expiryHours()).toBe(168);
  });

  it('لوحة العملات تعرض الهامش الذي يُطبَّق: 200 للتالف وللغائب', async () => {
    for (const stored of [{ valueJson: CORRUPT }, null]) {
      const prisma = {
        currency: { findMany: async () => [] },
        exchangeRate: { findMany: async () => [] },
        setting: { findUnique: async () => stored },
      };
      const ops = new OperationsService(prisma as never, none, none, none);
      expect((await ops.currencies()).spreadBps, JSON.stringify(stored)).toBe(200);
    }
  });

  it('الدفع والتقرير يقرآن الهامش بأمان', () => {
    const src = join(__dirname, '../src/modules');
    const pricing = readFileSync(join(src, 'pricing/application/pricing.service.ts'), 'utf8');
    expect(pricing).toContain("spreadBps: fxSpreadBps(settings.get('fx_spread_bps'))");
    // ::int على نصٍّ تالف يُسقط التقرير كله — يُحوَّل الرقم وحده
    const reports = readFileSync(join(src, 'admin/application/reports.service.ts'), 'utf8');
    expect(reports).toContain(`~ '^[0-9]+$' THEN ("valueJson" #>> '{}')::int END FROM "settings" WHERE "key" = 'fx_spread_bps'`);
  });
});
