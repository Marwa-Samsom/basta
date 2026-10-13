import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeAdmin, makeVendor, tag } from './fixtures';

/**
 * بعد الدخول أو التسجيل يصل كلٌّ إلى بيته: كانت الوجهة ثابتة على تأهيل البائع، فيجد
 * كل مشترٍ جديد نفسه أمام «سجّل متجرك». الآن ما جاء الزائر من أجله (`next`) إن وُجد،
 * وإلا فبحسب دوره — والوجهة لا تضيع بين الدخول والتسجيل والتأكيد.
 */

async function registerViaForm(page: Page, email: string): Promise<void> {
  await page.getByLabel('الاسم الكامل').fill('زائر جديد');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'أنشئ الحساب' }).click();
  await page.waitForURL((u) => u.pathname === '/verify');
}

test('مشترٍ جديد: التسجيل ثم «تخطَّ الآن» يصل حسابه لا تسجيل متجر', async ({ page }) => {
  await page.goto('/register');
  await registerViaForm(page, `buyer.${tag()}@basta.test`);
  await page.getByRole('link', { name: 'تخطَّ الآن' }).click();
  await page.waitForURL((u) => u.pathname === '/account');
});

test('بائع يريد فتح متجر: من الدخول إلى «أنشئ حساباً» ثم التأكيد — يصل تسجيل المتجر', async ({ page }) => {
  // هكذا يصل من «ابدأ البيع»: تسجيل المتجر يحيله إلى الدخول ومعه وجهته
  await page.goto(`/login?next=${encodeURIComponent('/vendor/register')}`);
  await page.getByRole('link', { name: 'أنشئ حساباً' }).click();
  await page.waitForURL((u) => u.pathname === '/register' && u.searchParams.get('next') === '/vendor/register');
  await registerViaForm(page, `seller.${tag()}@basta.test`);
  await page.getByRole('link', { name: 'تخطَّ الآن' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/register');
});

test('دخول بلا وجهة: البائع إلى لوحته، والمدير إلى الإدارة', async ({ page }) => {
  const t = tag();
  const vendor = await makeVendor(t);
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(vendor.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor');

  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  const admin = await makeAdmin(t, ['catalog.manage']);
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/admin');
});
