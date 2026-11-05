import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PASSWORD, makeVendor, prisma, register, tag } from './fixtures';

/**
 * تاريخ خطوة «تم الشحن» بعد إعادة الشحن — BUY-013، 4 نوفمبر 2026. رأت صاحبة المشروع طلباً تعذّر توصيله
 * ثم أعاد «غزة» شحنه اليوم، والمسار عند المشتري ما زال «تم الشحن · 2026/10/27»: التاريخ من أول مرة بلغ
 * فيها الطلب الحالة لا آخرها.
 */
test('بعد تعذّر التوصيل وإعادة الشحن: خطوة «تم الشحن» بتاريخ الشحن الأخير لا الأول', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const email = `buyer.${t}@basta.test`;
  const buyerId = await register(email, `مشترٍ ${t}`);
  // الشحن الأول في سنة أخرى كي لا يلتبس بتاريخ اليوم مهما كانت المنطقة الزمنية
  const first = new Date('2025-03-10T09:00:00Z');
  const failed = new Date('2025-03-12T09:00:00Z');
  const again = new Date();

  const order = await prisma.order.create({
    data: {
      orderNumber: `RS-${t}`.toUpperCase(),
      idempotencyKey: randomUUID(),
      customerUserId: buyerId,
      status: 'processing',
      currency: 'SAR',
      itemsSubtotalMinorUnits: 10_000n,
      grandTotalMinorUnits: 10_000n,
      placedAt: new Date('2025-03-09T09:00:00Z'),
      shippingAddressSnapshot: { recipientName: 'مستلم', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' },
    },
  });
  const sub = await prisma.subOrder.create({
    data: {
      orderId: order.id,
      vendorId: v.vendorId,
      subOrderNumber: `RS-${t}-1`.toUpperCase(),
      status: 'shipped',
      placedAt: new Date('2025-03-09T09:00:00Z'),
      settlementCurrency: 'SAR',
      fxRateSnapshot: 1,
      itemsSubtotalMinorUnits: 10_000n,
      totalMinorUnits: 10_000n,
      chargeTotalMinorUnits: 10_000n,
      commissionRateBpsSnapshot: 1000,
      commissionMinorUnits: 1_000n,
      vendorNetMinorUnits: 9_000n,
    },
  });
  await prisma.subOrderStatusHistory.createMany({
    data: [
      { subOrderId: sub.id, fromStatus: 'awaiting_vendor', toStatus: 'accepted', createdAt: new Date('2025-03-09T10:00:00Z') },
      { subOrderId: sub.id, fromStatus: 'accepted', toStatus: 'preparing', createdAt: new Date('2025-03-09T11:00:00Z') },
      { subOrderId: sub.id, fromStatus: 'preparing', toStatus: 'ready_to_ship', createdAt: new Date('2025-03-09T12:00:00Z') },
      { subOrderId: sub.id, fromStatus: 'ready_to_ship', toStatus: 'shipped', createdAt: first },
      { subOrderId: sub.id, fromStatus: 'shipped', toStatus: 'delivery_failed', createdAt: failed },
      { subOrderId: sub.id, fromStatus: 'delivery_failed', toStatus: 'shipped', createdAt: again },
    ],
  });

  try {
    await page.goto(`/login?next=${encodeURIComponent(`/account/orders/${order.orderNumber}`)}`);
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'دخول' }).click();

    const shipped = page.locator('.sp-track__step', { hasText: 'تم الشحن' }).locator('.sp-track__date');
    await expect(shipped).toContainText(String(again.getFullYear()));
    await expect(shipped).not.toContainText('2025');
    // والخطوات قبله على تواريخها كما هي
    await expect(page.locator('.sp-track__step', { hasText: 'قبله البائع' }).locator('.sp-track__date')).toContainText('2025');
  } finally {
    await prisma.subOrder.deleteMany({ where: { id: sub.id } });
    await prisma.order.deleteMany({ where: { id: order.id } });
  }
});
