import { expect, test, type Page } from '@playwright/test';
import { makeVendor, prisma, tag } from './fixtures';

/**
 * ما يُخصم هو الإجمالي الذي رآه المشتري تحت «ادفع»:
 * - تغيير العنوان بعد «احسب الشحن» يُسقط الإجمالي القديم ويوقف الدفع حتى يُحسب
 * - تغيّر المبلغ في الخادم (سعر، شحن، كوبون) يُعرض عليه قبل أي خصم
 */
async function toCheckout(page: Page, productSlug: string) {
  await page.goto(`/p/${encodeURIComponent(productSlug)}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await page.getByRole('link', { name: 'اذهب إلى السلة' }).click();
  await page.waitForURL((u) => u.pathname === '/cart');
  await page.getByRole('link', { name: 'إتمام الشراء' }).click();
  await page.getByLabel('اسم المستلم').fill('مشترٍ E2E');
  await page.getByLabel('الهاتف').fill('+966500000000');
  await page.getByLabel('البلد').selectOption('SA');
  await page.getByLabel('المحافظة / المنطقة').fill('الرياض');
  await page.getByLabel('المدينة').fill('الرياض');
  await page.getByLabel('الشارع ورقم البناء').fill('طريق الملك فهد 10');
  await page.getByLabel('البريد الإلكتروني').fill('e2e-total@basta.test');
}

async function calculate(page: Page): Promise<string> {
  const quoted = page.waitForResponse((r) => r.url().endsWith('/checkout/quote') && r.ok());
  await page.getByRole('button', { name: 'احسب الشحن' }).click();
  return (await (await quoted).json()).totals.total.minorUnits as string;
}

const payButton = (page: Page) => page.getByRole('button', { name: 'ادفع' });

test('تغيير العنوان بعد حساب الشحن يُسقط الإجمالي ويوقف الدفع حتى يُحسب من جديد', async ({ page }) => {
  const v = await makeVendor(tag());
  await toCheckout(page, v.productSlug);
  await calculate(page);
  await expect(page.locator('.sp-sum__total')).toBeVisible();
  await expect(payButton(page)).toBeEnabled();

  await page.getByLabel('المدينة').fill('جدة');
  await expect(page.locator('.sp-sum__total')).toHaveCount(0);
  await expect(payButton(page)).toBeDisabled();
  await expect(page.getByText('غيّرت العنوان — احسب الشحن من جديد')).toBeVisible();

  await calculate(page);
  await expect(page.locator('.sp-sum__total')).toBeVisible();
  await expect(payButton(page)).toBeEnabled();
});

test('تغيّر السعر بعد الحساب: لا خصم، يُعرض الإجمالي الجديد، ويُخصم هو بعد التأكيد', async ({ page }) => {
  const v = await makeVendor(tag());
  await toCheckout(page, v.productSlug);
  const before = await calculate(page);

  await prisma.productVariant.update({ where: { id: v.variantId }, data: { priceMinorUnits: 30_000n } });
  const requoted = page.waitForResponse((r) => r.url().endsWith('/checkout/quote') && r.ok());
  await payButton(page).click();
  await expect(page.getByText('تغيّر الإجمالي منذ حسبته')).toBeVisible();
  const after = (await (await requoted).json()).totals.total.minorUnits as string;
  expect(BigInt(after)).toBeGreaterThan(BigInt(before));
  expect(page.url()).toContain('/checkout');
  expect(await prisma.order.count({ where: { guestEmail: 'e2e-total@basta.test', grandTotalMinorUnits: BigInt(before) } })).toBe(0);

  await payButton(page).click();
  await page.waitForURL(/\/orders\//);
  const number = decodeURIComponent(page.url().split('/orders/')[1]!);
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: number }, include: { payment: true } });
  expect(order.grandTotalMinorUnits.toString()).toBe(after);
  expect(order.payment!.amountMinorUnits.toString()).toBe(after);
});
