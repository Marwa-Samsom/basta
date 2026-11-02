import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * «عملة العرض الافتراضية» تبلغ الزائر الجديد فوراً، ورأسه وأسعاره بعملة واحدة (ACFG-107،
 * 1 نوفمبر 2026). كان الموقع يحفظ الافتراضية خمس دقائق، وصفحاته ترسل كوكي المشتري وحده:
 * الزائر بلا كوكي يأخذ أسعاره بافتراضية الخادم (نسخة دقيقة) ورأسه وسلّته بنسخة الخمس.
 * بعد تغيير الإدارة: الرأس على القديمة دقائق، والأسعار بعملة غير عملة السلة.
 */
describe('عملة الصفحة واحدة، والافتراضية تبلغ الزائر الجديد', () => {
  const web = join(__dirname, '../../../../web/src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });

  it('نسخة العملات الافتراضية 15 ثانية فأقل', () => {
    const storefront = readFileSync(join(web, 'lib/storefront.ts'), 'utf8');
    const seconds = Number(/'\/storefront\/currencies',\s*(\d+)\)/.exec(storefront)?.[1]);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(15);
  });

  it('لا صفحة تطلب أسعاراً بكوكي المشتري وحده — كلها بعملة الصفحة', () => {
    const cookieOnly = files(join(web, 'app'))
      .filter((f) => /requestCurrency\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(web, f).replace(/\\/g, '/'));
    expect(cookieOnly).toEqual([]);
    const server = readFileSync(join(web, 'lib/currency-server.ts'), 'utf8');
    expect(server).toMatch(/export async function pageCurrency\(\)/);
    expect(server).not.toMatch(/export async function requestCurrency/);
  });
});
