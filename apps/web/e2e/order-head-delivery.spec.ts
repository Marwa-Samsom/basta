import { expect, test } from '@playwright/test';
import { API, makeVendor, signInBuyer, tag } from './fixtures';

/**
 * رأس صفحة الطلب يقول إلى أين وبماذا دُفع — ST-19، بطلب صاحبة المشروع في BUY-011 (27 أكتوبر 2026).
 * كان الخادم يعيد العنوان ووسيلة الدفع والصفحة لا تعرضهما.
 */
const ADDRESS = { recipientName: 'سلمى الرأس', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

test('«التوصيل إلى» بالاسم والعنوان، و«الدفع: بطاقة»', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  await signInBuyer(page, t);
  const access = (await page.evaluate(() => localStorage.getItem('basta.access')))!;

  // الطلب من الـ API بجلسة المشتري نفسها — الاختبار عن رأس الصفحة لا عن الدفع
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

  await page.goto(`/account/orders/${order.orderNumber}`);
  const info = page.locator('.sp-orderinfo');
  await expect(info.locator('dt', { hasText: 'التوصيل إلى' })).toBeVisible();
  await expect(info).toContainText('سلمى الرأس — السعودية · الرياض · الرياض · طريق الملك فهد 10');
  await expect(info.locator('div', { hasText: 'الدفع' }).locator('dd')).toHaveText('بطاقة');
});
