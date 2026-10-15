import { expect, test } from '@playwright/test';
import { PASSWORD, makeVendor, prisma, tag } from './fixtures';

/**
 * فئات المتجر — قرار صاحب المشروع 14 أكتوبر 2026: «كل متجر له فئاته، ينشئها دون
 * تدخّل الإدارة، وآخر خيار في قائمة الفئات إضافة فئة». البائع يضيف الفئة من محرّر
 * المنتج نفسه، والمنشور يبقى منشوراً (الفئة ترتيب رفّ لا محتوى يُراجَع)، والمشتري
 * يراها زرّاً في صفحة المتجر يصفّي منتجاته.
 */
test('فئة جديدة من قائمة المحرّر: تُنشأ وتُختار، والمنشور يبقى منشوراً، وتظهر زرّاً في صفحة المتجر', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  const name = `عروض ${t}`;

  await page.goto(`/login?next=${encodeURIComponent(`/vendor/products/${product.id}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();

  const category = page.getByLabel('الفئة في متجرك');
  await expect(category).toBeVisible();
  // آخر خيار في القائمة يفتح حقل الاسم ولا يُختار هو
  await expect(category.locator('option').last()).toHaveText('+ إضافة فئة جديدة…');
  await category.selectOption({ label: '+ إضافة فئة جديدة…' });
  await page.getByLabel('اسم الفئة الجديدة').fill(name);
  await page.getByRole('button', { name: 'أضف', exact: true }).click();
  await expect(category.locator('option:checked')).toHaveText(name);
  await expect(page.getByLabel('اسم الفئة الجديدة')).toBeHidden();

  await page.getByRole('button', { name: 'احفظ', exact: true }).click();
  await expect(page.getByText('حُفظ المنتج.')).toBeVisible();
  const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { vendorCategory: true } });
  expect(saved.vendorCategory?.nameAr).toBe(name);
  expect(saved.status).toBe('active');

  // المشتري: الفئة زرّ في صفحة المتجر، والضغط عليه يصفّي
  await page.goto(`/s/${encodeURIComponent(`store-${t}`)}`);
  const chips = page.getByRole('navigation', { name: 'فئات المتجر' });
  await chips.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/category=/);
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page.getByText(v.productName)).toBeVisible();
});
