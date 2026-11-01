import { expect, test } from '@playwright/test';

/**
 * SH-05 لرابط لا يطابق صفحة — DISC-090، 31 أكتوبر 2026. /xyz كان يُرسم بالتخطيط الجذري
 * وحده: بلا رأس المتجر ولا تذييله، وأنماط sd-404 لا تُحمَّل (تعيش مع المتجر)، فالـ 404
 * صغيرة في الزاوية والنص لاصق بالحافة. الآن يُرسم داخل قشرة المتجر كـ /p/لا-يوجد.
 */
for (const path of ['/xyz', '/a/b/c', '/p/لا-يوجد']) {
  test(`${path}: 404 داخل قشرة المتجر وبأنماطها`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'لم نجد هذه الصفحة' })).toBeVisible();

    // رأس المتجر: الحساب وشريط المتاجر
    await expect(page.getByRole('link', { name: 'حسابي وطلباتي' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'المتاجر' })).toBeVisible();

    // أنماط SH-05 محمّلة: الصفحة في الوسط والرمز كبير
    const look = await page.locator('.sd-404').evaluate((el) => ({
      align: getComputedStyle(el).textAlign,
      code: parseFloat(getComputedStyle(el.querySelector('.sd-404__code') as Element).fontSize),
    }));
    expect(look.align).toBe('center');
    expect(look.code).toBeGreaterThan(40);
  });
}
