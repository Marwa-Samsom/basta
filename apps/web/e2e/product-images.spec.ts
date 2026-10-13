import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { PASSWORD, makeVendor, prisma, tag } from './fixtures';

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

/** PNG بلون واحد بلا مكتبة — يكفي الخادم ليقرأه ويعيد كتابته */
function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 بت، RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let c = ~0;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
