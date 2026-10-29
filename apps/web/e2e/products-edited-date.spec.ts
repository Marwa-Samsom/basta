import { expect, test } from '@playwright/test';
import { makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * «آخر تعديل» في قائمة منتجات البائع كالتصميم (VD-06): «اليوم · 09:40»، «أمس · 18:20»، ثم «11 سبتمبر»،
 * وبالسنة إن لم تكن هذه. كانت أرقاماً وحدها «2026/10/28» (VCAT-001، 28 أكتوبر 2026).
 */
const MONTH = '(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)';

test('«آخر تعديل»: اليوم وأمس بالساعة، وما قبلهما باليوم واسم الشهر — بلا «/»', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: v.vendorId }, orderBy: { sort: 'asc' } });
  const now = Date.now();
  const at = (days: number) => new Date(now - days * 86_400_000);
  const older = [
    ['أمس', 1],
    ['قبل أربعين يوماً', 40],
    ['قبل سنتين', 730],
  ] as const;
  for (const [label, days] of older) {
    await prisma.product.create({
      data: { vendorId: v.vendorId, vendorCategoryId: category.id, slug: `edited-${days}-${t}`, nameAr: `${label} ${t}`, descriptionAr: 'منتج اختبار.', status: 'draft', updatedAt: at(days) },
    });
  }
  await prisma.product.updateMany({ where: { slug: `product-${t}` }, data: { updatedAt: new Date(now) } });

  await page.goto('/login?next=/vendor/products');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/products');

  const editedOf = (name: string) => page.locator('tr', { hasText: name }).locator('td[data-label="آخر تعديل"]');
  await expect(editedOf(v.productName)).toHaveText(/^اليوم · \d{2}:\d{2}$/);
  await expect(editedOf(`أمس ${t}`)).toHaveText(/^أمس · \d{2}:\d{2}$/);
  await expect(editedOf(`قبل أربعين يوماً ${t}`)).toHaveText(new RegExp(`^\\d{1,2} ${MONTH}( \\d{4})?$`));
  await expect(editedOf(`قبل سنتين ${t}`)).toHaveText(new RegExp(`^\\d{1,2} ${MONTH} ${at(730).getFullYear()}$`));
  await expect(page.locator('td[data-label="آخر تعديل"]', { hasText: '/' })).toHaveCount(0);
});
