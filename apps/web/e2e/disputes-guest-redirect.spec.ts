import { expect, test } from '@playwright/test';
import { PASSWORD, register, tag } from './fixtures';

/**
 * «نزاعاتي» وخيط النزاع للضيف — BUY-063، 1 نوفمبر 2026. كانتا وحدهما في منطقة الحساب
 * بلا حارس جلسة: تُجلب القائمة ضيفاً فتقف على «مطلوب تسجيل الدخول.» بلا طريق إلى الدخول
 * (وجدته صاحبة المشروع بالخروج ثم الرجوع). الآن تحوّلان إلى الدخول بالعودة إليهما،
 * ولا تُجلب القائمة قبل أن تُعرف الجلسة.
 */

test('الضيف على «نزاعاتي» وخيط النزاع يُحوَّل إلى الدخول ولا يُجلب شيء', async ({ page }) => {
  let fetched = 0;
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/me/disputes'),
    (route) => {
      fetched++;
      return route.continue();
    },
  );

  await page.goto('/account/disputes');
  await page.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.get('next')).toBe('/account/disputes');

  const thread = '00000000-0000-4000-8000-000000000063';
  await page.goto(`/account/disputes/${thread}`);
  await page.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.get('next')).toBe(`/account/disputes/${thread}`);

  await expect(page.getByText('مطلوب تسجيل الدخول.')).toHaveCount(0);
  expect(fetched).toBe(0);
});

test('الدخول من التحويل يعيد إلى «نزاعاتي» وقائمتها تُجلب', async ({ page }) => {
  const email = `buyer.${tag()}@basta.test`;
  await register(email, 'مشترٍ نزاعات');

  await page.goto('/account/disputes');
  await page.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 });
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();

  await page.waitForURL((u) => u.pathname === '/account/disputes');
  await expect(page.getByRole('heading', { name: 'نزاعاتي' })).toBeVisible();
  await expect(page.getByText('لا نزاعات')).toBeVisible();
  await expect(page.locator('.alert')).toHaveCount(0);

  // والخيط للداخل يُجلب في مكانه ولا يُحوَّل — نزاع غير موجود يقول ذلك
  const thread = '00000000-0000-4000-8000-000000000064';
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === `/api/v1/me/disputes/${thread}`);
  await page.goto(`/account/disputes/${thread}`);
  await asked;
  await expect(page.locator('.alert')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/account/disputes/${thread}`);
});
