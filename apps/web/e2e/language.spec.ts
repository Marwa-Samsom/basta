import { expect, test, type Page } from '@playwright/test';

/**
 * زرّ اللغة وخانة التاريخ — 2 نوفمبر 2026. الخانة الأصلية يرسمها المتصفّح بلغته هو
 * («mm/dd/yyyy» والشهر قبل اليوم على صفحة عربية)، فصارت خانة تتبع زرّ اللغة.
 *
 * بلا دخول حقيقي: الجلسة رمز مصنوع وردود الخادم مزيّفة — اختبارات الدخول تأكل حدّ
 * المحاولات الذي تجرّب به صاحبة المشروع على الخادم نفسه.
 */

/** رمز بصيغة JWT لا يُتحقَّق من توقيعه في المتصفّح — يكفي لقرارات العرض */
const fakeToken = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub: 'e2e-admin', roles: ['admin'], permissions: ['reports.view'] })}.x`;
};

/** لوحة التقارير بمدير مزيّف وباللغة المعطاة: التقرير لا يعود أبداً، فتبقى الصفحة على خانتي الفترة */
async function reportsAs(page: Page, baseURL: string, locale: 'ar' | 'en'): Promise<string[]> {
  const asked: string[] = [];
  await page.context().addCookies([{ name: 'basta.lang', value: locale, url: baseURL }]);
  await page.addInitScript((token) => localStorage.setItem('basta.access', token), fakeToken());
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { userId: 'e2e-admin', roles: ['admin'], permissions: ['reports.view'] } }));
  await page.route('**/api/v1/admin/reports/financial?*', (r) => {
    asked.push(new URL(r.request().url()).search);
  });
  await page.route('**/api/v1/me/notifications*', (r) => r.fulfill({ json: { unread: 0, items: [] } }));
  return asked;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

test.describe('خانة التاريخ تتبع لغة الموقع', () => {
  test('بالعربية: التاريخ بأسماء الأشهر العربية والأرقام لاتينية، والتقويم يختار يوماً', async ({ page, baseURL }) => {
    const asked = await reportsAs(page, baseURL!, 'ar');
    await page.goto('/admin/reports');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // لا خانة يرسمها المتصفّح
    await expect(page.locator('input[type="date"]')).toHaveCount(0);

    const from = page.getByRole('button', { name: /^من:/ });
    await expect(from).toHaveText(/^\d{1,2} [ء-ي]+ \d{4}$/);
    await from.click();
    const dialog = page.getByRole('dialog', { name: 'اختر تاريخاً' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('السبت', { exact: false }).first()).toBeVisible();

    // السهم للأسفل أسبوع بعد اليوم المختار، و Enter يختاره
    const start = new Date(Date.now() - 30 * 86_400_000);
    const week = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate() + 7));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect.poll(() => asked.at(-1)).toContain(`from=${iso(week)}`);
    // Esc يغلقه بلا اختيار
    await from.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(from).toBeFocused();
  });

  test('بالإنجليزية: الصفحة من اليسار، والتاريخ والتقويم بالإنجليزية', async ({ page, baseURL }) => {
    await reportsAs(page, baseURL!, 'en');
    await page.goto('/admin/reports');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    // قائمة اللوحة بالإنجليزية
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();

    const from = page.getByRole('button', { name: /^من:/ });
    await expect(from).toHaveText(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    await from.click();
    const dialog = page.getByRole('dialog', { name: 'Pick a date' });
    await expect(dialog.getByRole('button', { name: 'Next month' })).toBeVisible();
    await expect(dialog.getByText('Sun', { exact: true })).toBeVisible();
  });
});

test('زرّ اللغة يقلب المتجر ويبقى بعد إعادة التحميل، ويعيده', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ar');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('link', { name: 'Sell on Basta' })).toBeVisible();
  await expect(page.getByPlaceholder('Search for a product or shop')).toBeVisible();

  await page.reload();
  await expect(html).toHaveAttribute('lang', 'en');

  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('link', { name: 'بِع على بسطة' })).toBeVisible();
});
