import { expect, test } from '@playwright/test';
import { makeVendor, tag } from './fixtures';

/**
 * ✕ في خانة الكوبون يمحو المكتوب — 27 أكتوبر 2026، بطلب صاحبة المشروع أثناء CHK-024.
 * كما في خانة البحث: يظهر حين يُكتب شيء، ويُبقي المؤشّر في الخانة لكتابة غيره.
 */
test('✕ يمحو رمز الكوبون ويُبقي المؤشّر، ولا يظهر والخانة فارغة', async ({ page }) => {
  const v = await makeVendor(tag());
  await page.goto(`/p/${v.productSlug}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByText('أُضيف إلى سلّتك.')).toBeVisible();
  await page.goto('/cart');

  const field = page.getByLabel('كود الخصم');
  const clear = page.getByRole('button', { name: 'امسح الرمز' });
  await expect(clear).toHaveCount(0);

  await field.fill('qa24-old');
  await expect(field).toHaveValue('QA24-OLD');
  await clear.click();
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await expect(clear).toHaveCount(0);
});
