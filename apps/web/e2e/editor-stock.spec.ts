import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeVendor, prisma, tag } from './fixtures';

/**
 * محرّر المنتج والمخزون (VCAT-018، 24 أكتوبر 2026): المحرّر كان يرسل كمية كل متغيّر
 * مع كل حفظ، والخادم يترجمها جرداً — فبيعٌ جرى والصفحة مفتوحة يعود قطعاً وهمية
 * بحفظ وصف أو سمة. صاحبة المشروع رأت 6 تصير 8 بحركة manual_adjust +2.
 */

/** بيع كما يكتبه الدفع: المخزون ينقص وحركة sale بالفرق */
async function sell(variantId: string, qty: number): Promise<void> {
  await prisma.$transaction([
    prisma.inventory.update({ where: { variantId }, data: { onHand: { decrement: qty } } }),
    prisma.inventoryMovement.create({ data: { variantId, delta: -qty, reason: 'sale' } }),
  ]);
}

const onHand = async (variantId: string) => (await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).onHand;
const movements = (variantId: string) =>
  prisma.inventoryMovement.findMany({ where: { variantId }, orderBy: { createdAt: 'asc' }, select: { delta: true, reason: true } });

async function openEditor(page: Page, email: string, productId: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(`/vendor/products/${productId}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByLabel('الكمية للمتغيّر 1')).toHaveValue('10');
}

test('بيع والمحرّر مفتوح ثم حفظ الوصف وحده: المخزون كما بعد البيع بلا حركة جديدة', async ({ page }) => {
  const v = await makeVendor(tag());
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  await openEditor(page, v.email, product.id);

  await sell(v.variantId, 2);
  await page.getByLabel('الوصف بالعربية').fill('وصف بعد تعديل.');
  await page.getByRole('button', { name: 'احفظ', exact: true }).click();
  await expect(page.getByText('حُفظ المنتج.')).toBeVisible();

  expect(await onHand(v.variantId)).toBe(8);
  expect(await movements(v.variantId)).toEqual([
    { delta: 10, reason: 'import' },
    { delta: -2, reason: 'sale' },
  ]);
  // الشاشة تعرض ما في القاعدة بعد الحفظ — لا الرقم الذي فُتحت عليه
  await expect(page.getByLabel('الكمية للمتغيّر 1')).toHaveValue('8');
});

test('الكمية التي يغيّرها البائع تُحفظ جرداً، وحفظ تالٍ بعد بيع لا يعيدها', async ({ page }) => {
  const v = await makeVendor(tag());
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  await openEditor(page, v.email, product.id);

  await page.getByLabel('الكمية للمتغيّر 1').fill('15');
  await page.getByRole('button', { name: 'احفظ', exact: true }).click();
  await expect(page.getByText('حُفظ المنتج.')).toBeVisible();
  expect(await onHand(v.variantId)).toBe(15);

  await sell(v.variantId, 2);
  await page.getByLabel('الوصف بالعربية').fill('وصف بعد الجرد.');
  await page.getByRole('button', { name: 'احفظ', exact: true }).click();
  await expect(page.getByLabel('الكمية للمتغيّر 1')).toHaveValue('13');

  expect(await onHand(v.variantId)).toBe(13);
  expect((await movements(v.variantId)).map((m) => `${m.reason}${m.delta}`)).toEqual(['import10', 'manual_adjust5', 'sale-2']);
});
