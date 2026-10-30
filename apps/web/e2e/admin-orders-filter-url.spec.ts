import { expect, test } from '@playwright/test';
import { makeAdmin, PASSWORD, tag } from './fixtures';

/**
 * تصفية طلبات الإدارة في العنوان: «اعرض كل الطلبات» كانت تزيل «قاربت مهلة القبول» من الشاشة وحدها، فيعيدها
 * التحديث (F5) والرابط المنسوخ؛ وتبويب الحالة لا يُكتب فيه فيعود «الكل» (ADM-024، 29 أكتوبر 2026).
 */
test('إزالة «قاربت المهلة» وتبويب الحالة يبقيان بعد التحديث', async ({ page }) => {
  const t = tag();
  const admin = await makeAdmin(t, ['orders.manage']);
  await page.goto(`/login?next=${encodeURIComponent('/admin/orders')}`);
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/orders');

  // من بطاقة اللوحة
  await page.goto('/admin/orders?due=acceptance');
  const due = page.getByText('طلبات قاربت مهلة القبول');
  await expect(due).toBeVisible();
  await page.getByRole('button', { name: 'اعرض كل الطلبات' }).click();
  await expect(due).toHaveCount(0);
  await expect(page).not.toHaveURL(/due=acceptance/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'الطلبات' }).first()).toBeVisible();
  await expect(due).toHaveCount(0);

  // تبويب الحالة يبقى بعد التحديث
  await page.getByRole('tab', { name: 'قيد التنفيذ' }).click();
  await expect(page).toHaveURL(/status=processing/);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'قيد التنفيذ' })).toHaveAttribute('aria-selected', 'true');
});
