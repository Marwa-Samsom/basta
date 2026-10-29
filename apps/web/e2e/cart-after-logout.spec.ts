import { expect, test, type Page } from '@playwright/test';
import { API, PASSWORD, makeVendor, register, tag } from './fixtures';

/**
 * الخروج لا يترك سلّة الحساب لمن يستعمل المتصفّح بعده — CHK-020، 27 أكتوبر 2026.
 *
 * كان رمز السلة يبقى في المتصفّح بعد «خروج»، فيرى من يدخل بعده سلّة من خرج ويدفعها
 * بحسابه (ظهر في CHK-022: سلّة vendor2 دُفعت باسم buyer.reset). الآن يُنسى الرمز عند
 * الخروج، والخادم لا يفتح سلّة حساب لحساب آخر ولو بقي رمزها.
 */
async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === next);
}

const login = async (email: string): Promise<string> =>
  ((await (
    await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })
  ).json()) as { tokens: { accessToken: string } }).tokens.accessToken;

const getCart = (token: string, access?: string) =>
  fetch(`${API}/cart`, { headers: { 'x-cart-token': token, ...(access ? { authorization: `Bearer ${access}` } : {}) } });

test('«خروج» ينسى سلّة المتصفّح: من يدخل بعده يرى سلة فارغة', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const first = `cart.a.${t}@basta.test`;
  const second = `cart.b.${t}@basta.test`;
  await register(first, `مشترٍ أ ${t}`);
  await register(second, `مشترٍ ب ${t}`);

  await signIn(page, first, '/account');
  await page.goto(`/p/${v.productSlug}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByText('أُضيف إلى سلّتك.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('basta.cart'))).not.toBeNull();

  // بعد سكون الصفحة: طلب جرس معلَّق لحظة الخروج يرتدّ 401 فيعيدها إلى الدخول بدل الرئيسية
  await page.goto('/account');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'خروج' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  expect(await page.evaluate(() => localStorage.getItem('basta.cart'))).toBeNull();

  await signIn(page, second, '/cart');
  await expect(page.getByText('سلّتك فارغة')).toBeVisible();
  await expect(page.getByText(v.productName)).toHaveCount(0);
});

test('الخادم: سلّة حساب لا يفتحها حساب آخر، وسلّة الضيف تصير لأول حساب يفتحها', async () => {
  const t = tag();
  const v = await makeVendor(t);
  const [a, b] = [`own.a.${t}@basta.test`, `own.b.${t}@basta.test`];
  await register(a, `أ ${t}`);
  await register(b, `ب ${t}`);
  const [accessA, accessB] = [await login(a), await login(b)];

  // سلة ضيف فيها قطعة، يفتحها «أ» فتصير له
  const created = (await (
    await fetch(`${API}/cart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currency: 'SAR' }) })
  ).json()) as { token: string };
  const added = await fetch(`${API}/cart/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cart-token': created.token },
    body: JSON.stringify({ variantId: v.variantId, qty: 1 }),
  });
  expect(added.status).toBe(201);
  expect((await getCart(created.token, accessA)).status).toBe(200);

  // «ب» برمزها نفسه: كأنها غير موجودة، ولا يقدر يدفعها
  const asB = await getCart(created.token, accessB);
  expect(asB.status).toBe(404);
  expect(((await asB.json()) as { message: string }).message).toBe('السلة غير موجودة أو انتهت.');
  const quote = await fetch(`${API}/checkout/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cart-token': created.token, authorization: `Bearer ${accessB}` },
    body: JSON.stringify({ country: 'SA', region: 'الرياض', city: 'الرياض' }),
  });
  expect(quote.status).toBe(404);

  // وصاحبها ما زال يراها بقطعتها
  const asA = (await (await getCart(created.token, accessA)).json()) as { itemCount: number };
  expect(asA.itemCount).toBe(1);
});
