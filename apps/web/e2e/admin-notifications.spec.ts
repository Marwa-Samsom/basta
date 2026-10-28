import { expect, type Page, test } from '@playwright/test';
import { makeAdmin, makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * صندوق إشعارات الإدارة — بطلب صاحبة المشروع (28 أكتوبر 2026). كان للمدير الجرس وحده، و«كل
 * الإشعارات» تحته يفتح صفحة المشتري (وللبائع كذلك مع أن له صندوقه). القوالب انتقلت إلى
 * /admin/notifications/templates كما في التصميم (AD-20).
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

test('المدير: «الإشعارات» في القائمة تفتح صندوقه، و«كل الإشعارات» في الجرس إليه، والقوالب في مكانها', async ({ page }) => {
  const t = tag();
  const admin = await makeAdmin(t, ['disputes.resolve', 'content.manage']);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: admin.email } });
  const body = `نزاع مصعَّد على BST-${t}-1 (متجر الاختبار): لم يصلني الاسترداد. ينتظر حسمك.`;
  await prisma.notification.create({
    data: { userId: user.id, channel: 'in_app', templateCode: 'admin_dispute_escalated', status: 'sent', sentAt: new Date(), body, payloadJson: { link: '/admin/disputes' } },
  });
  await signIn(page, admin.email, '/admin', admin.totp);

  // القائمة الجانبية → الصندوق
  await page.getByRole('link', { name: 'الإشعارات', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/admin/notifications');
  await expect(page.getByRole('heading', { name: 'الإشعارات', level: 1 })).toBeVisible();
  const item = page.locator('.vx-note', { hasText: body });
  await expect(item).toContainText('نزاع مصعَّد ينتظر الحسم');
  await page.getByRole('button', { name: /^النزاعات/ }).click();
  await expect(item).toBeVisible();

  // الجرس: «كل الإشعارات» إلى صندوق الإدارة لا صفحة المشتري
  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  await expect(page.getByRole('link', { name: 'كل الإشعارات' })).toHaveAttribute('href', '/admin/notifications');

  // القوالب في مكانها الجديد
  await page.goto('/admin/notifications/templates');
  await expect(page.getByRole('heading', { name: 'قوالب الإشعارات', level: 1 })).toBeVisible();
});

test('البائع: «كل الإشعارات» في الجرس إلى صندوقه لا صفحة المشتري', async ({ page }) => {
  const v = await makeVendor(tag());
  await signIn(page, v.email, '/vendor/notifications');
  await expect(page.getByRole('heading', { name: 'الإشعارات', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  await expect(page.getByRole('link', { name: 'كل الإشعارات' })).toHaveAttribute('href', '/vendor/notifications');
});
