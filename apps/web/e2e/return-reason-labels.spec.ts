import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * سبب الإرجاع بالعربي في مسار الطلب عند البائع وفي إشعاره — BUY-047، بطلب صاحبة المشروع
 * (28 أكتوبر 2026). كان يُكتب رمزاً فيظهر «size_issue» و«damaged». وما حُفظ رمزاً قبلها يُقرأ بالعربي.
 */
const ADDRESS = { recipientName: 'مشترٍ يرجّع', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

async function call(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  expect(res.ok, `${path} ${res.status}`).toBe(true);
  return res.json();
}

test('«المقاس غير مناسب» لا «size_issue» في مسار البائع وإشعاره، والقديم المحفوظ رمزاً بالعربي', async ({ page, browser }) => {
  const t = tag();
  const v = await makeVendor(t);
  await signInBuyer(page, t);
  const access = (await page.evaluate(() => localStorage.getItem('basta.access')))!;
  const buyer = { authorization: `Bearer ${access}` };

  const cart = (await call('/cart', { currency: 'SAR' }, buyer)) as { token: string };
  const h = { ...buyer, 'x-cart-token': cart.token };
  await call('/cart/items', { variantId: v.variantId, qty: 1 }, h);
  const quote = (await call('/checkout/quote', { country: 'SA', region: 'الرياض', city: 'الرياض' }, h)) as { currency: string; totals: { total: { minorUnits: string } } };
  const order = (await call(
    '/checkout',
    { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
    { ...h, 'idempotency-key': crypto.randomUUID() },
  )) as { orderNumber: string };
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } }, include: { items: true } });
  const login = (await call('/auth/login', { email: v.email, password: PASSWORD })) as { tokens: { accessToken: string } };
  const seller = { authorization: `Bearer ${login.tokens.accessToken}` };
  for (const step of [{ to: 'accepted' }, { to: 'preparing' }, { to: 'ready_to_ship' }, { to: 'shipped', carrierCode: 'self', tracking: 'SELF-0048' }, { to: 'delivered' }]) {
    await call(`/vendor/orders/${sub.id}/transition`, step, seller);
  }
  await call(`/me/orders/${order.orderNumber}/stores/${sub.id}/return`, { items: [{ orderItemId: sub.items[0]!.id, qty: 1 }], reasonCode: 'size_issue' }, buyer);

  // إشعار البائع داخل الموقع بالعربي
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: v.email } });
  await expect
    .poll(async () => (await prisma.notification.findFirst({ where: { userId: owner.id, templateCode: 'return_requested', channel: 'in_app' } }))?.body ?? '', { timeout: 15_000 })
    .toContain('المقاس غير مناسب');

  // مسار الطلب عند البائع
  const vendorPage = await (await browser.newContext()).newPage();
  await vendorPage.goto(`/login?next=${encodeURIComponent(`/vendor/orders/${sub.id}`)}`);
  await vendorPage.getByLabel('البريد الإلكتروني').fill(v.email);
  await vendorPage.getByLabel('كلمة المرور').fill(PASSWORD);
  await vendorPage.getByRole('button', { name: 'دخول' }).click();
  const notes = vendorPage.locator('.vm-timeline__note');
  await expect(notes.filter({ hasText: 'المقاس غير مناسب' })).toHaveCount(1);
  await expect(notes.filter({ hasText: 'size_issue' })).toHaveCount(0);

  // سطر حُفظ رمزاً قبل التصليح يُقرأ بالعربي
  await prisma.subOrderStatusHistory.updateMany({ where: { subOrderId: sub.id, toStatus: 'return_requested' }, data: { reason: 'damaged' } });
  await vendorPage.reload();
  await expect(notes.filter({ hasText: 'وصل تالفاً' })).toHaveCount(1);
  await expect(notes.filter({ hasText: 'damaged' })).toHaveCount(0);
});
