import { expect, test } from '@playwright/test';
import { PASSWORD, makeAdmin, makeVendor, prisma, tag } from './fixtures';

/**
 * المدير يعتمد ما قرأه: البائع عدّل المنتج بعد أن فتحه المراجِع، فالاعتماد
 * يُردّ وتُعرض النسخة الحالية — ولا يُنشر إلا بعد أن يعتمدها هي.
 */
test('تعديل البائع أثناء المراجعة: الاعتماد يُردّ، والنسخة الجديدة تُعرض ثم تُعتمد', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const admin = await makeAdmin(t, ['catalog.manage']);
  const product = await prisma.product.update({ where: { slug: v.productSlug }, data: { status: 'pending_review', publishedAt: null } });

  await page.goto(`/login?next=${encodeURIComponent(`/admin/products/${product.id}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('heading', { level: 1, name: v.productName })).toBeVisible();

  // البائع يغيّر الاسم والمدير ما زال على النسخة التي فتحها
  await prisma.product.update({ where: { id: product.id }, data: { nameAr: `اسم لم يقرأه أحد ${t}`, contentRevision: { increment: 1 } } });
  await page.getByRole('button', { name: 'اعتمد وانشر' }).click();
  await expect(page.getByText('عدّل البائع المنتج منذ فتحته')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: `اسم لم يقرأه أحد ${t}` })).toBeVisible();
  expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('pending_review');

  // قرأ الجديد — يعتمده
  await page.getByRole('button', { name: 'اعتمد وانشر' }).click();
  await expect.poll(async () => (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('active');
});
