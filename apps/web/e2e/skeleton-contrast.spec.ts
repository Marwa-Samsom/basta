import { expect, test, type Page } from '@playwright/test';

/**
 * هيكل التحميل يُرى في الوضعين — CHK-016، 31 أكتوبر 2026. كان لونه --surface-sunken،
 * وهو في الداكن لون الصفحة نفسه (beige-950)، فالسلة وصفحات الحساب واللوحتان تبدو
 * سوداء فارغة أثناء الجلب كأن الموقع توقّف. الآن له رمزه --skeleton، ويُرى على
 * الصفحة والبطاقة والسطح المرفوع.
 */

/** تباين WCAG بين الهيكل وما خلفه: الفاتح على الصفحة 1.10 ويُرى، والداكن القديم 1.00 */
const MIN_RATIO = 1.08;

/** طلب السلة لا يعود أبداً، فتبقى صفحة السلة على هيكلها */
const holdCart = async (page: Page, theme: 'light' | 'dark') => {
  await page.addInitScript((t) => {
    localStorage.setItem('basta.theme', t);
    localStorage.setItem('basta.cart', 'e2e-skeleton-pending');
  }, theme);
  await page.route('**/api/v1/cart**', () => {});
};

/** يضع هيكلاً داخل سطح بلون الرمز المعطى، ليُقاس عليه */
const onSurface = (page: Page, token: string) =>
  page.evaluate((t) => {
    const box = document.createElement('div');
    box.id = `surface-${t}`;
    box.style.background = `var(--${t})`;
    box.style.padding = '16px';
    box.innerHTML = '<span class="skeleton" style="block-size: 20px"></span>';
    document.body.appendChild(box);
    return `#surface-${t} .skeleton`;
  }, token);

/** تباين لون الهيكل مع أقرب سلف له خلفية غير شفافة */
const ratio = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const rgba = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const opaque = (c: number[]) => c.length === 3 || (c[3] ?? 1) > 0;
    const lum = ([r = 0, g = 0, b = 0]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const el = document.querySelector(sel);
    if (!el) throw new Error(`لا هيكل في ${sel}`);
    const own = rgba(getComputedStyle(el).backgroundColor);
    let behind: number[] | null = null;
    for (let p = el.parentElement; p && !behind; p = p.parentElement) {
      const c = rgba(getComputedStyle(p).backgroundColor);
      if (opaque(c)) behind = c;
    }
    if (!behind) throw new Error('لا خلفية خلف الهيكل');
    const [a, b] = [lum(own), lum(behind)].sort((x, y) => y - x) as [number, number];
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  }, selector);

for (const theme of ['dark', 'light'] as const) {
  test.describe(`الوضع ${theme === 'dark' ? 'الداكن' : 'الفاتح'}`, () => {
    test.use({ colorScheme: theme });

    test('هيكل السلة يُرى على الصفحة، والهيكل يُرى على البطاقة والسطح المرفوع', async ({ page }) => {
      await holdCart(page, theme);
      await page.goto('/cart');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('status').filter({ hasText: 'جارٍ تحميل سلّتك…' })).toBeAttached();
      await expect(page.locator('.sp-skel .skeleton').first()).toBeVisible();

      expect(await ratio(page, '.sp-skel .skeleton')).toBeGreaterThanOrEqual(MIN_RATIO);
      for (const token of ['surface-card', 'surface-raised']) {
        expect(await ratio(page, await onSurface(page, token)), token).toBeGreaterThanOrEqual(MIN_RATIO);
      }
    });
  });
}
