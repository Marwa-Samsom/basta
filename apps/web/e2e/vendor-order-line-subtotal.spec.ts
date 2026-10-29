import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * سطر المنتج في طلب البائع سعرُ القطعة × الكمية كالتصميم VD-13، ومجموعه «المنتجات» في التفصيل — لا الإجمالي
 * بضريبة ليست للمتجر. كان «230.00 × 2» جنب «المنتجات 200.00» حيث الضريبة تُضاف (VOPS-010، 29 أكتوبر 2026).
 */
const ADDRESS = { recipientName: 'سلمى السطر', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

test('سطر المنتج عند البائع بلا الضريبة المضافة: 500.00 لقطعتين بـ 250.00 — كـ«المنتجات»', async ({ page }) => {
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
  await call('/cart/items', { variantId: v.variantId, qty: 2 }, h);
  const quote = (await call('/checkout/quote', { country: 'SA', region: 'الرياض', city: 'الرياض' }, h)) as { currency: string; totals: { total: { minorUnits: string } } };
  const order = (await call(
    '/checkout',
    { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
    { ...h, 'idempotency-key': crypto.randomUUID() },
  )) as { orderNumber: string };

  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } }, include: { items: true } });
  // الشرط المسبق: ضريبة تُضاف فوق السعر — فالإجمالي غير المجموع
  expect(sub.items[0]!.lineTaxMinorUnits).toBeGreaterThan(0n);
  expect(sub.items[0]!.lineSubtotalMinorUnits).toBe(50_000n);

  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto(`/login?next=${encodeURIComponent(`/vendor/orders/${sub.id}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === `/vendor/orders/${sub.id}`);

  const line = page.locator('.vm-line__total').first();
  await expect(line).toContainText('500.00');
  await expect(line).not.toContainText('575.00');
});
