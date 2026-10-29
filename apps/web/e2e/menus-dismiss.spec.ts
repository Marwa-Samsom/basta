import { expect, test } from '@playwright/test';

/**
 * القوائم تُغلق بالضغط خارجها — 27 أكتوبر 2026، بطلب صاحبة المشروع أثناء DISC-076.
 *
 * «الترتيب» و«تصفية» (الجوال) `<details>` أصلي: كان يبقى مفتوحاً حتى يُضغط زرّه نفسه،
 * وبعد اختيار ترتيب يبقى مفتوحاً فوق النتائج الجديدة. الآن يُغلق خارجه وبـ Esc وبالاختيار.
 */
const Q = encodeURIComponent('قميص');

test('«الترتيب»: يُغلق بالضغط خارجه وبـ Esc وباختيار ترتيب', async ({ page }) => {
  await page.goto(`/search?q=${Q}`);
  const menu = page.locator('details.sd-sort');
  const button = menu.locator('summary');

  await button.click();
  await expect(menu).toHaveAttribute('open');
  await page.getByRole('heading', { level: 1 }).click();
  await expect(menu).not.toHaveAttribute('open');

  await button.click();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open');
  await expect(button).toBeFocused();

  await button.click();
  await menu.getByRole('link', { name: 'الأحدث' }).click();
  await page.waitForURL((u) => u.searchParams.get('sort') === 'newest');
  await expect(menu).not.toHaveAttribute('open');
});

test('«تصفية» على الجوال: الضغط داخله لا يُغلقه، وخارجه يُغلقه', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/search?q=${Q}`);
  const drawer = page.locator('details.sd-facets-m');

  await drawer.locator('summary').click();
  await expect(drawer).toHaveAttribute('open');
  await drawer.locator('.sd-facets-m__body').click({ position: { x: 4, y: 4 } });
  await expect(drawer).toHaveAttribute('open');
  await page.getByRole('heading', { level: 1 }).click();
  await expect(drawer).not.toHaveAttribute('open');
});
