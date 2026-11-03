import { expect, test } from '@playwright/test';
import { API, makeVendor, PASSWORD, tag } from './fixtures';

/**
 * تقارير البائع تُجلب عند فتحها، فطلب دُفع وهي مفتوحة في نافذة أخرى لم يظهر إلا بعد F5: بقيت «الطلبات» 5
 * والطلب السادس مدفوع (2 نوفمبر 2026). الرجوع إلى الصفحة يجلب أرقامها من جديد.
 * دخول واحد فقط (حدّ الدخول مشترك مع التجربة اليدوية على الجهاز نفسه): التاجر يشتري من متجره بالرمز نفسه.
 */
const ADDRESS = { recipientName: 'رجوع التقارير', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 7' };

test('طلب دُفع والتقارير مفتوحة يظهر عند الرجوع إليها — بلا F5', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  await page.goto(`/login?next=${encodeURIComponent('/vendor/reports')}`);
  // خادم التطوير يبني الصفحة عند أول طلب: كبسة قبل أن تُفعَّل النموذج ترسله كنموذج HTML عادي فيضيع
  await page.waitForLoadState('networkidle');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/reports');
  // متجر جديد بلا طلبات: لا أرقام بعد
  await expect(page.getByText('لا مبيعات في هذا المدى')).toBeVisible();

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
  )) as { outcome: string };
  expect(paid.outcome).toBe('paid');

  // الصفحة لا تعرف بالطلب حتى يرجع إليها صاحبها
  // والعدّاد يتجاهل ما يصل في الثانيتين الأوليين بعد فتح الصفحة
  await page.waitForTimeout(2_500);
  await expect(page.getByText('لا مبيعات في هذا المدى')).toBeVisible();

  // الرجوع من نافذة أخرى: النافذة تستعيد التركيز
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const orders = page.locator('.stat').filter({ has: page.locator('.stat__label', { hasText: /^الطلبات$/ }) }).locator('.stat__value');
  await expect(orders).toHaveText('1', { timeout: 5_000 });
  await expect(page.getByText('لا مبيعات في هذا المدى')).toHaveCount(0);
});
