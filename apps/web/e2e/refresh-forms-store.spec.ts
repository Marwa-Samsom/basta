import { expect, test } from '@playwright/test';
import { PASSWORD, makeVendor, prisma, tag } from './fixtures';

/**
 * التحديث عند الرجوع في الصفحات التي فيها نماذج وفي المتجر (2 نوفمبر 2026، «اعمل الي ما لمستها»):
 * محرّر المنتج يُجلب من جديد ما دام البائع لم يعدّل فيه شيئاً — ولا يكتب فوق ما كُتب ولم يُحفظ؛
 * وصفحات المتجر (مرسومة على الخادم) يعاد رسمها بصمت.
 */

/** بيع كما يكتبه الدفع: المخزون ينقص وحركة sale بالفرق */
async function sell(variantId: string, qty: number): Promise<void> {
  await prisma.$transaction([
    prisma.inventory.update({ where: { variantId }, data: { onHand: { decrement: qty } } }),
    prisma.inventoryMovement.create({ data: { variantId, delta: -qty, reason: 'sale' } }),
  ]);
}

/** الرجوع من نافذة أخرى — والعدّاد يتجاهل ما يصل في الثانيتين الأوليين بعد آخر جلب */
async function comeBack(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForTimeout(2_500);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test('محرّر المنتج يتحدّث عند الرجوع ما دام لم يُعدَّل — وما كُتب ولم يُحفظ لا يُمسّ', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const { id: productId } = await prisma.product.findFirstOrThrow({ where: { slug: v.productSlug }, select: { id: true } });
  await page.goto(`/login?next=${encodeURIComponent(`/vendor/products/${productId}`)}`);
  // خادم التطوير يبني الصفحة عند أول طلب: كبسة قبل أن يُفعَّل النموذج ترسله كنموذج HTML عادي فيضيع
  await page.waitForLoadState('networkidle');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  const qty = page.getByLabel('الكمية للمتغيّر 1');
  await expect(qty).toHaveValue('10');

  // بيعت 3 والمحرّر مفتوح ولم يُعدَّل فيه شيء: يظهر 7 عند الرجوع
  await sell(v.variantId, 3);
  await comeBack(page);
  await expect(qty).toHaveValue('7', { timeout: 5_000 });

  // كتب اسماً ولم يحفظ، ثم بيعت 2: الرجوع لا يجلب — الاسم كما كُتب، والكمية كما على الشاشة
  const name = page.getByLabel('الاسم بالعربية *');
  await name.fill(`اسم كتبته ولم أحفظه ${t}`);
  await sell(v.variantId, 2);
  await comeBack(page);
  await page.waitForTimeout(1_500);
  await expect(name).toHaveValue(`اسم كتبته ولم أحفظه ${t}`);
  await expect(qty).toHaveValue('7');
});

test('صفحة المنتج في المتجر يعاد رسمها من الخادم عند الرجوع إليها — بلا F5', async ({ page }) => {
  const v = await makeVendor(tag());
  await page.goto(`/p/${v.productSlug}`);
  await page.waitForLoadState('networkidle');
  // إعادة الرسم بلا تحميل: طلب RSC للصفحة نفسها، والعنوان لا يتغيّر
  const rsc = page.waitForRequest((r) => r.headers()['rsc'] === '1' || r.url().includes('_rsc='), { timeout: 6_000 });
  await comeBack(page);
  await rsc;
  expect(new URL(page.url()).pathname).toBe(`/p/${v.productSlug}`);
});
