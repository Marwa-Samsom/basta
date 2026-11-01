import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeVendor, prisma, tag } from './fixtures';

/**
 * المحرّر لا يرسم نموذجاً لمنتج لم يُحمَّل — VCAT-019 و VCAT-100، 30 أكتوبر 2026.
 * وجدته صاحبة المشروع بحجب طلب المنتج: التنبيه يظهر والنموذج تحته فارغ و«احفظ» فعّال.
 * حفظٌ منه بعد عودة الشبكة يكتب الفراغ فوق المنتج ويؤرشف متغيّراته الغائبة عن الطلب.
 */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login?next=/vendor/products');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === '/vendor/products');
}

const productId = async (slug: string) => (await prisma.product.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id;

test('فشل التحميل: تنبيه و«أعد المحاولة» بلا نموذج، والمحاولة تفتح المنتج', async ({ page }) => {
  const v = await makeVendor(tag());
  const id = await productId(v.productSlug);
  await signIn(page, v.email);

  await page.route(`**/api/v1/vendor/products/${id}`, (route) => route.abort());
  await page.goto(`/vendor/products/${id}`);
  const retry = page.getByRole('button', { name: 'أعد المحاولة' });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('alert').filter({ has: retry })).toBeVisible();
  await expect(page.getByLabel('الاسم بالعربية')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^احفظ/ })).toHaveCount(0);

  await page.unroute(`**/api/v1/vendor/products/${id}`);
  await retry.click();
  await expect(page.getByLabel('الاسم بالعربية')).toHaveValue(v.productName);
  await expect(page.getByRole('button', { name: 'أعد المحاولة' })).toHaveCount(0);
});

test('منتج متجر آخر: «المنتج غير موجود.» ورابط العودة، بلا نموذج ولا بيانات', async ({ page }) => {
  const [mine, other] = [await makeVendor(tag()), await makeVendor(tag())];
  await signIn(page, mine.email);

  await page.goto(`/vendor/products/${await productId(other.productSlug)}`);
  await expect(page.getByText('المنتج غير موجود.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'العودة إلى المنتجات' })).toHaveAttribute('href', '/vendor/products');
  await expect(page.getByLabel('الاسم بالعربية')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^احفظ/ })).toHaveCount(0);
  await expect(page.getByText(other.productName)).toHaveCount(0);
});
