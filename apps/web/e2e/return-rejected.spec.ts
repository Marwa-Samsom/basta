import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * رفض البائع للإرجاع يصل المشتري — BUY-047، بطلب صاحبة المشروع (28 أكتوبر 2026).
 * كانت الشارة ترجع «تم التسليم» بلا تفسير: لا إشعار ولا بريد، والسبب الذي يكتبه البائع تحت
 * «يُعرض للمشتري» لا يُعرض. الآن: السبب على طلب الإرجاع، وإشعار وبريد، وسطر في البطاقة.
 */
const ADDRESS = { recipientName: 'مشترٍ رُفض إرجاعه', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };
const REASON = 'القطعة مستعملة وليست في غلافها';

async function call(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  expect(res.ok, `${path} ${res.status} ${res.ok ? '' : await res.text()}`).toBe(true);
  return res.json();
}

test('رفض الإرجاع: سطر بسببه في البطاقة، وإشعار وبريد، ويختفي السطر مع إرجاع جديد', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const { userId } = await signInBuyer(page, t);
  const access = (await page.evaluate(() => localStorage.getItem('basta.access')))!;
  const buyer = { authorization: `Bearer ${access}` };

  const cart = (await call('/cart', { currency: 'SAR' }, buyer)) as { token: string };
  const h = { ...buyer, 'x-cart-token': cart.token };
  await call('/cart/items', { variantId: v.variantId, qty: 2 }, h);
  const quote = (await call('/checkout/quote', { country: 'SA', region: 'الرياض', city: 'الرياض' }, h)) as { currency: string; totals: { total: { minorUnits: string } } };
  const order = (await call(
    '/checkout',
    { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
    { ...h, 'idempotency-key': crypto.randomUUID() },
  )) as { orderNumber: string };
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } }, include: { items: true } });
  const login = (await call('/auth/login', { email: v.email, password: PASSWORD })) as { tokens: { accessToken: string } };
  const seller = { authorization: `Bearer ${login.tokens.accessToken}` };
  for (const step of [{ to: 'accepted' }, { to: 'preparing' }, { to: 'ready_to_ship' }, { to: 'shipped', carrierCode: 'self', tracking: 'SELF-0047' }, { to: 'delivered' }]) {
    await call(`/vendor/orders/${sub.id}/transition`, step, seller);
  }
  const returnOne = { items: [{ orderItemId: sub.items[0]!.id, qty: 1 }], reasonCode: 'size_issue' };
  await call(`/me/orders/${order.orderNumber}/stores/${sub.id}/return`, returnOne, buyer);
  await call(`/vendor/orders/${sub.id}/return/deny`, { reason: REASON }, seller);

  // البطاقة: الرفض وسببه، و«لديّ مشكلة» متاح
  await page.goto(`/account/orders/${order.orderNumber}`);
  const card = page.locator('.sp-store');
  await expect(card.locator('.sp-store__head .badge')).toHaveText('تم التسليم');
  const rejected = card.getByRole('status').filter({ hasText: 'رفض المتجر طلب الإرجاع' });
  await expect(rejected).toContainText(`السبب: «${REASON}».`);
  await expect(rejected).toContainText('إن لم توافق على الرفض، افتح «لديّ مشكلة».');
  await expect(card.getByRole('button', { name: 'لديّ مشكلة' })).toBeVisible();

  // إشعار داخل الموقع وبريد بالرفض وسببه
  await expect
    .poll(async () => (await prisma.notification.findMany({ where: { userId, templateCode: 'return_rejected' }, select: { channel: true } })).map((n) => n.channel).sort(), { timeout: 15_000 })
    .toEqual(['email', 'in_app']);
  await expect
    .poll(async () => (await prisma.notification.findFirst({ where: { userId, templateCode: 'return_rejected', channel: 'in_app' } }))?.status, { timeout: 20_000 })
    .toBe('sent');
  await page.goto('/account/notifications');
  const item = page.locator('li, article').filter({ hasText: 'رُفض طلب الإرجاع' }).first();
  await expect(item).toContainText(`السبب: «${REASON}».`);

  // إرجاع جديد للقطعة نفسها مقبول، والسطر يختفي
  await call(`/me/orders/${order.orderNumber}/stores/${sub.id}/return`, returnOne, buyer);
  await page.goto(`/account/orders/${order.orderNumber}`);
  await expect(page.locator('.sp-store__head .badge')).toHaveText('طلب إرجاع');
  await expect(page.getByText('رفض المتجر طلب الإرجاع')).toHaveCount(0);
});
