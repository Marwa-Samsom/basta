import { expect, test } from '@playwright/test';
import { makeAdmin, PASSWORD, tag } from './fixtures';

/**
 * فشل طلب القائمة لا يُبقي نتيجة ما قبله: بحث رفضه الخادم (101 حرف) كان يُبقي القائمة كاملة بعدّادها
 * بلا رسالة، وتصفية فشل طلبها تُظهر منتجات تصفية سابقة تحت اسمها (ADM-048، 30 أكتوبر 2026).
 */
test('بحث يرفضه الخادم أو تصفية يفشل طلبها: رسالتها مكان القائمة، لا نتيجة ما قبلها', async ({ page }) => {
  const t = tag();
  const admin = await makeAdmin(t, ['catalog.manage']);
  await page.goto(`/login?next=${encodeURIComponent('/admin/products')}`);
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/products');

  const rows = page.getByRole('list', { name: 'المنتجات' }).getByRole('listitem');
  const count = page.getByText(/^\d+ منتج$/);
  const search = page.getByLabel('بحث في المنتجات');
  await expect(rows.first()).toBeVisible();

  // 101 حرف: رسالة الخادم مكان القائمة وعدّادها
  await search.fill('ب'.repeat(101));
  await expect(page.getByRole('alert').filter({ hasText: 'البحث: 100 حرفاً على الأكثر.' })).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expect(count).toHaveCount(0);
  await search.fill('');
  await expect(rows.first()).toBeVisible();

  // تصفية انقطع طلبها: لا يبقى «منشور» تحت «موقوف»، و«أعد المحاولة» يأتي بها
  const rejected = /\/api\/v1\/admin\/products\?status=rejected/;
  await page.route(rejected, (route) => route.abort());
  await page.getByRole('tab', { name: 'موقوف' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'لا اتصال بالخادم' })).toBeVisible();
  await expect(rows).toHaveCount(0);
  await page.unroute(rejected);
  await page.getByRole('button', { name: 'أعد المحاولة' }).click();
  await expect(rows.first()).toContainText('موقوف');
});
