import { expect, test } from '@playwright/test';
import { PASSWORD, makeAdmin, prisma, tag } from './fixtures';

/**
 * الإعدادات (AD-26): خانة رقمية فارغة لا تُحفظ صفراً (ACFG-024، 24 أكتوبر 2026).
 * كان Number('') = 0 يحفظ «تعليق رصيد البائع» 0 والخادم يقبله — الصفر قيمة
 * مشروعة — فتتحرّر أموال البائعين فور التسليم. الحفظ يُمنع في الواجهة نفسها.
 */
test('خانة رقمية فارغة أو خارج حدودها: «حفظ» معطّل برسالة، والقيمة لا تتغيّر', async ({ page }) => {
  const admin = await makeAdmin(tag(), ['settings.edit']);
  const before = await prisma.setting.findUniqueOrThrow({ where: { key: 'hold_period_days' } });

  await page.goto('/login?next=/admin/settings');
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/settings');

  const row = page.locator('.ac2-setting').filter({ hasText: 'hold_period_days' });
  const field = row.getByLabel('تعليق رصيد البائع', { exact: true });
  const save = row.getByRole('button', { name: 'حفظ' });
  const hint = row.getByRole('alert');

  // ما فعلته صاحبة المشروع: مسحت الرقم كله ثم «حفظ»
  await field.fill('');
  await expect(save).toBeDisabled();
  await expect(hint).toHaveText('اكتب رقماً صحيحاً من 0 إلى 60.');
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  for (const bad of ['61', '7.5', 'abc', ' ']) {
    await field.fill(bad);
    await expect(save, bad).toBeDisabled();
  }

  // الصفر مكتوباً بيد المدير مقبول، والأرقام العربية كذلك — المرفوض الفراغ لا الصفر
  for (const good of ['0', '٢١']) {
    await field.fill(good);
    await expect(save, good).toBeEnabled();
    await expect(hint).toHaveCount(0);
  }

  const after = await prisma.setting.findUniqueOrThrow({ where: { key: 'hold_period_days' } });
  expect(after.valueJson).toEqual(before.valueJson);
});
