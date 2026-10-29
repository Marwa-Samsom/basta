import { expect, test } from '@playwright/test';
import { API, makeVendor, prisma, signInBuyer, tag } from './fixtures';

/**
 * إجراء من صفحة قديمة يُرفض لأن الحالة تغيّرت: التنبيه يبقى، والبطاقة تُجلب من جديد
 * فلا يبقى زرّ لم يعد مسموحاً — BUY-027، بطلب صاحبة المشروع (27 أكتوبر 2026).
 * كانت البطاقة تبقى «بانتظار القبول» بزرّ الإلغاء تحت التنبيه حتى تحديث الصفحة.
 */
const ADDRESS = { recipientName: 'مشترٍ قديم الصفحة', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

test('إلغاء رُفض لأن البائع بدأ التجهيز: التنبيه، والبطاقة «قيد التجهيز» بلا زرّ إلغاء بلا تحديث', async ({ page }) => {
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

  await page.goto(`/account/orders/${order.orderNumber}`);
  const cancel = page.getByRole('button', { name: 'إلغاء هذا المتجر' });
  await expect(cancel).toBeVisible();

  // في الأثناء قبل البائع وبدأ التجهيز — والصفحة لم تُحدَّث
  await prisma.subOrder.updateMany({ where: { order: { orderNumber: order.orderNumber } }, data: { status: 'preparing', acceptedAt: new Date() } });

  await cancel.click();
  await page.getByRole('button', { name: 'ألغِ هذا المتجر' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'لا يمكن نقل الطلب' });
  await expect(alert).toContainText('لا يمكن نقل الطلب من «قيد التجهيز» إلى «ألغاه المشتري»');
  await expect(page.locator('.badge', { hasText: 'قيد التجهيز' })).toBeVisible();
  await expect(cancel).toHaveCount(0);
  // التنبيه يبقى بعد الجلب
  await expect(alert).toContainText('انتقال غير مسموح');
});
