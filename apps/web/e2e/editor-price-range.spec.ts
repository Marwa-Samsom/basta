import { expect, test } from '@playwright/test';
import { makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * «نطاق السعر» في ملخّص محرّر المنتج بتنسيق المال كبقية الموقع (VON-055، 28 أكتوبر 2026): كان النصّ كما
 * في خانة السعر ورمز العملة بعده — «12.5 JOD» حيث القائمة والمتجر «12.500 د.أ.».
 */
test('ملخّص المحرّر: «نطاق السعر» بخانات العملة ورمزها — لا «12.5 JOD»', async ({ page }) => {
  const v = await makeVendor(tag());
  await prisma.vendor.update({ where: { id: v.vendorId }, data: { settlementCurrency: 'JOD' } });
  await prisma.productVariant.update({ where: { id: v.variantId }, data: { priceMinorUnits: 12_500n } });
  const { productId } = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.variantId }, select: { productId: true } });

  await page.goto(`/login?next=${encodeURIComponent(`/vendor/products/${productId}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === `/vendor/products/${productId}`);

  const range = page.locator('dt', { hasText: 'نطاق السعر' }).locator('xpath=following-sibling::dd[1]');
  await expect(range).toContainText('12.500');
  await expect(range).toContainText('د.أ');
  await expect(range).not.toContainText('JOD');
});
