import { expect, test } from '@playwright/test';
import { makeVendor, prisma, tag } from './fixtures';

/**
 * «أزل» بجانب الكوبون المطبَّق — 27 أكتوبر 2026، بطلب صاحبة المشروع أثناء CHK-032.
 * كان الكوبون يبقى معلّقاً على السلة: يُزال بـ«طبّق» والخانة فارغة وحدها، طريق لا يراه أحد.
 */
test('«أزل» يرفع الكوبون المطبَّق ويعيد الإجمالي', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const code = `OFF-${t}`.toUpperCase();
  await prisma.coupon.create({ data: { code, scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform' } });

  await page.goto(`/p/${encodeURIComponent(v.productSlug)}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await page.getByRole('link', { name: 'اذهب إلى السلة' }).click();
  await page.waitForURL((u) => u.pathname === '/cart');
  const total = page.locator('.sp-sum__total dd');
  const before = await total.innerText();

  await page.getByLabel('كود الخصم').fill(code);
  await page.getByRole('button', { name: 'طبّق' }).click();
  await expect(page.getByText('الكوبون المطبَّق:')).toBeVisible();
  await expect(total).not.toHaveText(before);

  await page.getByRole('button', { name: `أزل الكوبون ${code}` }).click();
  await expect(page.getByText('الكوبون المطبَّق:')).toHaveCount(0);
  await expect(total).toHaveText(before);
  const cart = await prisma.cart.findFirstOrThrow({ where: { items: { some: { variantId: v.variantId } } }, orderBy: { createdAt: 'desc' } });
  expect(cart.couponCode).toBeNull();
});
