import { expect, test } from '@playwright/test';
import { signInBuyer } from './fixtures';

/**
 * AUTH-046 — موجة «يُؤتمت» الثالثة (2 نوفمبر 2026). الخادم النائم أو الساقط أثناء التجديد ليس
 * رفضاً للجلسة: كانت تُمسح فيخرج كل من صادف استيقاظ الخادم. الردّ هنا بجسم وسيط الواجهة نفسه
 * (app/api/v1/[...path]/route.ts) حين لا يصل الـ API.
 */
const UNREACHABLE = 'تعذّر الوصول إلى الخادم. حاول بعد لحظات.';

test('تجديد يردّ 502: لا خروج ولا مسح للجلسة ورسالة الخادم، وبعد عودته تعمل الجلسة نفسها', async ({ page }) => {
  const { email } = await signInBuyer(page);
  await expect(page.getByLabel('الاسم الكامل')).not.toHaveValue('');

  // رمز وصول لا يقبله الخادم: كل طلب يردّ 401 فتطلب الواجهة التجديد
  const stale = 'e2e.stale.access-token';
  await page.evaluate((t) => localStorage.setItem('basta.access', t), stale);
  let refreshes = 0;
  await page.route('**/api/v1/auth/refresh', (route) => {
    refreshes++;
    return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'API_UNREACHABLE', message: UNREACHABLE }) });
  });

  await page.reload();
  await expect(page.getByText(UNREACHABLE).first()).toBeVisible();
  expect(refreshes).toBeGreaterThan(0);
  expect(new URL(page.url()).pathname).toBe('/account');
  expect(await page.evaluate(() => localStorage.getItem('basta.access'))).toBe(stale);

  await page.unroute('**/api/v1/auth/refresh');
  await page.reload();
  await expect(page.getByText('البريد الإلكتروني').first()).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(UNREACHABLE)).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/account');
  const renewed = await page.evaluate(() => localStorage.getItem('basta.access'));
  expect(renewed).toBeTruthy();
  expect(renewed).not.toBe(stale);
});
