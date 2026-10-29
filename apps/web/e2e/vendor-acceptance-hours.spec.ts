import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * مهلة القبول في شاشتي البائع كما تضبطها الإدارة، بتمييز العدد العربي (VOPS-019، 29 أكتوبر 2026). كانتا
 * تكتبان «48 ساعة» ثابتة: ضُبطت 6 فظنّ البائع أن أمامه يومين والطلب يُلغى بعد ست ساعات.
 * الردّ يُعدَّل هنا إلى 6 لا الإعداد نفسه: مهمة الطلبات في خادم التطوير تقرؤه، و6 تلغي طلبات قائمة.
 */
const ADDRESS = { recipientName: 'سلمى المهلة', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

test('القائمة والطلب: «خلال 6 ساعات» حين المهلة 6 — لا «48 ساعة»', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  await signInBuyer(page, t);
  const access = (await page.evaluate(() => localStorage.getItem('basta.access')))!;
  const call = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect(res.ok, `${path} ${res.status}`).toBe(true);
    return res.json();
  };
  const auth = { authorization: `Bearer ${access}` };
  const cart = (await call('/cart', { currency: 'SAR' }, auth)) as { token: string };
  const h = { ...auth, 'x-cart-token': cart.token };
  await call('/cart/items', { variantId: v.variantId, qty: 1 }, h);
  const quote = (await call('/checkout/quote', { country: 'SA', region: 'الرياض', city: 'الرياض' }, h)) as { currency: string; totals: { total: { minorUnits: string } } };
  const order = (await call(
    '/checkout',
    { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
    { ...h, 'idempotency-key': crypto.randomUUID() },
  )) as { orderNumber: string };
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } } });

  // ردّا القائمة والطلب بمهلة 6 ساعات
  await page.route(/\/api\/v1\/vendor\/orders(\/[0-9a-f-]+)?(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    await route.fulfill({ response: res, json: { ...body, acceptanceHours: 6 } });
  });

  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto('/login?next=/vendor/orders');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/orders');
  await expect(page.getByText('الطلب الذي لا يُقبل خلال 6 ساعات يُلغى آلياً ويُردّ مال المشتري.')).toBeVisible();

  await page.goto(`/vendor/orders/${sub.id}`);
  await expect(page.getByText('اقبل الطلب أو ارفضه خلال 6 ساعات من وصوله، وإلا أُلغي آلياً.')).toBeVisible();
  await expect(page.getByText('48 ساعة')).toHaveCount(0);
});
