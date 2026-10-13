import { expect, test, type Page } from '@playwright/test';
import { API, PASSWORD, makeVendor, prisma, register, tag } from './fixtures';

/**
 * الخروج ينهي الجلسة في الخادم لا في المتصفّح وحده: رمز التحديث مُبطَل وكوكيه
 * ممسوح، ورمز وصول نُسخ قبل الخروج يرتدّ 401 فوراً. والزرّ موجود للمشتري
 * والبائع — كان للإدارة وحدها.
 */
async function signIn(page: Page, email: string, next: string): Promise<string> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === next);
  return (await page.evaluate(() => localStorage.getItem('basta.access')))!;
}

async function expectSignedOut(page: Page, userId: string, copiedAccess: string) {
  expect(await page.evaluate(() => localStorage.getItem('basta.access'))).toBeNull();
  // الكوكي على نطاق الواجهة — المتصفّح يكلّم الـ API عبر /api/v1 منها
  const cookies = await page.context().cookies(new URL('/api/v1/auth/refresh', page.url()).href);
  expect(cookies.find((c) => c.name === 'basta_rt')).toBeUndefined();
  expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  const replay = await fetch(`${API}/me/account`, { headers: { authorization: `Bearer ${copiedAccess}` } });
  expect(replay.status).toBe(401);
}

test('المشتري يخرج من قائمة حسابه، والجلسة تنتهي في الخادم', async ({ page }) => {
  const t = tag();
  const email = `logout.${t}@basta.test`;
  const userId = await register(email, `مشترٍ ${t}`);
  const access = await signIn(page, email, '/account');

  await page.getByRole('navigation', { name: 'حسابي' }).getByRole('button', { name: 'خروج' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expectSignedOut(page, userId, access);
});

test('البائع يخرج من لوحته، والجلسة تنتهي في الخادم', async ({ page }) => {
  const v = await makeVendor(tag());
  const access = await signIn(page, v.email, '/vendor/orders');

  await page.getByRole('button', { name: 'خروج' }).click();
  await page.waitForURL((u) => u.pathname === '/login');
  await expectSignedOut(page, v.userId, access);
});
