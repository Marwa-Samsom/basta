import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PASSWORD, makeVendor, prisma, register, tag } from './fixtures';

/**
 * ما بقي من مهلة القبول — VOPS-003 و VON-057، 3 نوفمبر 2026. رأت صاحبة المشروع بـ «غزة» ثلاثة طلبات بانتظار
 * القبول، اثنان منها يُلغيان آلياً بعد ساعتين، وكلها بلا وقت باقٍ ولا لون: «الطلب الذي لا يُقبل خلال 48 ساعة
 * يُلغى آلياً» في الشريط والتفاصيل، والرئيسية لا تذكرها أصلاً — فلا يعرف التاجر أيّها يلحق أولاً.
 */

const HOUR = 3_600_000;

/** طلبات تنتظر القبول وصلت قبل كذا ساعة، لمتجر جديد — والباقي من المهلة = المهلة − ذلك */
async function seedWaiting(t: string, vendorId: string, hoursAgo: readonly number[]) {
  const buyerId = await register(`buyer.${t}@basta.test`, `مشترٍ ${t}`);
  const now = Date.now();
  const orderIds: string[] = [];
  const subs: { id: string; number: string }[] = [];
  for (const [i, ago] of hoursAgo.entries()) {
    const placedAt = new Date(now - ago * HOUR);
    const order = await prisma.order.create({
      data: {
        orderNumber: `AC-${t}-${i + 1}`.toUpperCase(),
        idempotencyKey: randomUUID(),
        customerUserId: buyerId,
        status: 'processing',
        currency: 'SAR',
        itemsSubtotalMinorUnits: 10_000n,
        grandTotalMinorUnits: 10_000n,
        placedAt,
        shippingAddressSnapshot: { recipientName: `مستلم ${i + 1}`, phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' },
      },
    });
    orderIds.push(order.id);
    const sub = await prisma.subOrder.create({
      data: {
        orderId: order.id,
        vendorId,
        subOrderNumber: `AC-${t}-${i + 1}-1`.toUpperCase(),
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
    subs.push({ id: sub.id, number: sub.subOrderNumber });
  }
  return {
    now,
    numbers: subs.map((s) => s.number),
    cleanup: async () => {
      await prisma.subOrder.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    },
  };
}

const acceptHours = async (): Promise<number> =>
  Number((await prisma.setting.findUnique({ where: { key: 'vendor_accept_timeout_hours' } }))?.valueJson ?? 48);

async function signIn(page: Page, email: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === next);
}

test('مهلة القبول: «بقي…» في كل صف منتظر وفي التفاصيل، يتناقص، بلون التحذير تحت يوم والخطر تحت ساعتين', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const hours = await acceptHours();
  // نصف ساعة فوق كل حدّ: الثواني بين الإنشاء والفتح لا تقلب الساعة المعروضة
  // بقي 47.5 ساعة — عادي، و18.5 — تحذير، وساعة ونصف — خطر
  const seed = await seedWaiting(t, v.vendorId, [hours - 47.5, hours - 18.5, hours - 1.5]);
  const [fresh, day, late] = seed.numbers as [string, string, string];

  try {
    await page.clock.install({ time: new Date(seed.now) });
    await signIn(page, v.email, '/vendor/orders');
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
    await seed.cleanup();
  }
});

test('الرئيسية: «طلبان ينتظران قبولك» وما بقي لأقربهما، وتفتح الطلبات على «بانتظار القبول» (VON-057)', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const hours = await acceptHours();
  // أقربهما بقي له 5.5 ساعة — تحذير؛ والآخر 30 ساعة
  const seed = await seedWaiting(t, v.vendorId, [hours - 30, hours - 5.5]);

  try {
    await page.clock.install({ time: new Date(seed.now) });
    await signIn(page, v.email, '/vendor');

    const card = page.locator('.alert', { hasText: 'طلبان ينتظران قبولك' });
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/alert--warning/);
    await expect(card).toContainText('بقي لأقربهما 5 ساعات');

    await card.getByRole('link', { name: 'افتح الطلبات المنتظرة' }).click();
    await page.waitForURL((u) => u.pathname === '/vendor/orders' && u.searchParams.get('status') === 'awaiting_vendor');
    await expect(page.getByRole('tab', { name: /^بانتظار القبول/ })).toHaveAttribute('aria-selected', 'true');
    for (const number of seed.numbers) await expect(page.locator('tr', { hasText: number })).toBeVisible();
  } finally {
    await seed.cleanup();
  }
});
