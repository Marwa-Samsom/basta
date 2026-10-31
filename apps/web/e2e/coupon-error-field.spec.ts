import { expect, test } from '@playwright/test';
import { makeVendor, tag } from './fixtures';

/**
 * رفض الكوبون تحت خانته — CHK-018، 31 أكتوبر 2026 (الموجة 4 · واجهة).
 * وجدته صاحبة المشروع على 375: «الكوبون غير صالح.» كان يظهر في رأس الصفحة بعيداً عن
 * خانته أسفلها، فمن ضغط «طبّق» لا يرى شيئاً تغيّر — ويظنّ الكوبون طُبّق.
 */
test.use({ viewport: { width: 375, height: 812 } });

test('على الجوال: رفض الكوبون ظاهر تحت خانته، ويختفي حين يعدّل الرمز', async ({ page }) => {
  const v = await makeVendor(tag());
  await page.goto(`/p/${v.productSlug}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByText('أُضيف إلى سلّتك.')).toBeVisible();

  await page.goto('/cart');
  const field = page.getByLabel('كود الخصم');
  await field.scrollIntoViewIfNeeded();
  await field.fill('AA');
  await page.getByRole('button', { name: 'طبّق' }).click();

  const message = page.locator('#coupon-error');
  await expect(message).toHaveText('الكوبون غير صالح.');
  await expect(message).toBeInViewport();
  await expect(page.getByText('الكوبون غير صالح.')).toHaveCount(1);
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await field.fill('AAB');
  await expect(message).toHaveCount(0);
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');
});
