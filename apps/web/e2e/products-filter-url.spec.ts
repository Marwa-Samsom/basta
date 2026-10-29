import { expect, test } from '@playwright/test';
import { makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * تبويب منتجات البائع وعنوانها شيء واحد (VON-055، 28 أكتوبر 2026). كان التبويب يُقرأ من window.location
 * عند التركيب، والانتقال بـ Link يركّب الصفحة قبل أن يتغيّر العنوان: «موقوفة» من الرئيسية تفتح «الكل».
 * والضغط على تبويب لا يغيّر العنوان، فالتحديث يعيد غير المعروض.
 */
test('«موقوفة» من الرئيسية تفتح الموقوفة، والتبويب يكتب نفسه في العنوان فيبقى بعد التحديث', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: v.vendorId }, orderBy: { sort: 'asc' } });
  const draft = `مسوّدة ${t}`;
  const stopped = `موقوف ${t}`;
  await prisma.product.create({ data: { vendorId: v.vendorId, vendorCategoryId: category.id, slug: `draft-${t}`, nameAr: draft, descriptionAr: 'منتج اختبار.', status: 'draft' } });
  await prisma.product.create({
    data: { vendorId: v.vendorId, vendorCategoryId: category.id, slug: `stopped-${t}`, nameAr: stopped, descriptionAr: 'منتج اختبار.', status: 'rejected', rejectReason: 'الصور غير واضحة.' },
  });

  await page.goto('/login?next=/vendor');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor');

  await page.locator('a.stat', { hasText: 'موقوفة' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/products' && u.searchParams.get('status') === 'rejected');
  await expect(page.getByRole('tab', { name: /^موقوف/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(stopped)).toBeVisible();
  await expect(page.getByText(v.productName)).toHaveCount(0);

  await page.getByRole('tab', { name: /^مسوّدة/ }).click();
  await page.waitForURL((u) => u.searchParams.get('status') === 'draft');
  await expect(page.getByText(draft)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: /^مسوّدة/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(draft)).toBeVisible();
  await expect(page.getByText(stopped)).toHaveCount(0);

  await page.getByRole('tab', { name: /^الكل/ }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/products' && !u.searchParams.has('status'));
  await expect(page.getByText(v.productName)).toBeVisible();
});
