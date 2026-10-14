import { expect, test } from '@playwright/test';
import { PASSWORD, makeVendor, png, prisma, tag } from './fixtures';

/**
 * البائع يرفع صور منتجه من المحرّر: كانت الواجهة بلا مكان للصور أصلاً، والإرسال لا
 * يشترطها — فيصل كل منتج المراجعة بلا صورة. الآن الصورة شرط الإرسال، وتُرفع
 * وتُرتَّب (الأولى هي الرئيسية) من المحرّر نفسه عبر ممرّ /api/v1.
 */
test('صور المنتج: الإرسال يُمنع بلا صورة، ثم تُرفع صورتان وتُختار الرئيسية ويُرسل', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const product = await prisma.product.update({ where: { slug: v.productSlug }, data: { status: 'draft', publishedAt: null } });

  await page.goto(`/login?next=${encodeURIComponent(`/vendor/products/${product.id}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /الصور/ })).toBeVisible();

  // بلا صورة: العائق يُعرض ولا يُرسل
  await page.getByRole('button', { name: 'أرسل للمراجعة' }).click();
  await expect(page.getByText('أضف صورة واحدة على الأقل')).toBeVisible();
  expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('draft');

  // صورتان دفعة واحدة — كما يختارهما البائع من جهازه
  await page.locator('input[type=file]').setInputFiles([
    { name: 'أحمر.png', mimeType: 'image/png', buffer: png(500, 500, [180, 30, 40]) },
    { name: 'أزرق.png', mimeType: 'image/png', buffer: png(640, 480, [30, 60, 170]) },
  ]);
  const gallery = page.getByRole('list', { name: 'صور المنتج' });
  await expect(gallery.getByRole('img')).toHaveCount(2);
  await expect(page.getByText('أضف صورة واحدة على الأقل')).toHaveCount(0);
  const [red, blue] = await prisma.productImage.findMany({ where: { productId: product.id }, orderBy: { sort: 'asc' } });
  expect(red!.width).toBe(500);
  expect(blue!.width).toBe(640);

  // الثانية تصير الرئيسية بزرّ — بلا سحب، كما على شاشة لمس
  await gallery.getByRole('button', { name: 'اجعلها الرئيسية' }).click();
  await expect
    .poll(async () => (await prisma.productImage.findFirst({ where: { productId: product.id }, orderBy: { sort: 'asc' } }))?.id)
    .toBe(blue!.id);
  await expect(gallery.getByRole('listitem').first()).toContainText('الرئيسية');

  // والآن يُرسل
  await page.getByRole('button', { name: 'أرسل للمراجعة' }).click();
  await expect(page.getByText('أُرسل المنتج إلى مراجعة الإدارة.')).toBeVisible();
  expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('pending_review');

  // المعروض للمراجعة لا يبقى بلا صورة: حذف الأولى يمرّ، وحذف الأخيرة يُرفض برسالة
  await gallery.getByRole('button', { name: 'احذف الصورة 1' }).click();
  await expect(gallery.getByRole('img')).toHaveCount(1);
  await gallery.getByRole('button', { name: 'احذف الصورة 1' }).click();
  await expect(page.getByText('هذه الصورة الوحيدة للمنتج')).toBeVisible();
  await expect(gallery.getByRole('img')).toHaveCount(1);
});
