import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PASSWORD, makeVendor, prisma, register, tag } from './fixtures';

/**
 * بلا شركة شحن (SHIPPING_CARRIER=none): زرّ «إصدار بوليصة» كان يوحي بمندوب يأتي
 * لاستلام الطرد، ثم تعلّم الشركة الوهمية الشحنة «سُلّمت» وحدها. الآن الشاشة تسأل
 * الخادم عن الشركات الموصولة: لا شركة ← لا زرّ، والبائع يكتب مرجع توصيله ويؤكّد
 * التسليم بنفسه. (خادم الاختبار يعمل بالوهمية، فتُعترض قائمته كما يردّ بلا شركة.)
 */
test('بلا شركة شحن: لا زرّ بوليصة، والبائع يشحن بمرجعه ثم يؤكّد التسليم', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const buyerId = await register(`buyer.${t}@basta.test`, `مشترٍ ${t}`);
  const order = await prisma.order.create({
    data: {
      orderNumber: `SD-${t}`.toUpperCase(),
      idempotencyKey: randomUUID(),
      customerUserId: buyerId,
      status: 'processing',
      currency: 'SAR',
      itemsSubtotalMinorUnits: 25_000n,
      grandTotalMinorUnits: 26_500n,
      shippingAddressSnapshot: { recipientName: 'مشترٍ E2E', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' },
    },
  });
  const sub = await prisma.subOrder.create({
    data: {
      orderId: order.id,
      vendorId: v.vendorId,
      subOrderNumber: `SD-${t}-1`.toUpperCase(),
      status: 'ready_to_ship',
      settlementCurrency: 'SAR',
      fxRateSnapshot: 1,
      itemsSubtotalMinorUnits: 25_000n,
      totalMinorUnits: 26_500n,
      chargeTotalMinorUnits: 26_500n,
      commissionRateBpsSnapshot: 1000,
      commissionMinorUnits: 2_500n,
      vendorNetMinorUnits: 24_000n,
    },
  });

  try {
    await page.route(
      (url) => url.pathname.endsWith('/vendor/shipping/carriers'),
      (route) => route.fulfill({ json: [{ code: 'self', nameAr: 'توصيل ذاتي' }] }),
    );
    await page.goto(`/login?next=${encodeURIComponent(`/vendor/orders/${sub.id}`)}`);
    await page.getByLabel('البريد الإلكتروني').fill(v.email);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'دخول' }).click();

    await expect(page.getByText('التوصيل ذاتي: سلّم الطلب بنفسك أو بمندوبك')).toBeVisible();
    await expect(page.getByRole('button', { name: 'إصدار بوليصة' })).toHaveCount(0);
    await page.getByLabel('مرجع التوصيل').fill('إيصال-4471');
    await page.getByRole('button', { name: 'تأكيد الشحن' }).click();
    await expect.poll(async () => (await prisma.subOrder.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('shipped');
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { subOrderId: sub.id } });
    expect(shipment).toMatchObject({ carrierCode: 'self', trackingNumber: 'إيصال-4471' });
    // بعد الشحن: المرجع بعنوانه والناقل باسمه، لا «رقم التتبّع» ولا الرمز الخام «self» (BUY-015)
    await expect(page.getByRole('term').filter({ hasText: 'مرجع التوصيل' })).toBeVisible();
    await expect(page.getByText('توصيل ذاتي', { exact: true })).toBeVisible();
    await expect(page.getByText('self', { exact: true })).toHaveCount(0);

    // التسليم يؤكّده البائع — لا مهمة تعلّمه وحدها
    await page.getByRole('button', { name: 'تأكيد التسليم' }).click();
    await expect.poll(async () => (await prisma.subOrder.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('delivered');
  } finally {
    // طلب مصنوع بلا دفع ولا دفتر: يبقى فيظهر في مراقبات الانحراف (audit_sub_order_without_ledger)
    await prisma.shipment.deleteMany({ where: { subOrderId: sub.id } });
    await prisma.subOrderStatusHistory.deleteMany({ where: { subOrderId: sub.id } });
    await prisma.subOrder.delete({ where: { id: sub.id } });
    await prisma.order.delete({ where: { id: order.id } });
  }
});
