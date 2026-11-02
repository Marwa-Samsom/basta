import { expect, test } from '@playwright/test';
import { PASSWORD, makeAdmin, prisma, tag } from './fixtures';

/**
 * «تعليق رصيد البائع» صفراً أو أقصر من مهلة الإرجاع: النافذة تقول متى يتحرّر المال قبل الحفظ —
 * SYS-022، 2 نوفمبر 2026. كانت الجملة العامة وحدها («يسري على الطلبات التي تُسلَّم بعد
 * الحفظ…»)، فيُحفظ الصفر ولا شيء يقول إن مال البائع يتحرّر عند التسليم.
 */
test('الصفر والأقصر من مهلة الإرجاع يقولان متى يتحرّر المال، والأطول لا، والتراجع لا يحفظ', async ({ page }) => {
  const admin = await makeAdmin(tag(), ['settings.edit']);
  const setting = async (key: string) => (await prisma.setting.findUnique({ where: { key } }))?.valueJson;
  const returnDays = Number((await setting('return_window_days')) ?? 14);
  const before = await setting('hold_period_days');

  await page.goto('/login?next=/admin/settings');
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/settings');

  const field = page.getByLabel('تعليق رصيد البائع');
  const row = page.locator('.ac2-setting').filter({ has: field });
  const dialog = page.getByRole('dialog');
  const confirmFor = async (days: number) => {
    await field.fill(String(days));
    await row.getByRole('button', { name: 'حفظ' }).click();
    await expect(dialog).toBeVisible();
    return dialog;
  };

  await expect(await confirmFor(0)).toContainText('صفر: مال البائع يتحرّر عند تأكيد التسليم');
  await dialog.getByRole('button', { name: 'تراجع' }).click();

  await expect(await confirmFor(returnDays - 1)).toContainText(`أقصر من مهلة الإرجاع`);
  await dialog.getByRole('button', { name: 'تراجع' }).click();

  const longer = await confirmFor(returnDays + 1);
  await expect(longer).toContainText('يسري على الطلبات التي تُسلَّم بعد الحفظ');
  await expect(longer).not.toContainText('مهلة الإرجاع');
  await dialog.getByRole('button', { name: 'تراجع' }).click();

  expect(await setting('hold_period_days')).toEqual(before);
});
