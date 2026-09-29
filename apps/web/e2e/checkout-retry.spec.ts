import { expect, test, type Page, type Route } from '@playwright/test';
import { makeVendor, prisma, tag } from './fixtures';

/**
 * 502 و 504 من وسيط لا يعنيان «لم يُدفع»: الخادم خلفه قد أنشأ الطلب وخصم المال.
 * المحاولة التالية — ضغطة ثانية أو بعد إعادة تحميل الصفحة — ترسل المفتاح نفسه
 * فيعيد الخادم الطلب نفسه، ولا يُنشأ ثانٍ ولا يُخصم مرتين.
 */
async function addToCart(page: Page, productSlug: string) {
  await page.goto(`/p/${encodeURIComponent(productSlug)}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await page.getByRole('link', { name: 'اذهب إلى السلة' }).click();
  await page.waitForURL((u) => u.pathname === '/cart');
  await page.getByRole('link', { name: 'إتمام الشراء' }).click();
  await page.waitForURL((u) => u.pathname === '/checkout');
}

async function fillAndPrice(page: Page, email: string) {
  await page.getByLabel('اسم المستلم').fill('مشترٍ E2E');
  await page.getByLabel('الهاتف').fill('+966500000000');
  await page.getByLabel('البلد').selectOption('SA');
  await page.getByLabel('المحافظة / المنطقة').fill('الرياض');
  await page.getByLabel('المدينة').fill('الرياض');
  await page.getByLabel('الشارع ورقم البناء').fill('طريق الملك فهد 10');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByRole('button', { name: 'احسب الشحن' }).click();
  await expect(page.locator('.sp-sum__total')).toBeVisible();
}

/** يعترض طلبات «ادفع» وحدها ويسجّل مفتاح كلٍّ منها */
async function interceptPay(page: Page, first: (route: Route) => Promise<void>): Promise<string[]> {
  const keys: string[] = [];
  await page.route(
    (url) => url.pathname === '/api/v1/checkout',
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      return keys.length === 1 ? first(route) : route.continue();
    },
  );
  return keys;
}

const payButton = (page: Page) => page.getByRole('button', { name: 'ادفع' });

test('502 بعد أن دفع الخادم: «ادفع» ثانيةً بالمفتاح نفسه يعيد الطلب نفسه — دفعة واحدة', async ({ page }) => {
  const v = await makeVendor(tag());
  const email = `retry502.${tag()}@basta.test`;
  // الخادم يعالج الطلب كاملاً (يُنشئ ويخصم)، والوسيط يردّ على المتصفّح 502
  const keys = await interceptPay(page, async (route) => {
    await route.fetch();
    await route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' });
  });

  await addToCart(page, v.productSlug);
  await fillAndPrice(page, email);
  await payButton(page).click();
  await expect(page.getByText('تعذّر الاتصال بالخادم')).toBeVisible();

  await payButton(page).click();
  await page.waitForURL(/\/orders\//);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(await prisma.order.count({ where: { guestEmail: email } })).toBe(1);
});

test('504 ثم إعادة تحميل الصفحة: المفتاح نفسه يبقى في الجلسة', async ({ page }) => {
  const v = await makeVendor(tag());
  const email = `retry504.${tag()}@basta.test`;
  const keys = await interceptPay(page, (route) => route.fulfill({ status: 504, contentType: 'text/html', body: '<h1>504 Gateway Timeout</h1>' }));

  await addToCart(page, v.productSlug);
  await fillAndPrice(page, email);
  await payButton(page).click();
  await expect(page.getByText('تعذّر الاتصال بالخادم')).toBeVisible();

  await page.reload();
  await fillAndPrice(page, email);
  await payButton(page).click();
  await page.waitForURL(/\/orders\//);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(await prisma.order.count({ where: { guestEmail: email } })).toBe(1);

  // والشراء التالي محاولة جديدة: المفتاح انتهى بنتيجته
  expect(await page.evaluate(() => sessionStorage.getItem('basta.checkout.attempt'))).toBeNull();
});
