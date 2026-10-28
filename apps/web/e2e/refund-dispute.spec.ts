import { expect, test } from '@playwright/test';
import { API, makeVendor, prisma, signInBuyer, tag } from './fixtures';

/**
 * «مُسترَد»: «لديّ مشكلة» خلال 14 يوماً من الاسترداد، بسبب «لم يصلني الاسترداد» وحده، ويقول إنه
 * يصل الإدارة مباشرة — قرار صاحبة المشروع في BUY-052 (28 أكتوبر 2026). كان «مُسترَد» بلا نزاع.
 */
const ADDRESS = { recipientName: 'مشترٍ ينتظر ماله', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 10' };

async function call(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  expect(res.ok, `${path} ${res.status}`).toBe(true);
  return res.json();
}

test('«مُسترَد»: نزاع «لم يصلني الاسترداد» يُفتح للإدارة، ولا زرّ بعد 14 يوماً', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  await signInBuyer(page, t);
  const buyer = { authorization: `Bearer ${(await page.evaluate(() => localStorage.getItem('basta.access')))!}` };

  // طلبان يُلغيهما المشتري قبل القبول فيُردّ مبلغهما: «مُسترَد»
  const refunded = async () => {
    const cart = (await call('/cart', { currency: 'SAR' }, buyer)) as { token: string };
    const h = { ...buyer, 'x-cart-token': cart.token };
    await call('/cart/items', { variantId: v.variantId, qty: 1 }, h);
    const quote = (await call('/checkout/quote', { country: 'SA', region: 'الرياض', city: 'الرياض' }, h)) as { currency: string; totals: { total: { minorUnits: string } } };
    const order = (await call(
      '/checkout',
      { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
      { ...h, 'idempotency-key': crypto.randomUUID() },
    )) as { orderNumber: string };
    const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } } });
    await call(`/me/orders/${order.orderNumber}/stores/${sub.id}/cancel`, {}, buyer);
    expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('refunded');
    return { number: order.orderNumber, subId: sub.id };
  };
  const recent = await refunded();
  const old = await refunded();
  await prisma.subOrderStatusHistory.updateMany({ where: { subOrderId: old.subId, toStatus: 'refunded' }, data: { createdAt: new Date(Date.now() - 15 * 86_400_000) } });

  // بعد 14 يوماً: لا «لديّ مشكلة»
  await page.goto(`/account/orders/${old.number}`);
  await expect(page.locator('.sp-store__head .badge')).toHaveText('مُسترَد');
  await expect(page.getByRole('button', { name: 'لديّ مشكلة' })).toHaveCount(0);

  // خلال 14 يوماً: النموذج بسببه الوحيد، ويقول إنه يصل الإدارة
  await page.goto(`/account/orders/${recent.number}`);
  await page.getByRole('button', { name: 'لديّ مشكلة' }).click();
  const panel = page.locator('.sp-panel', { hasText: 'لم يصلك المبلغ المسترَد؟' });
  await expect(panel).toContainText('يصل الإدارة مباشرة');
  await expect(panel.locator('select option')).toHaveText(['لم يصلني الاسترداد']);
  await panel.getByRole('textbox').fill('رُدّ المبلغ قبل أسبوع ولم يصل إلى بطاقتي');
  await page.getByRole('button', { name: 'افتح النزاع' }).click();
  await expect(page.getByText('فُتح النزاع ووصل الإدارة مباشرة — تتابع استردادك وتردّ عليك هنا.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'متابعة النزاع' })).toBeVisible();
  const dispute = await prisma.dispute.findFirstOrThrow({ where: { subOrderId: recent.subId } });
  expect(dispute).toMatchObject({ reasonCode: 'refund_missing', status: 'escalated' });
});
