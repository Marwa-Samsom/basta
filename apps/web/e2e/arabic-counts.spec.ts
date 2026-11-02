import { expect, test } from '@playwright/test';
import { counted, ORDERS, PRODUCTS, STORES } from '../src/lib/arabic-count';
import { makeVendor, PASSWORD, prisma, tag } from './fixtures';

/**
 * العدد ومعدوده في لوحتي التاجر والإدارة — الموجة 4، 2 نوفمبر 2026 (VCAT-007، VOPS-006، ADM-020).
 * رأت صاحبة المشروع «4 منتج · 0 معروض» و«2 طلبات تنتظر قبولك» و«15 طلب ينتظر»: كانت العدّادات تلصق
 * المفرد بأي رقم. ونصيحة «جرّب اسماً أو رمزاً أقصر» كانت تظهر تحت تبويب فارغ ولا بحث.
 */

test('التصريف: الواحد والاثنان بلفظهما، و3–10 جمع، و11–99 منصوب، والمئة والصفر مجرور', () => {
  const table: [number, string][] = [
    [0, '0 منتج'],
    [1, 'منتج واحد'],
    [2, 'منتجان'],
    [4, '4 منتجات'],
    [10, '10 منتجات'],
    [11, '11 منتجاً'],
    [99, '99 منتجاً'],
    [100, '100 منتج'],
    [103, '103 منتجات'],
    [1359, '1,359 منتجاً'],
  ];
  for (const [n, text] of table) expect(counted(n, PRODUCTS), String(n)).toBe(text);
  expect(counted(15, ORDERS)).toBe('15 طلباً');
  expect(counted(5, STORES)).toBe('5 متاجر');
});

test('لوحة التاجر: «منتجان» في الرأس، ونصيحة التبويب الفارغ بلا بحث، وطلبان ينتظران القبول', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: v.vendorId }, orderBy: { sort: 'asc' } });
  await prisma.product.create({ data: { vendorId: v.vendorId, vendorCategoryId: category.id, slug: `draft-${t}`, nameAr: `مسوّدة ${t}`, descriptionAr: 'منتج اختبار.', status: 'draft' } });

  await page.goto('/login?next=/vendor/products');
  await page.getByLabel('البريد الإلكتروني').fill(v.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/products');

  await expect(page.getByText('منتجان', { exact: true })).toBeVisible();
  await expect(page.getByText(/\d منتج$/)).toHaveCount(0);

  // «مؤرشف» فارغ ولا بحث: لا «اسماً أقصر»
  await page.getByRole('tab', { name: /^مؤرشف/ }).click();
  await expect(page.getByText('لا منتجات تطابق هذا الفلتر.')).toBeVisible();
  await expect(page.getByText('لا منتج في هذه الحالة الآن — انتقل إلى تبويب آخر.')).toBeVisible();
  await expect(page.getByText(/اسماً أو رمزاً أقصر/)).toHaveCount(0);
  // ومع بحث تعود نصيحته، والرأس «منتجان · المعروض 0»
  await page.getByPlaceholder('ابحث بالاسم أو الرمز').fill('لايوجد123');
  await expect(page.getByText('جرّب اسماً أو رمزاً أقصر، أو انتقل إلى تبويب آخر.')).toBeVisible();
  await expect(page.getByText('منتجان · المعروض 0')).toBeVisible();

  // شريط القبول بعدد الطلبات المنتظرة كما يردّه الخادم
  let waiting = 2;
  await page.route(
    (url) => url.pathname === '/api/v1/vendor/orders',
    (route) => route.fulfill({ json: { items: [], total: 0, counts: { awaiting_vendor: waiting }, acceptanceHours: 48 } }),
  );
  await page.goto('/vendor/orders');
  await expect(page.getByText('طلبان ينتظران قبولك')).toBeVisible();
  waiting = 11;
  await page.reload();
  await expect(page.getByText('11 طلباً ينتظر قبولك')).toBeVisible();
  waiting = 1;
  await page.reload();
  await expect(page.getByText('طلب واحد ينتظر قبولك')).toBeVisible();
});
