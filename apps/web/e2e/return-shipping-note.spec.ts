import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * الشحن لا يُردّ في أي إرجاع، كاملاً كان أو جزئياً — BUY-040، بطلب صاحبة المشروع (28 أكتوبر 2026).
 * كانت الجملة «لا يُردّ الشحن في الإرجاع الجزئي» عند المشتري والبائع، فتوحي بردّه في الإرجاع الكامل.
 */
const ADDRESS = { recipientName: 'مشترٍ يرجّع', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

async function call(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  expect(res.ok, `${path} ${res.status}`).toBe(true);
  return res.json();
}

test('مربّع طلب الإرجاع وملاحظة «استلمت المرتجع»: الشحن لا يُردّ، بلا «الجزئي»', async ({ page, browser }) => {
  const t = tag();
  const v = await makeVendor(t);
  await signInBuyer(page, t);
  const access = (await page.evaluate(() => localStorage.getItem('basta.access')))!;
  const buyer = { authorization: `Bearer ${access}` };

  // طلب بالبطاقة، ثم يوصله البائع حتى «تم التسليم»
  const cart = (await call('/cart', { currency: 'SAR' }, buyer)) as { token: string };
  const h = { ...buyer, 'x-cart-token': cart.token };
  await call('/cart/items', { variantId: v.variantId, qty: 2 }, h);
  const quote = (await call('/checkout/quote', { country: 'SA', region: 'الرياض', city: 'الرياض' }, h)) as { currency: string; totals: { total: { minorUnits: string } } };
  const order = (await call(
    '/checkout',
    { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
    { ...h, 'idempotency-key': crypto.randomUUID() },
  )) as { orderNumber: string };
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } } });
  const login = (await call('/auth/login', { email: v.email, password: PASSWORD })) as { tokens: { accessToken: string } };
  const seller = { authorization: `Bearer ${login.tokens.accessToken}` };
  for (const step of [{ to: 'accepted' }, { to: 'preparing' }, { to: 'ready_to_ship' }, { to: 'shipped', carrierCode: 'self', tracking: 'SELF-4040' }, { to: 'delivered' }]) {
    await call(`/vendor/orders/${sub.id}/transition`, step, seller);
  }

  // المشتري: مربّع طلب الإرجاع
  await page.goto(`/account/orders/${order.orderNumber}`);
  await page.getByRole('button', { name: 'طلب إرجاع' }).click();
  const panel = page.locator('.sp-panel', { hasText: 'اختر القطع وكمياتها' });
  await expect(panel).toContainText('يُردّ ثمنها فور استلام البائع لها — الشحن لا يُردّ لأن الشحنة وصلتك.');
  await expect(panel).not.toContainText('الإرجاع الجزئي');
  await panel.locator('select').first().selectOption('2');
  await page.getByRole('button', { name: 'أرسل طلب الإرجاع' }).click();
  await expect(page.getByText('أُرسل طلب الإرجاع للبائع.')).toBeVisible();

  // البائع: ملاحظة «استلمت المرتجع»
  const vendorPage = await (await browser.newContext()).newPage();
  await vendorPage.goto(`/login?next=${encodeURIComponent(`/vendor/orders/${sub.id}`)}`);
  await vendorPage.getByLabel('البريد الإلكتروني').fill(v.email);
  await vendorPage.getByLabel('كلمة المرور').fill(PASSWORD);
  await vendorPage.getByRole('button', { name: 'دخول' }).click();
  const hint = vendorPage.locator('.vm-hint', { hasText: 'عند الاستلام تعود القطع للمخزون' });
  await expect(hint).toHaveText('عند الاستلام تعود القطع للمخزون ويُردّ ثمنها للمشتري آلياً. الشحن لا يُردّ في الإرجاع.');
});
