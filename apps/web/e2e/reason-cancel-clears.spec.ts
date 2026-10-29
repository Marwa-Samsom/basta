import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * «تراجع» يمسح خانة السبب: إعادة فتحها تبدأ فارغة. كان يغلقها ويُبقي ما كُتب، فكتبت صاحبة المشروع «مكسو»
 * ثم «تراجع» ثم أعادت الفتح وكتبت السبب — فوصل المشتري «مكسو«الغطاء كان سليم…»» (VOPS-044، 29 أكتوبر 2026).
 */
const ADDRESS = { recipientName: 'سلمى الراجعة', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

test('«تراجع» يمسح سبب رفض الإرجاع — لا يصل المشتري ما تُرك', async ({ page }) => {
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
  await post('/cart/items', { variantId: v.variantId, qty: 1 }, h);
  const quote = (await post('/checkout/quote', { country: 'SA', region: 'الرياض', city: 'الرياض' }, h)) as { currency: string; totals: { total: { minorUnits: string } } };
  const order = (await post(
    '/checkout',
    { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
    { ...h, 'idempotency-key': crypto.randomUUID() },
  )) as { orderNumber: string };
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } }, include: { items: true } });

  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto(`/login?next=${encodeURIComponent(`/vendor/orders/${sub.id}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === `/vendor/orders/${sub.id}`);

  // البائع يسلّمه، والمشتري يطلب إرجاعه
  const seller = { authorization: `Bearer ${(await page.evaluate(() => localStorage.getItem('basta.access')))!}` };
  for (const step of [{ to: 'accepted' }, { to: 'preparing' }, { to: 'ready_to_ship' }, { to: 'shipped', carrierCode: 'self', tracking: 'MANDOOB-E2E' }, { to: 'delivered' }]) {
    await post(`/vendor/orders/${sub.id}/transition`, step, seller);
  }
  await post(`/me/orders/${order.orderNumber}/stores/${sub.id}/return`, { items: [{ orderItemId: sub.items[0]!.id, qty: 1 }], reasonCode: 'damaged' }, buyer);
  await page.reload();

  const field = page.getByLabel('سبب رفض الإرجاع — يُعرض للمشتري');
  await page.getByRole('button', { name: 'رفض الإرجاع' }).click();
  await field.fill('مكسو');
  await page.getByRole('button', { name: 'تراجع' }).click();
  await expect(field).toHaveCount(0);

  await page.getByRole('button', { name: 'رفض الإرجاع' }).click();
  await expect(field).toHaveValue('');
  await expect(page.getByRole('button', { name: 'تأكيد الرفض' })).toBeDisabled();
});
