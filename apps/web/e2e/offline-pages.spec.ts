import { expect, test, type Page } from '@playwright/test';
import { makeVendor, prisma, tag } from './fixtures';

/**
 * بلا اتصال — AUTH-086، 26 أكتوبر 2026. عامل الخدمة يعمل في بناء الإنتاج وحده، فيُشغَّل
 * هذا على الإنتاج (E2E_BASE_URL=http://localhost:3100) ويُتخطّى في التطوير.
 *
 * كانت الصفحات الخاصة تُترك للمتصفّح فيظهر خطؤه الإنجليزي عند الانقطاع، والعامة لا تُحفظ
 * أبداً (تُنسخ بعد تسليمها فيفشل الحفظ صامتاً) — و/offline تقول «الصفحات التي زرتها متاحة».
 */
async function controlled(page: Page): Promise<boolean> {
  await page.goto('/');
  const has = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 5000))]);
    return !!reg;
  });
  if (!has) return false;
  // التحميل الأول قبل أن يتولّى العامل الصفحة؛ بعد إعادة التحميل يمرّ كل تنقّل به
  await page.reload();
  return page.evaluate(() => !!navigator.serviceWorker.controller);
}

const cachedPages = (page: Page) =>
  page.evaluate(async () => {
    const c = await caches.open('basta-v1-pages');
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });

test('بلا اتصال: الخاصة تُظهر صفحة بسطة ولا تُحفظ، والعامة التي زيرت تُفتح من الجهاز', async ({ page, context }) => {
  test.skip(!(await controlled(page)), 'عامل الخدمة يعمل في بناء الإنتاج وحده');
  const t = tag();
  const v = await makeVendor(t);

  await page.goto(`/p/${v.productSlug}`);
  await expect(page.getByRole('heading', { level: 1, name: v.productName })).toBeVisible();
  await page.goto('/cart');
  await page.goto('/login');
  // الحفظ يجري في العامل بعد التسليم — يُنتظر حتى يظهر
  await expect.poll(() => cachedPages(page)).toContain(`/p/${v.productSlug}`);
  const saved = await cachedPages(page);
  expect(saved.filter((p) => /^\/(cart|checkout|orders|account|vendor|admin|login|register)(\/|$)/.test(p))).toEqual([]);

  await context.setOffline(true);
  try {
    // كان خطأ المتصفّح (ERR_INTERNET_DISCONNECTED) فيرمي goto نفسه
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'لا يوجد اتصال بالإنترنت' })).toBeVisible();
    await expect(page.getByText('السلة والدفع وطلباتك تحتاج اتصالاً')).toBeVisible();

    // ما زيرت تُفتح كما كانت — كانت /offline لأن شيئاً لم يُحفظ
    await page.goto(`/p/${v.productSlug}`);
    await expect(page.getByRole('heading', { level: 1, name: v.productName })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('بلا اتصال: صفحة فُتحت بالكبس على رابط داخل الموقع تُفتح من الجهاز أيضاً', async ({ page, context }) => {
  test.skip(!(await controlled(page)), 'عامل الخدمة يعمل في بناء الإنتاج وحده');
  const t = tag();
  const v = await makeVendor(t);

  // المتجر بتحميل كامل، ثم المنتج بالكبس: Next يطلب جزء الصفحة لا الصفحة — كان لا يُحفظ شيء
  await page.goto(`/s/store-${t}`);
  // الرابط ظاهر فيجهّزه Next مسبقاً — هذا لا يُحفظ، وإلا جُلبت كل صفحة يظهر رابطها
  await page.waitForTimeout(1500);
  expect(await cachedPages(page)).not.toContain(`/p/${v.productSlug}`);
  await page.getByRole('link', { name: v.productName }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: v.productName })).toBeVisible();
  await expect.poll(() => cachedPages(page)).toContain(`/p/${v.productSlug}`);

  await context.setOffline(true);
  try {
    await page.goto(`/p/${v.productSlug}`);
    await expect(page.getByRole('heading', { level: 1, name: v.productName })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

const cachedImages = (page: Page) =>
  page.evaluate(async () => {
    const c = await caches.open('basta-v1-images');
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });

// SYS-086، 3 نوفمبر 2026: مخزن الصور فارغ أبداً. الصور من أصل الخادم و<img> يطلبها no-cors، فردّها
// «معتم» (ok=false) ولا يُحفظ — وما يظهر منها بلا اتصال من ذاكرة المتصفّح المؤقتة لا من الجهاز
test('بلا اتصال: صورة المنتج تُحفظ في مخزن الصور وتُعرض منه', async ({ page, context }) => {
  test.skip(!(await controlled(page)), 'عامل الخدمة يعمل في بناء الإنتاج وحده');
  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'active', deletedAt: null, vendor: { status: 'approved' }, images: { some: {} }, variants: { some: { isActive: true, archivedAt: null } } },
    select: { slug: true },
  });

  await page.goto(`/p/${encodeURIComponent(product.slug)}`);
  await expect(page.locator('img[src*="/uploads/"]').first()).toBeVisible();
  await expect.poll(() => cachedImages(page)).not.toEqual([]);
  expect((await cachedImages(page)).every((p) => p.startsWith('/uploads/'))).toBe(true);

  await context.setOffline(true);
  try {
    await page.reload();
    const shown = page.locator('img[src*="/uploads/"]').first();
    await expect(shown).toBeVisible();
    await expect.poll(() => shown.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  } finally {
    await context.setOffline(false);
  }
});
