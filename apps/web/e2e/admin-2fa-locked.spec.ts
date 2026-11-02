import { expect, test } from '@playwright/test';
import { PASSWORD, makeAdmin, tag } from './fixtures';

/**
 * AUTH-063 (شقّ الواجهة) — موجة «يُؤتمت» الثالثة (2 نوفمبر 2026). بطاقة التحقق بخطوتين في «الأمان»
 * لحساب مدير: تقول إنه إلزامي ولا تعرض «عطّل»، وتُبقي تجديد الرموز وتغيير الجهاز. الخادم يرفض
 * التعطيل نفسه (totp.integration.spec.ts — ADM-007).
 */
test('مدير في «الأمان»: «إلزامي لحسابات الإدارة» بلا زرّ تعطيل، مع تجديد الرموز وتغيير الجهاز', async ({ page }) => {
  const admin = await makeAdmin(tag(), ['reports.view']);
  await page.goto('/login?next=/account');
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/account');

  await page.getByRole('tab', { name: 'الأمان' }).click();
  await expect(page.getByText('التحقّق بخطوتين مُفعَّل')).toBeVisible();
  await expect(page.getByText('إلزامي لحسابات الإدارة ولا يمكن تعطيله.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'أنشئ رموز استعادة جديدة' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'غيّر الجهاز' })).toBeVisible();
  await expect(page.getByRole('button', { name: /عطّل التحقّق بخطوتين/ })).toHaveCount(0);
});
