import { expect, test } from '@playwright/test';

/**
 * ✕ في خانة كلمة المرور بصفحة الدخول يمحو المكتوب — 27 أكتوبر 2026، بطلب صاحبة المشروع
 * على «دخول لوحة الإدارة». وظهر معها أن أول حرف كان يختبئ تحت زرّ الإظهار: الحقل dir="ltr"
 * فكان فراغه يميناً والزرّ يساراً.
 */
test('✕ يمحو كلمة المرور ويُبقي المؤشّر، ولا يظهر والخانة فارغة', async ({ page }) => {
  await page.goto('/login?next=/admin');
  const field = page.getByLabel('كلمة المرور', { exact: true });
  const clear = page.getByRole('button', { name: 'امسح الحروف' });
  await expect(clear).toHaveCount(0);

  await field.fill('abcdefgh');
  await clear.click();
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await expect(clear).toHaveCount(0);
});

test('الحروف لا تختبئ تحت زرّ الإظهار ولا تحت ✕', async ({ page }) => {
  await page.goto('/login?next=/admin');
  const field = page.getByLabel('كلمة المرور', { exact: true });
  await field.fill('abcdefgh');
  await expect(page.getByRole('button', { name: 'امسح الحروف' })).toBeVisible();

  const box = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('.ac-pw > input')!;
    const r = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    const eye = document.querySelector('.ac-pw__toggle')!.getBoundingClientRect();
    const x = document.querySelector('.ac-pw__clear')!.getBoundingClientRect();
    return {
      textStart: r.left + parseFloat(cs.paddingLeft),
      textEnd: r.right - parseFloat(cs.paddingRight),
      eye: { left: eye.left, right: eye.right },
      x: { left: x.left, right: x.right },
    };
  });
  // العين يساراً والكتابة تبدأ بعدها، و✕ يميناً بعد آخر الكتابة
  expect(box.eye.right).toBeLessThanOrEqual(box.textStart);
  expect(box.textEnd).toBeLessThanOrEqual(box.x.left);
});
