import { expect, test } from '@playwright/test';
import { makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * رأس «المخزون» وشارة المتاح في «المنتجات» — VCAT-086، 2 نوفمبر 2026. رأت صاحبة المشروع «4 متغيّراً
 * · 3 يحتاج انتباهاً»، و«قفازات صوف» بمتاح 0 «نفد» في المخزون و«منخفض» في قائمة المنتجات.
 */
test('المخزون «متغيّران · اثنان يحتاجان انتباهاً»، والمنتجات «نفد» للصفر و«منخفض» للقليل', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);

  // منتج makeVendor (10 قطع) ينفد: حركة جرد بالفرق كي لا ينحرف المخزون عن حركاته
  await prisma.inventoryMovement.create({ data: { variantId: v.variantId, delta: -10, reason: 'manual_adjust' } });
  await prisma.inventory.update({ where: { variantId: v.variantId }, data: { onHand: 0, lowStockThreshold: 5, lowStockSince: new Date() } });

  // ومنتج ثانٍ بثلاث قطع تحت العتبة 5
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: v.vendorId }, orderBy: { sort: 'asc' } });
  const low = await prisma.product.create({
    data: { vendorId: v.vendorId, vendorCategoryId: category.id, slug: `low-${t}`, nameAr: `قليل ${t}`, descriptionAr: 'منتج اختبار.', status: 'active', publishedAt: new Date() },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: low.id, vendorId: v.vendorId, sku: `LOW-${t}`.toUpperCase(), priceMinorUnits: 9_900n, optionsKey: '', isActive: true },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: 3, reserved: 0, lowStockThreshold: 5, lowStockSince: new Date() } });
  await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 3, reason: 'import' } });

  await page.goto('/login?next=/vendor/inventory');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/inventory');

  await expect(page.getByText('متغيّران · اثنان يحتاجان انتباهاً')).toBeVisible();
  await expect(page.getByText(/متغيّراً ·/)).toHaveCount(0);

  await page.goto('/vendor/products');
  const outRow = page.locator('tr', { hasText: v.productName });
  const lowRow = page.locator('tr', { hasText: `قليل ${t}` });
  await expect(outRow.getByText('نفد', { exact: true })).toBeVisible();
  await expect(outRow.getByText('منخفض', { exact: true })).toHaveCount(0);
  await expect(lowRow.getByText('منخفض', { exact: true })).toBeVisible();
  await expect(lowRow.getByText('نفد', { exact: true })).toHaveCount(0);
});
