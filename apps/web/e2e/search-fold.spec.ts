import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, makeAdmin, makeVendor, prisma, tag } from './fixtures';

/**
 * خانات البحث تتجاهل فرق الحروف (4 نوفمبر 2026) — صاحبة المشروع: «لما كتبت الاسم ناقص الهمزة ما
 * ظهر». العبارة تُكتب بهمزة في غير مكانها وهاء مكان التاء المربوطة، فلا تجد شيئاً كما كُتبت. الخادم
 * يبحث بالعمود الموحَّد (apps/api: search-fold.integration.spec.ts)؛ وهنا ما تراه العين، ومعه تصفية
 * اللافتات في المتصفّح التي تُبقي نتائج سابقة حتى تصل الجديدة — كانت تُخفي ما وجده الخادم.
 */
async function signInAdmin(page: Page, next: string): Promise<void> {
  const admin = await makeAdmin(tag(), ['catalog.manage', 'content.manage']);
  await page.goto(`/login?next=${next}`);
  await page.getByLabel('البريد الإلكتروني').fill(admin.email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByLabel('رمز التحقق الثنائي').fill(admin.totp());
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((u) => u.pathname === next);
}

test('منتجات الإدارة: «ساعه الأيقاف» تجد «ساعة الإيقاف»', async ({ page }) => {
  const t = tag();
  const shop = await makeVendor(t);
  const name = `ساعة الإيقاف ${t}`;
  await prisma.product.update({ where: { slug: shop.productSlug }, data: { nameAr: name } });
  await signInAdmin(page, '/admin/products');
  await page.getByRole('searchbox', { name: 'بحث في المنتجات' }).fill(`ساعه الأيقاف ${t}`);
  await expect(page.getByRole('link').filter({ hasText: name })).toBeVisible();
});

test('اللافتات: «عروض الإعياد» تجد «عروض الأعياد» ولا تخفيها تصفية المتصفّح', async ({ page }) => {
  const t = tag();
  const title = `عروض الأعياد ${t}`;
  // مطفأة: لا تظهر في رئيسية قاعدة التطوير
  const banner = await prisma.banner.create({ data: { placement: 'home_hero', imageKey: `banners/${t}`, titleAr: title, isActive: false } });
  try {
    await signInAdmin(page, '/admin/storefront');
    await page.getByRole('searchbox', { name: 'ابحث بعنوان اللافتة' }).fill(`عروض الإعياد ${t}`);
    await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();
  } finally {
    await prisma.banner.delete({ where: { id: banner.id } });
  }
});
