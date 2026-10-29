import { expect, test } from '@playwright/test';

/**
 * ✕ في خانتي البريد وكلمة المرور بصفحة الدخول يمحو المكتوب — 27 أكتوبر 2026، بطلب صاحبة
 * المشروع على «دخول لوحة الإدارة» ثم على البريد. وظهر معها أن أول حرف من كلمة المرور كان
 * يختبئ تحت زرّ الإظهار: الحقل dir="ltr" فكان فراغه يميناً والزرّ يساراً.
 */
const FIELDS = [
  { label: 'البريد الإلكتروني', clear: 'امسح البريد', value: 'admin@basta.test' },
  { label: 'كلمة المرور', clear: 'امسح الحروف', value: 'abcdefgh' },
] as const;

for (const f of FIELDS) {
  test(`✕ يمحو «${f.label}» ويُبقي المؤشّر، ولا يظهر والخانة فارغة`, async ({ page }) => {
    await page.goto('/login?next=/admin');
    const field = page.getByLabel(f.label, { exact: true });
    const clear = page.getByRole('button', { name: f.clear });
    await expect(clear).toHaveCount(0);

    await field.fill(f.value);
    await clear.click();
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
    await expect(clear).toHaveCount(0);
  });
}

test('مسح البريد لا يمسّ كلمة المرور', async ({ page }) => {
  await page.goto('/login?next=/admin');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('admin@basta.test');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('abcdefgh');
  await page.getByRole('button', { name: 'امسح البريد' }).click();
  await expect(page.getByLabel('البريد الإلكتروني', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('كلمة المرور', { exact: true })).toHaveValue('abcdefgh');
});

test('الحروف لا تختبئ تحت زرّ الإظهار ولا تحت ✕', async ({ page }) => {
  await page.goto('/login?next=/admin');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('a-very-long-address-for-the-end@basta.test');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('abcdefgh');
  await expect(page.getByRole('button', { name: 'امسح البريد' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'امسح الحروف' })).toBeVisible();

  const box = await page.evaluate(() => {
    const edges = (wrap: string) => {
      const input = document.querySelector<HTMLInputElement>(`${wrap} > input`)!;
      const r = input.getBoundingClientRect();
      const cs = getComputedStyle(input);
      const x = document.querySelector(`${wrap} .ac-clear`)!.getBoundingClientRect();
      return { textStart: r.left + parseFloat(cs.paddingLeft), textEnd: r.right - parseFloat(cs.paddingRight), xLeft: x.left };
    };
    const eye = document.querySelector('.ac-pw__toggle')!.getBoundingClientRect();
    return { mail: edges('.ac-clearable'), pw: edges('.ac-pw'), eyeRight: eye.right };
  });
  // العين يساراً والكتابة تبدأ بعدها، و✕ يميناً بعد آخر الكتابة — في الخانتين
  expect(box.eyeRight).toBeLessThanOrEqual(box.pw.textStart);
  expect(box.pw.textEnd).toBeLessThanOrEqual(box.pw.xLeft);
  expect(box.mail.textEnd).toBeLessThanOrEqual(box.mail.xLeft);
});
