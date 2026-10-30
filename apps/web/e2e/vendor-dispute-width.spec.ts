import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * خيط النزاع عند البائع بعرض المحتوى كالتصميم VD-14 — كان سقفه 960px فيبقى نصف الشاشة العريضة فارغاً
 * (VOPS-056، 29 أكتوبر 2026).
 */
test.use({ viewport: { width: 1600, height: 900 } });

const ADDRESS = { recipientName: 'سلمى النزاع', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

test('خيط النزاع يملأ عرض المحتوى على شاشة عريضة', async ({ page }) => {
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
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } } });

  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto('/login?next=/vendor/disputes');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/disputes');

  // البائع يسلّمه، والمشتري يفتح نزاعاً
  const seller = { authorization: `Bearer ${(await page.evaluate(() => localStorage.getItem('basta.access')))!}` };
  for (const step of [{ to: 'accepted' }, { to: 'preparing' }, { to: 'ready_to_ship' }, { to: 'shipped', carrierCode: 'self', tracking: 'MANDOOB-E2E' }, { to: 'delivered' }]) {
    await post(`/vendor/orders/${sub.id}/transition`, step, seller);
  }
  const message = `وصل المنتج مكسوراً ${t}`;
  await post('/me/disputes', { subOrderId: sub.id, reasonCode: 'damaged', message }, buyer);
  const dispute = await prisma.dispute.findFirstOrThrow({ where: { subOrderId: sub.id } });

  await page.goto(`/vendor/disputes/${dispute.id}`);
  await expect(page.getByText(message)).toBeVisible();
  const [box, room] = await page.locator('.vm-dispute').evaluate((el) => {
    const p = el.parentElement as HTMLElement;
    const s = getComputedStyle(p);
    return [el.getBoundingClientRect().width, p.clientWidth - parseFloat(s.paddingInlineStart) - parseFloat(s.paddingInlineEnd)];
  });
  expect(box).toBeGreaterThan(1000);
  expect(Math.abs(box - room)).toBeLessThan(2);
});
