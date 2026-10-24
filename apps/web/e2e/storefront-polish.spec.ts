import { expect, test } from '@playwright/test';
import { prisma, signInBuyer } from './fixtures';

/**
 * تحسينات طلبتها صاحبة المشروع بعد تجربة المتجر (24 أكتوبر 2026): قائمة الجرس
 * تُغلق كأي قائمة منسدلة، و«وصل حديثاً» في الرئيسية يكبر بـ«المزيد» في مكانه.
 */
test('الجرس: تُغلق قائمته بنقرة في أي مكان خارجها وبـ Esc، والنقر داخلها لا يغلقها', async ({ page }) => {
  await signInBuyer(page);
  await page.goto('/');
  const bell = page.getByRole('button', { name: /^الإشعارات/ });
  const panel = page.locator('.bell__panel');

  await bell.click();
  await expect(panel).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(panel).toBeHidden();

  await bell.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await bell.click();
  await panel.getByText('الإشعارات', { exact: true }).click();
  await expect(panel).toBeVisible();
  // والجرس نفسه ما زال يقلبها
  await bell.click();
  await expect(panel).toBeHidden();
});

test('الرئيسية: «المزيد» تحت «وصل حديثاً» يجلب الصفحة التالية في مكانها بلا تكرار، و«السابق» يُسقطها', async ({ page }) => {
  test.skip((await prisma.product.count({ where: { status: 'active' } })) <= 24, 'يحتاج أكثر من 24 منتجاً منشوراً');
  await page.goto('/');
  const latest = page.locator('section', { has: page.getByRole('heading', { name: 'وصل حديثاً' }) });
  const cards = latest.locator('.pgrid > *');
  const more = latest.getByRole('button', { name: 'المزيد' });
  const back = latest.getByRole('button', { name: 'السابق' });
  await expect(cards).toHaveCount(12);
  // لا «سابق» قبل أن يُضاف شيء
  await expect(back).toHaveCount(0);

  await more.click();
  await expect.poll(() => cards.count()).toBeGreaterThan(12);
  const afterOne = await cards.count();
  await more.click();
  await expect.poll(() => cards.count()).toBeGreaterThan(afterOne);
  const links = await latest.locator('.pgrid a[href^="/p/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(new Set(links).size).toBe(await cards.count());

  // «السابق» يُسقط آخر دفعة بقدرها، ثم الأولى فيعود كما بدأ بلا «سابق»
  await back.click();
  await expect(cards).toHaveCount(afterOne);
  await back.click();
  await expect(cards).toHaveCount(12);
  await expect(back).toHaveCount(0);
  await expect(more).toBeVisible();
  await expect(page).toHaveURL('/');
});
