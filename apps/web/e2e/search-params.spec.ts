import { expect, test } from '@playwright/test';

/**
 * رابط بحث بزيادات لا يُسقط الصفحة — DISC-033، 26 أكتوبر 2026.
 *
 * كانت صفحة البحث تمرّر كل ما في الرابط إلى الخادم، فيرفض الحقل غير المعروف والقيمة المعطوبة
 * بـ400 وتظهر «حدث خلل غير متوقّع» بدل النتائج: رابط إعلان فيسبوك (utm_*)، و page=abc،
 * و sort=popular، وكلمة فوق 120 حرفاً. الآن يُسقط ما لا يعرفه الخادم وتُقصّ الكلمة.
 */
const Q = 'قميص';
const failure = 'حدث خلل غير متوقّع';

for (const [label, extra] of [
  ['رابط إعلان (utm)', '&utm_source=facebook&utm_campaign=autumn'],
  ['رقم صفحة معطوب', '&page=abc'],
  ['ترتيب غير موجود', '&sort=popular'],
] as const) {
  test(`${label}: نتائج «${Q}» لا صفحة خلل`, async ({ page }) => {
    const res = await page.goto(`/search?q=${encodeURIComponent(Q)}${extra}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: `نتائج «${Q}»` })).toBeVisible();
    await expect(page.getByText(failure)).toHaveCount(0);
    // الزيادة لا تُحمل في روابط الترتيب والتصفية والصفحات
    await expect(page.locator('a[href*="utm_"], a[href*="page=abc"], a[href*="sort=popular"]')).toHaveCount(0);
  });
}

test('كلمة فوق 120 حرفاً: الخانة تقبل 120 والرابط المباشر يُقصّ — لا صفحة خلل', async ({ page }) => {
  const long = 'ق'.repeat(121);

  const res = await page.goto(`/search?q=${encodeURIComponent(long)}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByText(failure)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ق'.repeat(120));
  // كلمة بلا مسافات تلتفّ داخل العنوان — كانت تمدّ الصفحة إلى 2741 بكسل فتتمرّر عرضاً
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'ابحث في بسطة' });
  await box.fill(long);
  await expect(box).toHaveValue('ق'.repeat(120));
  await box.press('Enter');
  await page.waitForURL((u) => u.pathname === '/search');
  expect(new URL(page.url()).searchParams.get('q')).toHaveLength(120);
  await expect(page.getByText(failure)).toHaveCount(0);
});
