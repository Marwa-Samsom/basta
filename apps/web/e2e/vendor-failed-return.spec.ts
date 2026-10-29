import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * شحنة «تعذّر التوصيل» عادت للمتجر: زرّ «أرجعه للمتجر» كالتصميم VD-13 يجعلها «مُرجَع» ثم «مُسترَد» — القطع
 * للمخزون وكل المبلغ للمشتري. كان الخادم يقبل الانتقال والواجهة تخفي زرّه، فلا يملك البائع إلا إعادة الشحن
 * (VOPS-036، 29 أكتوبر 2026).
 */
const ADDRESS = { recipientName: 'سلمى العائدة', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

test('«أرجعه للمتجر» على «تعذّر التوصيل»: القطعتان للمخزون والمبلغ كله للمشتري', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  await signInBuyer(page, t);
  const post = async (path: string, body: unknown, headers: Record<string, string>) => {
    const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect(res.ok, `${path} ${res.status}`).toBe(true);
    return res.json();
  };
  const buyer = { authorization: `Bearer ${(await page.evaluate(() => localStorage.getItem('basta.access')))!}` };
  const cart = (await post('/cart', { currency: 'SAR' }, buyer)) as { token: string };
  const h = { ...buyer, 'x-cart-token': cart.token };
  await post('/cart/items', { variantId: v.variantId, qty: 2 }, h);
  const quote = (await post('/checkout/quote', { country: 'SA', region: 'الرياض', city: 'الرياض' }, h)) as { currency: string; totals: { total: { minorUnits: string } } };
  const order = (await post(
    '/checkout',
    { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
    { ...h, 'idempotency-key': crypto.randomUUID() },
  )) as { orderNumber: string };
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } } });

  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto(`/login?next=${encodeURIComponent(`/vendor/orders/${sub.id}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === `/vendor/orders/${sub.id}`);

  // البائع يشحنه بتوصيله الذاتي ثم يتعذّر التوصيل
  const seller = { authorization: `Bearer ${(await page.evaluate(() => localStorage.getItem('basta.access')))!}` };
  for (const step of [{ to: 'accepted' }, { to: 'preparing' }, { to: 'ready_to_ship' }, { to: 'shipped', carrierCode: 'self', tracking: 'MANDOOB-E2E' }, { to: 'delivery_failed' }]) {
    await post(`/vendor/orders/${sub.id}/transition`, step, seller);
  }
  expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: v.variantId } })).onHand).toBe(8);

  await page.reload();
  await expect(page.locator('.vm-status')).toHaveText('تعذّر التوصيل');
  await page.getByRole('button', { name: 'أرجعه للمتجر' }).click();
  await expect(page.locator('.vm-status')).toHaveText('مُسترَد');
  await expect(page.getByRole('button', { name: 'أرجعه للمتجر' })).toHaveCount(0);

  const done = await prisma.subOrder.findUniqueOrThrow({ where: { id: sub.id }, include: { refunds: true } });
  expect(done.status).toBe('refunded');
  expect(done.refunds).toHaveLength(1);
  expect(done.refunds[0]!.reason).toBe('تعذّر التوصيل');
  expect(done.refunds[0]!.amountMinorUnits).toBe(done.chargeTotalMinorUnits);
  expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: v.variantId } })).onHand).toBe(10);
  const back = await prisma.inventoryMovement.findFirstOrThrow({ where: { variantId: v.variantId, reason: 'return' } });
  expect(back.delta).toBe(2);
});
