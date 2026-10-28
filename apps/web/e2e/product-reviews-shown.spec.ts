import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PASSWORD, makeVendor, prisma, signInBuyer, tag } from './fixtures';

/**
 * المراجعة تُرى — DISC-064 و BUY-070، 26 أكتوبر 2026.
 *
 * كانت المراجعة تُنشر بشارة «شراء موثّق» ولا تعرضها أي صفحة، و«تقييم المتجر» يبقى مخفياً (0)
 * مهما نُشر. والنجمة كانت تنشر بضغطة بلا رأي. وصاحب المتجر يشتري منه (21 أكتوبر) ولا يقيّمه.
 */

/**
 * ما يصنعه الاختبار مباشرة بلا قيد بيع يُمحى بعده — وإلا بقي في قاعدة التطوير نفسها فظهر في لوحة
 * الإدارة «طلب مدفوع بلا قيد بيع» مع كل تشغيل (لاحظته صاحبة المشروع، 28 أكتوبر 2026).
 * المراجعات تُمحى مع الطلب، فيعود تقييم منتج الاختبار ومتجره صفراً.
 */
const made: { orderId: string; productId: string; vendorId: string }[] = [];
test.afterEach(async () => {
  for (const m of made.splice(0)) {
    await prisma.order.delete({ where: { id: m.orderId } });
    await prisma.product.update({ where: { id: m.productId }, data: { ratingAvg: 0, ratingCount: 0 } });
    await prisma.vendor.update({ where: { id: m.vendorId }, data: { ratingAvg: 0, ratingCount: 0 } });
  }
});

/** طلب مُسلَّم من متجر الاختبار: سطر لكل قطعة، فلكل سطر مراجعته */
async function deliveredOrder(customerUserId: string, v: Awaited<ReturnType<typeof makeVendor>>, lines: number, t: string) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `RV-${t}`.toUpperCase(),
      idempotencyKey: randomUUID(),
      customerUserId,
      status: 'processing',
      currency: 'SAR',
      itemsSubtotalMinorUnits: 25_000n * BigInt(lines),
      grandTotalMinorUnits: 25_000n * BigInt(lines),
      shippingAddressSnapshot: { recipientName: 'مشترٍ E2E', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' },
    },
  });
  const sub = await prisma.subOrder.create({
    data: {
      orderId: order.id,
      vendorId: v.vendorId,
      subOrderNumber: `RV-${t}-1`.toUpperCase(),
      status: 'delivered',
      deliveredAt: new Date(),
      settlementCurrency: 'SAR',
      fxRateSnapshot: 1,
      itemsSubtotalMinorUnits: 25_000n * BigInt(lines),
      totalMinorUnits: 25_000n * BigInt(lines),
      chargeTotalMinorUnits: 25_000n * BigInt(lines),
      commissionRateBpsSnapshot: 1000,
      commissionMinorUnits: 2_500n * BigInt(lines),
      vendorNetMinorUnits: 22_500n * BigInt(lines),
    },
  });
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  made.push({ orderId: order.id, productId: product.id, vendorId: v.vendorId });
  const items = [];
  for (let i = 0; i < lines; i++) {
    items.push(
      await prisma.orderItem.create({
        data: {
          subOrderId: sub.id, orderId: order.id, vendorId: v.vendorId, variantId: v.variantId, productId: product.id,
          productNameSnapshotAr: v.productName, variantLabelSnapshot: 'أحمر / M', skuSnapshot: `E2E-${t}`,
          unitPriceMinorUnits: 25_000n, qty: 1, lineSubtotalMinorUnits: 25_000n, lineTotalMinorUnits: 25_000n,
          commissionBpsSnapshot: 1000, commissionMinorUnits: 2_500n,
        },
      }),
    );
  }
  return { order, product, items };
}

const signIn = async (page: Page, email: string, next: string) => {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
};

test('النجوم ثم الرأي ثم «انشر»: المراجعة في صفحة المنتج بشارتها، وتقييم المتجر يظهر، والعشر الأولى ثم «المزيد»', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const buyer = await signInBuyer(page, t);
  const { order, product, items } = await deliveredOrder(buyer.userId, v, 12, t);
  // إحدى عشرة مراجعة سابقة من الطلب نفسه (5 نجوم)، والثانية عشرة تُكتب من الصفحة
  for (const item of items.slice(1)) {
    await prisma.review.create({
      data: { orderItemId: item.id, productId: product.id, vendorId: v.vendorId, userId: buyer.userId, rating: 5, status: 'published', createdAt: new Date(Date.now() - 86_400_000) },
    });
  }

  await page.goto(`/account/orders/${order.orderNumber}`);
  const rate = page.getByRole('group', { name: 'قيّم المنتج' });
  await expect(rate).toHaveCount(1);
  // النجمة تختار ولا تنشر — كانت تنشر بضغطة بلا رأي
  await rate.getByRole('button', { name: '4 من 5' }).click();
  await expect(page.getByText('شكراً — نُشرت مراجعتك')).toHaveCount(0);
  await page.getByLabel('رأيك').fill('القماش ناعم والمقاس مظبوط');
  await page.getByRole('button', { name: 'انشر التقييم' }).click();
  await expect(page.getByText('شكراً — نُشرت مراجعتك بشارة «شراء موثّق».')).toBeVisible();
  const mine = await prisma.review.findUniqueOrThrow({ where: { orderItemId: items[0]!.id } });
  expect(mine).toMatchObject({ rating: 4, body: 'القماش ناعم والمقاس مظبوط', status: 'published' });

  await page.goto(`/p/${v.productSlug}`);
  const section = page.getByRole('region', { name: 'التقييمات' });
  // (11 × 5 + 4) / 12 = 4.9
  await expect(section.getByText('4.9', { exact: true })).toBeVisible();
  await expect(section.getByText('من 12 تقييماً')).toBeVisible();
  const list = section.getByRole('listitem').filter({ has: page.locator('.sd-review__meta') });
  await expect(list).toHaveCount(10);
  // الأحدث أولاً: ما كُتب الآن، بالاسم الأول وحده والمتغيّر والشارة
  const first = list.first();
  await expect(first.getByText('القماش ناعم والمقاس مظبوط')).toBeVisible();
  await expect(first.getByText('مشترٍ', { exact: true })).toBeVisible();
  await expect(first.getByText('أحمر / M')).toBeVisible();
  await expect(first.getByText('شراء موثّق')).toBeVisible();
  await expect(first.getByRole('img', { name: '4.0 من 5' })).toBeVisible();
  await expect(page.locator('.sd-pdp__byline')).toContainText('تقييم المتجر من 12');

  await section.getByRole('button', { name: 'المزيد' }).click();
  await expect(list).toHaveCount(12);
  await section.getByRole('button', { name: 'السابق' }).click();
  await expect(list).toHaveCount(10);
});

test('صاحب المتجر يشتري منه ولا تظهر له نجوم التقييم — ومنتج بلا مراجعات يقول ذلك', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const { order } = await deliveredOrder(v.userId, v, 1, t);

  await signIn(page, v.email, `/account/orders/${order.orderNumber}`);
  await expect(page.getByRole('heading', { name: order.orderNumber })).toBeVisible();
  await expect(page.getByText(v.productName)).toBeVisible();
  await expect(page.getByRole('group', { name: 'قيّم المنتج' })).toHaveCount(0);

  await page.goto(`/p/${v.productSlug}`);
  await expect(page.getByRole('region', { name: 'التقييمات' }).getByText('لا تقييمات بعد.', { exact: false })).toBeVisible();
});
