import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PASSWORD, makeVendor, prisma, register, tag } from './fixtures';

/**
 * ما بقي من مهلة القبول — VOPS-003، 3 نوفمبر 2026. رأت صاحبة المشروع بـ «غزة» ثلاثة طلبات بانتظار القبول،
 * اثنان منها يُلغيان آلياً بعد ساعتين، وكلها بلا وقت باقٍ ولا لون: «الطلب الذي لا يُقبل خلال 48 ساعة
 * يُلغى آلياً» في الشريط والتفاصيل، فلا يعرف التاجر أيّها يلحق أولاً.
 */
test('مهلة القبول: «بقي…» في كل صف منتظر وفي التفاصيل، يتناقص، بلون التحذير تحت يوم والخطر تحت ساعتين', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const buyerId = await register(`buyer.${t}@basta.test`, `مشترٍ ${t}`);
  const hours = Number((await prisma.setting.findUnique({ where: { key: 'vendor_accept_timeout_hours' } }))?.valueJson ?? 48);
  const now = Date.now();
  const orderIds: string[] = [];
  const subIds: string[] = [];

  /** طلب ينتظر القبول وصل قبل كذا ساعة — والباقي من المهلة = المهلة − ذلك */
  const waiting = async (n: number, hoursAgo: number): Promise<string> => {
    const placedAt = new Date(now - hoursAgo * 3_600_000);
    const order = await prisma.order.create({
      data: {
        orderNumber: `AC-${t}-${n}`.toUpperCase(),
        idempotencyKey: randomUUID(),
        customerUserId: buyerId,
        status: 'processing',
        currency: 'SAR',
        itemsSubtotalMinorUnits: 10_000n,
        grandTotalMinorUnits: 10_000n,
        placedAt,
        shippingAddressSnapshot: { recipientName: `مستلم ${n}`, phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' },
      },
    });
    orderIds.push(order.id);
    const sub = await prisma.subOrder.create({
      data: {
        orderId: order.id,
        vendorId: v.vendorId,
        subOrderNumber: `AC-${t}-${n}-1`.toUpperCase(),
        status: 'awaiting_vendor',
        placedAt,
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
    subIds.push(sub.id);
    return sub.subOrderNumber;
  };

  try {
    // نصف ساعة فوق كل حدّ: الثواني بين الإنشاء والفتح لا تقلب الساعة المعروضة
    const fresh = await waiting(1, hours - 47.5); // بقي 47.5 ساعة — عادي
    const day = await waiting(2, hours - 18.5); // بقي 18.5 ساعة — تحذير
    const late = await waiting(3, hours - 1.5); // بقي ساعة ونصف — خطر

    await page.clock.install({ time: new Date(now) });
    await page.goto('/login?next=/vendor/orders');
    await page.getByLabel('البريد الإلكتروني').fill(v.email);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForURL((u) => u.pathname === '/vendor/orders');
    await page.getByRole('tab', { name: /^بانتظار القبول/ }).click();

    const left = (number: string) => page.locator('tr', { hasText: number }).locator('.vm-countdown');
    await expect(left(fresh)).toHaveText('بقي 47 ساعة');
    await expect(left(fresh)).toHaveAttribute('data-tone', 'normal');
    await expect(left(day)).toHaveText('بقي 18 ساعة');
    await expect(left(day)).toHaveAttribute('data-tone', 'warning');
    await expect(left(late)).toHaveText(/^بقي ساعة و\d+ دقيقة$/);
    await expect(left(late)).toHaveAttribute('data-tone', 'danger');

    // يتناقص وحده بلا إعادة تحميل: بعد 45 دقيقة بقيت 45 دقيقة أو أقل بقليل
    await page.clock.fastForward('45:00');
    await expect(left(late)).toHaveText(/^بقي 4[45] دقيقة$/);

    // والعدّاد نفسه في التفاصيل، والتنبيه بلون الخطر
    await page.locator('tr', { hasText: late }).getByRole('link').first().click();
    await expect(page.locator('.alert--danger .alert__title')).toHaveText(/^بقي 4[45] دقيقة على الإلغاء الآلي$/);
    await expect(page.getByText(`اقبل الطلب أو ارفضه خلال ${hours} ساعة من وصوله، وإلا أُلغي آلياً.`)).toBeVisible();
  } finally {
    await prisma.subOrder.deleteMany({ where: { id: { in: subIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
});
