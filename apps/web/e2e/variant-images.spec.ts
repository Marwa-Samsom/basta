import { expect, test } from '@playwright/test';
import { PASSWORD, makeVendor, png, prisma, tag } from './fixtures';

/**
 * صورة للون: البائع يختار تحت الصورة اللون الذي تُظهره، فتقفز صفحة المنتج إليها حين
 * يختاره المشتري، وتظهر في سلّته. كان الربط عند الرفع وحده بلا واجهة، والصفحة تتجاهله.
 */
test('البائع يربط صورة باللون، فتقفز إليها الصفحة حين يختاره المشتري وتظهر في سلّته', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const color = await prisma.attribute.findUniqueOrThrow({ where: { code: 'color' }, include: { values: true } });
  const red = color.values.find((x) => x.valueEn === 'Red')!;
  const blue = color.values.find((x) => x.valueEn === 'Blue')!;

  // منتج بلونين: المتغيّر الوحيد يصير أحمر، ويُضاف أزرق
  const product = await prisma.product.update({
    where: { slug: v.productSlug },
    data: { status: 'draft', publishedAt: null, hasVariants: true },
  });
  await prisma.productVariant.update({
    where: { id: v.variantId },
    data: { optionsKey: red.id, optionValues: { create: { attributeId: color.id, attributeValueId: red.id } } },
  });
  const blueVariant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      vendorId: product.vendorId,
      sku: `E2E-BLUE-${t}`.toUpperCase(),
      priceMinorUnits: 25_000n,
      optionsKey: blue.id,
      isActive: true,
      optionValues: { create: { attributeId: color.id, attributeValueId: blue.id } },
    },
  });
  await prisma.inventory.create({ data: { variantId: blueVariant.id, onHand: 10, reserved: 0 } });
  await prisma.inventoryMovement.create({ data: { variantId: blueVariant.id, delta: 10, reason: 'import' } });

  // 1 · البائع يرفع صورتين ويربط الثانية بالأزرق
  await page.goto(`/login?next=${encodeURIComponent(`/vendor/products/${product.id}`)}`);
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.locator('input[type=file]').setInputFiles([
    { name: 'غلاف.png', mimeType: 'image/png', buffer: png(500, 500, [180, 30, 40]) },
    { name: 'أزرق.png', mimeType: 'image/png', buffer: png(500, 500, [30, 60, 170]) },
  ]);
  const gallery = page.getByRole('list', { name: 'صور المنتج' });
  await expect(gallery.getByRole('img')).toHaveCount(2);
  await page.getByLabel('الصورة 2 تظهر مع').selectOption({ label: 'اللون: أزرق' });
  const [cover, blueImage] = await prisma.productImage.findMany({ where: { productId: product.id }, orderBy: { sort: 'asc' } });
  await expect.poll(async () => (await prisma.productImage.findUniqueOrThrow({ where: { id: blueImage!.id } })).optionValueId).toBe(blue.id);
  // الربط لا يعيد المنتج للمراجعة ولا يغيّر شيئاً غير الصورة
  expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('draft');

  // نُشر (اعتمده المراجِع)
  await prisma.product.update({ where: { id: product.id }, data: { status: 'active', publishedAt: new Date() } });

  // 2 · المشتري: الغلاف أولاً، واختيار الأزرق يقفز إلى صورته، والأحمر لا صورة له فيبقى ما يراه
  await page.goto(`/p/${encodeURIComponent(v.productSlug)}`);
  const stage = page.locator('.sd-gallery__stage img');
  await expect(stage).toHaveAttribute('src', new RegExp(cover!.fileKey));
  await page.getByRole('button', { name: 'أزرق', exact: true }).click();
  await expect(stage).toHaveAttribute('src', new RegExp(blueImage!.fileKey));
  await expect(page.getByRole('button', { name: 'صورة 2 من 2' })).toHaveAttribute('aria-pressed', 'true');

  // 3 · في السلة صورة الأزرق لا الغلاف
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await page.goto('/cart');
  await expect(page.locator(`img[src*="${blueImage!.fileKey}"]`).first()).toBeVisible();
});
