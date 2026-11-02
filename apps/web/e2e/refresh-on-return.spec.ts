import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * كل صفحة بيانات تجلب من جديد عند الرجوع إليها (lib/fresh): كانت تُجلب عند فتحها وحده، فطلب دُفع
 * وهي مفتوحة في نافذة أخرى لم يظهر إلا بعد F5 (2 نوفمبر 2026). هنا قائمة طلبات المتجر — تمرّ بـ
 * useAdminData الذي تمرّ به صفحات الإدارة كلها. دخول واحد: التاجر يشتري من متجره بالرمز نفسه.
 */
const ADDRESS = { recipientName: 'رجوع الطلبات', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 9' };

test('طلب دُفع وقائمة الطلبات مفتوحة يظهر فيها عند الرجوع إليها — بلا F5', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  await page.goto(`/login?next=${encodeURIComponent('/vendor/orders')}`);
  // خادم التطوير يبني الصفحة عند أول طلب: كبسة قبل أن يُفعَّل النموذج ترسله كنموذج HTML عادي فيضيع
  await page.waitForLoadState('networkidle');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/orders');
  await page.waitForLoadState('networkidle');

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
  const paid = (await call(
    '/checkout',
    { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
    { ...h, 'idempotency-key': crypto.randomUUID() },
  )) as { orderNumber: string };
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: paid.orderNumber } }, select: { subOrderNumber: true } });

  // القائمة لا تعرف بالطلب حتى يرجع إليها صاحبها
  await page.waitForTimeout(2_500);
  await expect(page.getByText(sub.subOrderNumber)).toHaveCount(0);

  // الرجوع من نافذة أخرى: النافذة تستعيد التركيز
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(sub.subOrderNumber).first()).toBeVisible({ timeout: 5_000 });
});
