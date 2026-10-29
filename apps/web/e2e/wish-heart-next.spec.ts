import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeVendor, prisma, register, tag } from './fixtures';

/**
 * قلب الضيف يحوّل إلى الدخول ويعود إلى الصفحة نفسها — DISC-075، 27 أكتوبر 2026.
 *
 * كان `next` يحمل المسار وحده: من فئة «أحذية» في المتجر يعود المشتري بعد الدخول إلى «الكل».
 * الآن يحمل المعاملات معه. والضيف لا يطلب /me/wishlist أصلاً.
 */
async function signInHere(page: Page, email: string) {
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
}

test('قلب بطاقة في فئة المتجر: الدخول ثم العودة إلى الفئة نفسها', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const { vendorCategoryId } = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  const shop = `/s/store-${t}?category=${vendorCategoryId}`;
  const wishlistCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/me/wishlist')) wishlistCalls.push(r.url());
  });

  await page.goto(shop);
  const heart = page.getByRole('button', { name: `احفظ «${v.productName}» في المفضّلة` });
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();

  await page.waitForURL((u) => u.pathname === '/login');
  expect(new URL(page.url()).searchParams.get('next')).toBe(shop);
  expect(wishlistCalls).toEqual([]);

  const email = `buyer.${t}@basta.test`;
  await register(email, `مشترٍ ${t}`);
  await signInHere(page, email);
  await page.waitForURL((u) => u.pathname === `/s/store-${t}`);
  expect(new URL(page.url()).searchParams.get('category')).toBe(vendorCategoryId);
});

test('قلب صفحة المنتج: «احفظ في المفضّلة» ثم الدخول والعودة إلى المنتج', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);

  await page.goto(`/p/${v.productSlug}`);
  await page.getByRole('button', { name: 'احفظ في المفضّلة' }).click();
  await page.waitForURL((u) => u.pathname === '/login');
  expect(new URL(page.url()).searchParams.get('next')).toBe(`/p/${v.productSlug}`);

  const email = `buyer.${t}@basta.test`;
  await register(email, `مشترٍ ${t}`);
  await signInHere(page, email);
  await page.waitForURL((u) => u.pathname === `/p/${v.productSlug}`);
});
