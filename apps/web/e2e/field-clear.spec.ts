import { expect, type Page, test } from '@playwright/test';

/**
 * ✕ في كل خانة كتابة من المكوّن المشترك (TextInput و«كلمة مرور جديدة») — 27 أكتوبر 2026،
 * بطلب صاحبة المشروع. صفحة التسجيل فيها الأنواع كلها: اسم عربي، وبريد وجوال وكلمة مرور بـ ltr.
 */
const FIELDS = [
  { label: 'الاسم الكامل', value: 'سلمى تجربة' },
  { label: 'البريد الإلكتروني', value: 'salma@basta.test' },
  { label: 'كلمة المرور', value: 'abcdefghij' },
  { label: 'رقم الجوال · اختياري', value: '+962791234567' },
] as const;

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const clearOf = (page: Page, label: string) =>
  field(page, label).locator('xpath=..').getByRole('button', { name: 'امسح المكتوب' });

for (const f of FIELDS) {
  test(`✕ يمحو «${f.label}» ويُبقي المؤشّر، ولا يظهر والخانة فارغة`, async ({ page }) => {
    await page.goto('/register');
    await expect(clearOf(page, f.label)).toHaveCount(0);
    await field(page, f.label).fill(f.value);
    await clearOf(page, f.label).click();
    await expect(field(page, f.label)).toHaveValue('');
    await expect(field(page, f.label)).toBeFocused();
    await expect(clearOf(page, f.label)).toHaveCount(0);
  });
}

test('المحو يمرّ بحالة الصفحة نفسها: شريط القوّة يعود «—»', async ({ page }) => {
  await page.goto('/register');
  await field(page, 'كلمة المرور').fill('abcdefghij');
  await expect(page.locator('.ac-strength__label')).toContainText('متوسطة');
  await clearOf(page, 'كلمة المرور').click();
  await expect(page.locator('.ac-strength__label')).toContainText('—');
});

test('✕ في نهاية سطر الخانة ولا تختبئ تحته الكتابة، وTab ينتقل إلى الخانة التالية لا إليه', async ({ page }) => {
  await page.goto('/register');
  for (const f of FIELDS) await field(page, f.label).fill(f.value);

  const sides = await page.evaluate(() =>
    [...document.querySelectorAll('.field__clearable')].map((w) => {
      const input = w.querySelector('input')!;
      const r = input.getBoundingClientRect();
      const cs = getComputedStyle(input);
      const x = w.querySelector('.field__clear')!.getBoundingClientRect();
      return {
        dir: cs.direction,
        // للعربي ✕ يساراً والكتابة تبدأ بعده من اليمين؛ لـ ltr ✕ يميناً بعد آخر الكتابة
        clear: x.left - r.left < r.right - x.right ? 'left' : 'right',
        clearOutsideText: cs.direction === 'rtl' ? x.right <= r.left + parseFloat(cs.paddingLeft) : x.left >= r.right - parseFloat(cs.paddingRight),
      };
    }),
  );
  expect(sides).toEqual([
    { dir: 'rtl', clear: 'left', clearOutsideText: true },
    { dir: 'ltr', clear: 'right', clearOutsideText: true },
    { dir: 'ltr', clear: 'right', clearOutsideText: true },
    { dir: 'ltr', clear: 'right', clearOutsideText: true },
  ]);

  await field(page, 'الاسم الكامل').focus();
  await page.keyboard.press('Tab');
  await expect(field(page, 'البريد الإلكتروني')).toBeFocused();
});
