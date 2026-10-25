import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeAdmin, makeVendor, prisma, signInBuyer, tag } from './fixtures';

/**
 * «السابق» بجانب كل «المزيد» (25 أكتوبر 2026، بطلب صاحبة المشروع): يُسقط آخر صفحة
 * ألحقها «المزيد» فتعود القائمة كما كانت قبلها — في قوائم الإدارة والبائع (MoreButton)،
 * وقائمة منتجات البائع، وإشعارات الحساب. «وصل حديثاً» في الرئيسية له اختباره.
 */

async function signIn(page: Page, email: string, next: string, totp?: () => string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  if (totp) {
    await page.getByLabel('رمز التحقق الثنائي').fill(totp());
    await page.getByRole('button', { name: 'دخول' }).click();
  }
  await page.waitForURL((u) => u.pathname === next);
}

/** «المزيد» يلحق صفحة و«السابق» يظهر؛ «السابق» يعيد العدد ويختفي */
async function moreThenBack(page: Page, first: number, after: number): Promise<void> {
  const count = page.locator('.list-more__count');
  const back = page.getByRole('button', { name: 'السابق', exact: true });
  await expect(count).toHaveText(new RegExp(`^${first} من`));
  await expect(back).toHaveCount(0);
  await page.getByRole('button', { name: 'المزيد', exact: true }).click();
  await expect(count).toHaveText(new RegExp(`^${after} من`));
  await back.click();
  await expect(count).toHaveText(new RegExp(`^${first} من`));
  await expect(back).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'المزيد', exact: true })).toBeVisible();
}

test('قائمة إدارية (سجل التدقيق): «السابق» يُسقط ما ألحقه «المزيد»', async ({ page }) => {
  const admin = await makeAdmin(tag(), ['audit.view']);
  expect(await prisma.auditLog.count()).toBeGreaterThan(100);
  await signIn(page, admin.email, '/admin/audit', admin.totp);
  await moreThenBack(page, 50, 100);
});

test('منتجات البائع: «السابق» يُسقط الدفعة الأخيرة', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: v.vendorId }, orderBy: { sort: 'asc' } });
  await prisma.product.createMany({
    data: Array.from({ length: 24 }, (_, i) => ({
      vendorId: v.vendorId, vendorCategoryId: category.id, slug: `extra-${t}-${i}`, nameAr: `منتج إضافي ${i}`, status: 'draft',
    })),
  });
  await signIn(page, v.email, '/vendor/products');
  await moreThenBack(page, 20, 25);
});

test('إشعارات الحساب: «السابق» بجانب «حمّل المزيد» يعيد أول صفحة', async ({ page }) => {
  const { userId } = await signInBuyer(page);
  const at = Date.now();
  await prisma.notification.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      userId, channel: 'in_app', templateCode: 'order_placed', payloadJson: {}, status: 'sent',
      subject: `إشعار تجربة ${i}`, body: `نصّ ${i}`, sentAt: new Date(at - i * 60_000), createdAt: new Date(at - i * 60_000),
    })),
  });
  await page.goto('/account/notifications');
  const rows = page.locator('.aa-notif');
  const back = page.getByRole('button', { name: 'السابق', exact: true });
  await expect(rows).toHaveCount(20);
  await expect(back).toHaveCount(0);
  await page.getByRole('button', { name: 'حمّل المزيد' }).click();
  await expect(rows).toHaveCount(25);
  await back.click();
  await expect(rows).toHaveCount(20);
  await expect(back).toHaveCount(0);
  // المؤشّر عاد: «حمّل المزيد» يجلب الخمسة نفسها من جديد
  await page.getByRole('button', { name: 'حمّل المزيد' }).click();
  await expect(rows).toHaveCount(25);
});
