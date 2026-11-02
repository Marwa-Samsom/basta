import type { Prisma } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { PASSWORD, makeAdmin, prisma, tag } from './fixtures';

/**
 * قيمة إعداد تالفة كُتبت في القاعدة مباشرة: اللوحة تقول إنها تالفة — SYS-002، 1 نوفمبر 2026.
 * كتبنا «خمسة» في «مهلة حجز المخزون» فعرضتها اللوحة «الحالي: خمسة دقيقة» كأنها السارية،
 * والحجز يعمل بـ 15 الافتراضية ولا شيء يقول ذلك.
 */
test('نصّ أو رقم خارج الحدود في القاعدة: تنبيه تحت الإعداد، و«الحالي» لا يدّعيه قيمة سارية', async ({ page }) => {
  const key = 'reservation_ttl_minutes';
  const before = await prisma.setting.findUniqueOrThrow({ where: { key } });
  const admin = await makeAdmin(tag(), ['settings.edit']);
  const put = (valueJson: Prisma.InputJsonValue) => prisma.setting.update({ where: { key }, data: { valueJson } });

  try {
    await put('خمسة');
    await page.goto('/login?next=/admin/settings');
    await page.getByLabel('البريد الإلكتروني').fill(admin.email);
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForURL((u) => u.pathname === '/admin/settings');

    const row = page.locator('.ac2-setting').filter({ has: page.getByLabel('مهلة حجز المخزون') });
    await expect(row.getByRole('alert')).toContainText('القيمة المحفوظة «خمسة» ليست رقماً صحيحاً');
    await expect(row).toContainText('الحالي: «خمسة»');
    await expect(row).not.toContainText('خمسة دقيقة');

    await put(90);
    await page.reload();
    await expect(row.getByRole('alert')).toContainText('القيمة المحفوظة «90» خارج حدود اللوحة (5–60)');

    await put(20);
    await page.reload();
    await expect(row).toContainText('الحالي: 20 دقيقة');
    await expect(row.getByRole('alert')).toHaveCount(0);
  } finally {
    await put(before.valueJson as Prisma.InputJsonValue);
  }
});
