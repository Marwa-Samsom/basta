import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, auditViews, makeAdmin, makeVendor, prisma, tag } from './fixtures';

/**
 * E2E — المرحلة 12: مسار الشراء ومسار التسوية كاملين، في متصفّح حقيقي، من
 * الواجهة لا من الواجهة البرمجية. كل خطوة ينقرها إنسان يُنقرها الاختبار.
 */

async function login(page: Page, email: string, next: string, totp?: () => string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  if (totp) {
    // الإدارة: الخادم يطلب الرمز فيظهر حقله — كما يراه المدير
    await page.getByLabel('رمز التحقق الثنائي').fill(totp());
    await page.getByRole('button', { name: 'دخول' }).click();
  }
  await page.waitForURL((u) => u.pathname.startsWith(next.split('?')[0]!));
}

async function guestBuys(page: Page, productSlug: string, productName: string): Promise<string> {
  await page.goto(`/p/${encodeURIComponent(productSlug)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(productName);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await page.getByRole('link', { name: 'اذهب إلى السلة' }).click();
  await expect(page.getByText(productName, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'إتمام الشراء' }).click();

  await page.getByLabel('اسم المستلم').fill('مشترٍ E2E');
  await page.getByLabel('الهاتف').fill('+966500000000');
  await page.getByLabel('البلد').selectOption('SA');
  await page.getByLabel('المحافظة / المنطقة').fill('الرياض');
  await page.getByLabel('المدينة').fill('الرياض');
  await page.getByLabel('الشارع ورقم البناء').fill('طريق الملك فهد 10');
  await page.getByLabel('البريد الإلكتروني').fill('e2e-buyer@basta.test');
  await page.getByRole('button', { name: 'احسب الشحن' }).click();
  await expect(page.getByText('الإجمالي').first()).toBeVisible();
  await page.getByRole('button', { name: 'ادفع' }).click();

  await page.waitForURL(/\/orders\//);
  await expect(page.getByText('تمّ طلبك')).toBeVisible();
  return decodeURIComponent(page.url().split('/orders/')[1]!);
}

test('مسار الشراء: ضيف من صفحة المنتج إلى تأكيد الطلب، والمخزون يُستهلك مرة واحدة', async ({ page }) => {
  const v = await makeVendor(tag());
  const number = await guestBuys(page, v.productSlug, v.productName);

  const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: number }, include: { subOrders: true, payment: true } });
  expect(order.status).toBe('processing');
  expect(order.payment?.status).toBe('captured');
  expect(order.subOrders).toHaveLength(1);
  expect(order.subOrders[0]!.status).toBe('awaiting_vendor');
  expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: v.variantId } })).onHand).toBe(9);
  expect(Object.values(await auditViews()).every((n) => n === 0)).toBe(true);
});

test('مسار التسوية: البائع يشحن ← يتحرّر رصيده ← يسحب ← الإدارة تحوّل — والدفتر محفوظ', async ({ browser }) => {
  const t = tag();
  const v = await makeVendor(t);
  const admin = await makeAdmin(t);

  const buyerPage = await (await browser.newContext()).newPage();
  const number = await guestBuys(buyerPage, v.productSlug, v.productName);
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: number } } });

  // --------------------------------------------------- البائع ينفّذ الطلب
  const vendorPage = await (await browser.newContext()).newPage();
  await login(vendorPage, v.email, '/vendor/orders');
  await vendorPage.getByRole('link', { name: sub.subOrderNumber }).click();
  for (const action of ['قبول الطلب', 'بدء التجهيز', 'جاهز للشحن']) {
    await vendorPage.getByRole('button', { name: action }).click();
    await expect(vendorPage.getByRole('button', { name: action })).toHaveCount(0);
  }
  await vendorPage.getByRole('button', { name: 'إصدار بوليصة' }).click();
  await expect(vendorPage.getByLabel('رقم التتبّع')).not.toHaveValue('');
  await vendorPage.getByRole('button', { name: 'تأكيد الشحن' }).click();
  await vendorPage.getByRole('button', { name: 'تأكيد التسليم' }).click();
  await expect(vendorPage.getByText('تم التسليم').first()).toBeVisible();

  // انقضاء فترة التعليق — الشيء الوحيد الذي لا ينتظره اختبار
  await prisma.subOrder.update({ where: { id: sub.id }, data: { holdReleaseAt: new Date(Date.now() - 60_000) } });

  // --------------------------------------------------- الإدارة تحرّر المستحق
  const adminPage = await (await browser.newContext()).newPage();
  await login(adminPage, admin.email, '/admin/payouts', admin.totp);
  await adminPage.getByRole('button', { name: 'تحرير المستحق الآن' }).click();
  await expect(adminPage.getByText('شُغّل تحرير الأرصدة المستحقة', { exact: false })).toBeVisible();

  // --------------------------------------------------- البائع يسحب متاحه كله
  await vendorPage.goto('/vendor/finance');
  await expect(vendorPage.getByText('متاح للسحب')).toBeVisible();
  await vendorPage.getByRole('button', { name: 'الكل' }).click();
  await vendorPage.getByRole('button', { name: 'اطلب السحب' }).click();
  await expect(vendorPage.getByText('أُرسل طلب سحب', { exact: false })).toBeVisible();

  // --------------------------------------------------- الإدارة توافق وتحوّل
  await adminPage.reload();
  const row = adminPage.getByRole('row', { name: new RegExp(`متجر ${t}`) });
  await row.getByRole('button', { name: 'موافقة' }).click();
  await adminPage.getByRole('tab', { name: 'موافَق — للتحويل' }).click();
  const approved = adminPage.getByRole('row', { name: new RegExp(`متجر ${t}`) });
  await approved.getByLabel('مرجع التحويل').fill(`TRX-${t}`);
  await approved.getByRole('button', { name: 'تسجيل التحويل' }).click();
  await expect(adminPage.getByText('سُجّل التحويل', { exact: false })).toBeVisible();

  // --------------------------------------------------- البائع يرى التحويل
  await vendorPage.reload();
  await expect(vendorPage.getByText('حُوِّل')).toBeVisible();
  await expect(vendorPage.getByText(`TRX-${t}`)).toBeVisible();

  // الدفتر: صافي البائع كاملاً مسحوب، والمتاح صفر، والحفظ سليم
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { vendorId_currency: { vendorId: v.vendorId, currency: 'SAR' } } });
  expect(wallet.balanceAvailableMinorUnits).toBe(0n);
  expect(wallet.balanceWithdrawnMinorUnits).toBe(sub.vendorNetMinorUnits);
  expect(Object.values(await auditViews()).every((n) => n === 0)).toBe(true);
});
