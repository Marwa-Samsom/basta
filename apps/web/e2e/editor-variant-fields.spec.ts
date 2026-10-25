import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeVendor, prisma, tag } from './fixtures';

/**
 * خانات السعر قبل الخصم والباركود والوزن في محرّر المنتج (25 أكتوبر 2026، بطلب صاحبة
 * المشروع بعد VCAT-017): كانت تدخل بالاستيراد وحده، ولا خانات لها في المحرّر.
 */

async function openEditor(page: Page, email: string, productId: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(`/vendor/products/${productId}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByLabel('السعر للمتغيّر 1')).toHaveValue('250');
}

const save = async (page: Page) => page.getByRole('button', { name: 'احفظ', exact: true }).click();

test('البائع يكتب الخصم والباركود والوزن فتُحفظ وتعود في المحرّر، ويمحو الخصم بإفراغ خانته', async ({ page }) => {
  const v = await makeVendor(tag());
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  await openEditor(page, v.email, product.id);

  await page.getByLabel('السعر قبل الخصم للمتغيّر 1').fill('299.00');
  await page.getByLabel('الباركود للمتغيّر 1').fill('6291041500213');
  await page.getByLabel('الوزن بالغرام للمتغيّر 1').fill('١٨٠');
  await save(page);
  await expect(page.getByText('حُفظ المنتج.')).toBeVisible();
  expect(await prisma.productVariant.findUniqueOrThrow({ where: { id: v.variantId } })).toMatchObject({
    compareAtPriceMinorUnits: 29_900n,
    barcode: '6291041500213',
    weightGrams: 180,
  });

  // يعود ما حُفظ في خاناته — وحفظ الاسم وحده لا يمسّه
  await page.reload();
  await expect(page.getByLabel('السعر قبل الخصم للمتغيّر 1')).toHaveValue('299');
  await expect(page.getByLabel('الباركود للمتغيّر 1')).toHaveValue('6291041500213');
  await expect(page.getByLabel('الوزن بالغرام للمتغيّر 1')).toHaveValue('180');
  await page.getByLabel('الاسم بالعربية *').fill(`${v.productName} — معدّل`);
  await save(page);
  await expect(page.getByText('حُفظ المنتج.')).toBeVisible();
  expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: v.variantId } })).compareAtPriceMinorUnits).toBe(29_900n);

  // إفراغ الخانة قرار صريح بمحو الخصم
  await page.getByLabel('السعر قبل الخصم للمتغيّر 1').fill('');
  await save(page);
  await expect(page.getByText('حُفظ المنتج.')).toBeVisible();
  expect(await prisma.productVariant.findUniqueOrThrow({ where: { id: v.variantId } })).toMatchObject({
    compareAtPriceMinorUnits: null,
    barcode: '6291041500213',
    weightGrams: 180,
  });
});

test('سعر قبل الخصم لا يزيد على السعر: يُرفض برسالة الخادم ولا يُحفظ', async ({ page }) => {
  const v = await makeVendor(tag());
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  await openEditor(page, v.email, product.id);

  await page.getByLabel('السعر قبل الخصم للمتغيّر 1').fill('200.00');
  await save(page);
  await expect(page.getByText(/السعر قبل الخصم للمتغيّر .* يجب أن يكون أعلى من سعره/)).toBeVisible();
  expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: v.variantId } })).compareAtPriceMinorUnits).toBeNull();
});
