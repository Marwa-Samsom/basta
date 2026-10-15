import { expect, test } from '@playwright/test';
import { API, PASSWORD, makeAdmin, makeVendor, prisma, tag } from './fixtures';

/**
 * لا مراجعة قبل النشر (قرار صاحب المشروع 15 أكتوبر 2026): المنتج المنشور يظهر فوراً،
 * وللإدارة بعده قرار واحد — إيقاف المخالف بسبب يصل البائع حرفياً، فيختفي من المتجر
 * حتى يعدّله البائع وينشره من جديد.
 */
test('الإدارة توقف منشوراً مخالفاً بسبب: يختفي من المتجر، والسبب محفوظ للبائع', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const admin = await makeAdmin(t, ['catalog.manage']);
  const product = await prisma.product.findUniqueOrThrow({ where: { slug: v.productSlug } });
  const reason = `الصور لا تطابق المنتج ${t}`;
  // من الـ API لا من صفحة المنتج: الصفحة تُخزَّن دقيقة (ISR)، والقاعدة تقول الحال الآن
  const shown = async () => (await fetch(`${API}/storefront/products/${encodeURIComponent(v.productSlug)}`)).status;

  // منشور ويظهر للمشترين بلا اعتماد أحد
  expect(product.status).toBe('active');
  expect(await shown()).toBe(200);

  await page.goto(`/login?next=${encodeURIComponent(`/admin/products/${product.id}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('heading', { level: 1, name: v.productName })).toBeVisible();
  await expect(page.getByRole('button', { name: /اعتمد/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'أوقف المنتج بسبب' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('السبب').fill(reason);
  await dialog.getByRole('button', { name: 'أوقف المنتج بسبب' }).click();
  await expect(page.getByText('أُوقف المنتج وأُبلغ البائع بالسبب.')).toBeVisible();

  const stopped = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  expect(stopped).toMatchObject({ status: 'rejected', rejectReason: reason });
  expect(await shown()).toBe(404);
});
