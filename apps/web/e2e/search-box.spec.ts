import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * صندوق البحث لا يسقط بسقوط الاقتراحات: 429 أو خطأ يُفرغها ويبقى البحث يعمل، وردّ
 * قديم بطيء لا يكتب فوق ما كُتب بعده.
 */
const box = (page: Page) => page.getByRole('combobox', { name: 'ابحث في بسطة' });
const suggestRoute = (url: URL) => url.pathname.endsWith('/storefront/suggest');

test('429 من الاقتراحات: لا خطأ في الصفحة، والبحث يعمل، ولا طلبات أثناء المهلة', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let calls = 0;
  await page.route(suggestRoute, (route) => {
    calls++;
    return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ message: 'محاولات كثيرة' }) });
  });

  await page.goto('/');
  await box(page).fill('قمي');
  await expect.poll(() => calls).toBe(1);
  await page.waitForTimeout(400);
  // المهلة: كتابة أخرى لا تطلب ثانيةً
  await box(page).fill('قميص');
  await page.waitForTimeout(500);
  expect(calls).toBe(1);
  expect(errors).toEqual([]);
  await expect(box(page)).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCount(0);

  await box(page).press('Enter');
  await page.waitForURL((u) => u.pathname === '/search' && u.searchParams.get('q') === 'قميص');
});

test('ردّ قديم بطيء لا يكتب فوق الأحدث، والاقتراحات الصحيحة تظهر', async ({ page }) => {
  await page.route(suggestRoute, async (route: Route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'قم') {
      await new Promise((r) => setTimeout(r, 900));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ suggestions: ['اقتراح قديم'] }) }).catch(() => undefined);
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ suggestions: ['قميص قطني', 'قميص كتان'] }) });
  });

  await page.goto('/');
  await box(page).fill('قم');
  await page.waitForTimeout(300);
  await box(page).fill('قمي');
  await expect(page.getByRole('option', { name: 'قميص قطني' })).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.getByRole('option', { name: 'اقتراح قديم' })).toHaveCount(0);
  // داخل قائمة الاقتراحات وحدها: زرّ العملة في الرأس قائمة أصلية خياراتها «option» أيضاً
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(2);
});
