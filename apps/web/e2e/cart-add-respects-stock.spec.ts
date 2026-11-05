import { expect, test } from '@playwright/test';
import { makeVendor, prisma, tag } from './fixtures';

/**
 * «أضف إلى السلة» يحترم المتاح مع ما في السلة — CHK-013، 5 نوفمبر 2026. «زد» يقف عند المتاح في الكبسة
 * الواحدة، لكن الخادم كان يقبل كل كبسة: 3 ثم 3 ثم 3… صارت 21 والمتاح 3، و«أُضيف إلى سلّتك» كل مرة.
 * الآن ترفض الكبسة الثانية بسببها تحت الزرّ، والسلة تبقى 3. (تسجيل واحد في makeVendor — لا دخول.)
 */
test('صفحة المنتج: الكبسة الثانية فوق المتاح تقول السبب تحت الزرّ، والسلة تبقى 3', async ({ page }) => {
  const v = await makeVendor(tag());
  // المخزون بحركته كما يُنقصه البائع — onHand وحده يترك انحرافاً يُسقط فحص التدقيق الليلي (db-guards)
  await prisma.inventory.update({ where: { variantId: v.variantId }, data: { onHand: 3 } });
  await prisma.inventoryMovement.create({ data: { variantId: v.variantId, delta: -7, reason: 'manual_adjust' } });
  await page.goto(`/p/${v.productSlug}`);

  const increase = page.getByRole('button', { name: 'زد' });
  await increase.click();
  await increase.click();
  await expect(increase).toBeDisabled();
  await expect(page.getByText('بلغت الحد المتاح')).toBeVisible();

  const add = page.getByRole('button', { name: 'أضف إلى السلة' });
  await add.click();
  await expect(page.getByText('أُضيف إلى سلّتك.')).toBeVisible();

  await add.click();
  await expect(page.getByRole('alert').filter({ hasText: 'في سلّتك 3 من هذا الخيار — المتاح 3 فقط.' })).toBeVisible();

  // عدّاد الرأس مجموع الكميات: 3 لا 6
  await expect(page.getByLabel(/^السلة — 3/).first()).toBeVisible();
});
