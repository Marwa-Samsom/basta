import { expect, type Page, test } from '@playwright/test';
import { makeVendor, PASSWORD, prisma, signInBuyer, tag } from './fixtures';

/**
 * تحويلات لوحة البائع والتأهيل تقع بعد الرسم لا أثناءه (VON-013، 28 أكتوبر 2026). كانت كل شاشة
 * تنادي `router.replace` في جسمها، فيحدّث الموجّه وهو يرسم غيره: التحويل يصل، وReact يرفضه
 * («Cannot update a component while rendering a different component») — «1 Issue» في أداة التطوير.
 */
function watch(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('Cannot update a component')) seen.push(m.text());
  });
  return seen;
}

test('متجر لم يُرسَل: «لوحة التاجر» إلى صفحة الحالة بلا تحديث أثناء الرسم', async ({ page }) => {
  const v = await makeVendor(tag());
  await prisma.vendor.update({ where: { id: v.vendorId }, data: { status: 'pending', approvedAt: null } });
  const seen = watch(page);
  await page.goto('/login?next=/account');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/account');

  await page.goto('/vendor');
  await page.waitForURL((u) => u.pathname === '/vendor/onboarding/status');
  await expect(page.getByText('مسوّدة').first()).toBeVisible();
  expect(seen).toEqual([]);
});

test('حساب بلا متجر: شاشات البائع إلى التسجيل بلا تحديث أثناء الرسم', async ({ page }) => {
  await signInBuyer(page);
  const seen = watch(page);
  for (const path of ['/vendor', '/vendor/store', '/vendor/onboarding/status', '/vendor/onboarding/currency', '/vendor/onboarding/documents']) {
    await page.goto(path);
    await page.waitForURL((u) => u.pathname === '/vendor/register');
  }
  expect(seen).toEqual([]);
});
