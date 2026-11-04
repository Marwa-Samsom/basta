import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PASSWORD, makeVendor, prisma, register, tag } from './fixtures';

/**
 * صفحة تتبّع الشحنة يصلها رابط — BUY-092، 4 نوفمبر 2026. سألت صاحبة المشروع «وين بلاقي تتبّع الطلب مش من
 * طلباتي»: /track لا يصلها رابط من الرأس ولا الذيل ولا تفاصيل الطلب ولا إشعار الشحن، فلا تُفتح إلا بكتابة
 * عنوانها — وهي نفسها تقول «تجده في رسالة الشحن من المتجر أو في تفاصيل طلبك».
 */

const tracking = (trackingNumber: string, status: string) => ({
  carrierCode: 'basta-express',
  carrierName: 'بسطة إكسبرس',
  trackingNumber,
  status,
  shippedAt: null,
  deliveredAt: null,
  events: [],
});

test('«تتبّع شحنتك» في ذيل المتجر، و/track?number= يبحث وحده ويكتب الرقم في العنوان', async ({ page }) => {
  await page.route('**/api/v1/track/BX-E2E-1', (r) => r.fulfill({ json: tracking('BX-E2E-1', 'created') }));
  await page.route('**/api/v1/track/BX-E2E-2', (r) => r.fulfill({ json: tracking('BX-E2E-2', 'in_transit') }));

  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'تتبّع شحنتك' }).click();
  await page.waitForURL((u) => u.pathname === '/track');

  // رابط بالرقم جاهزاً: النتيجة بلا كبس
  await page.goto('/track?number=BX-E2E-1');
  await expect(page.getByLabel('رقم التتبّع')).toHaveValue('BX-E2E-1');
  await expect(page.getByText('بانتظار استلام شركة الشحن')).toBeVisible();

  // والبحث بيدها يكتب الرقم في العنوان، فيُنسخ الرابط ويُرسل
  await page.getByLabel('رقم التتبّع').fill('BX-E2E-2');
  await page.getByRole('button', { name: 'تتبّع الشحنة' }).click();
  await expect(page.getByText('في الطريق', { exact: true }).first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('number')).toBe('BX-E2E-2');
});

test('تفاصيل الطلب: «تتبّع الشحنة» لشحنة الشركة يفتح /track بالرقم، ولا رابط للتوصيل الذاتي', async ({ page }) => {
  const t = tag();
  const carrierShop = await makeVendor(t);
  const selfShop = await makeVendor(`${t}s`);
  const email = `buyer.${t}@basta.test`;
  const buyerId = await register(email, `مشترٍ ${t}`);
  const number = `TL-${t}`.toUpperCase();
  const tn = `BX${t}`.toUpperCase();

  const order = await prisma.order.create({
    data: {
      orderNumber: number,
      idempotencyKey: randomUUID(),
      customerUserId: buyerId,
      status: 'processing',
      currency: 'SAR',
      itemsSubtotalMinorUnits: 20_000n,
      grandTotalMinorUnits: 20_000n,
      shippingAddressSnapshot: { recipientName: 'مستلم', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' },
    },
  });
  const sub = (vendorId: string, n: number) =>
    prisma.subOrder.create({
      data: {
        orderId: order.id,
        vendorId,
        subOrderNumber: `${number}-${n}`,
        status: 'shipped',
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
  const carried = await sub(carrierShop.vendorId, 1);
  const selfDelivered = await sub(selfShop.vendorId, 2);
  await prisma.shipment.create({ data: { subOrderId: carried.id, carrierCode: 'basta-express', trackingNumber: tn, status: 'in_transit', shippedAt: new Date() } });
  await prisma.shipment.create({ data: { subOrderId: selfDelivered.id, carrierCode: 'self', trackingNumber: `ref-${t}`, status: 'in_transit', shippedAt: new Date() } });

  try {
    await page.goto(`/login?next=${encodeURIComponent(`/account/orders/${number}`)}`);
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'دخول' }).click();

    await expect(page.locator('.sp-ship')).toHaveCount(2);
    const link = page.getByRole('link', { name: 'تتبّع الشحنة' });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', `/track?number=${tn}`);

    await link.click();
    await page.waitForURL((u) => u.pathname === '/track');
    await expect(page.getByLabel('رقم التتبّع')).toHaveValue(tn);
    await expect(page.getByText('في الطريق', { exact: true }).first()).toBeVisible();
  } finally {
    await prisma.subOrder.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { id: order.id } });
  }
});
