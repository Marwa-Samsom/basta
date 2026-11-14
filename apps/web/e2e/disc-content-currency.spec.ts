import { expect, test } from '@playwright/test';
import { API, prisma } from './fixtures';
import { addProduct, indexProducts, makeShop, retire, word, type Shop } from './disc-helpers';

/**
 * صفحات المحتوى — ST-30 (DISC-084 · 085)، وزرّ عملة العرض في الرأس (DISC-091 · 092).
 */
const shops: Shop[] = [];
const pages: string[] = [];
test.afterAll(async () => {
  await retire(...shops);
  // صفحات الاختبار تبقى مسودّات لا تظهر لأحد
  if (pages.length) await prisma.cmsPage.updateMany({ where: { id: { in: pages } }, data: { isPublished: false } });
});
async function shop(currency = 'JOD'): Promise<Shop> {
  const s = await makeShop({ currency });
  shops.push(s);
  return s;
}
async function cmsPage(slug: string, titleAr: string, bodyAr: string, isPublished: boolean) {
  const page = await prisma.cmsPage.create({ data: { slug, titleAr, bodyAr, isPublished } });
  pages.push(page.id);
  return page;
}

test('DISC-084: «من نحن» من التذييل بعنوان التبويب، وصفحة منشورة بعنوانها و«آخر تحديث» بأرقام لاتينية في <time> وفقراتها، و<b> نصّاً حرفياً', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  for (const [label, href] of [
    ['من نحن', '/pages/about'],
    ['الأسئلة الشائعة', '/pages/faq'],
    ['اتصل بنا', '/pages/contact'],
    ['سياسة الإرجاع', '/pages/returns'],
  ] as const) {
    await expect(footer.getByRole('link', { name: label, exact: true }), label).toHaveAttribute('href', href);
  }
  await footer.getByRole('link', { name: 'من نحن', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/pages/about');
  await expect(page).toHaveTitle('من نحن · بسطة');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('من نحن');
  // الروابط الأخرى تفتح صفحاتها المنشورة
  for (const [label, href] of [['الأسئلة الشائعة', '/pages/faq'], ['اتصل بنا', '/pages/contact'], ['سياسة الإرجاع', '/pages/returns']] as const) {
    await page.locator('footer').getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL((u) => u.pathname === href);
    await expect(page.getByRole('heading', { level: 1 }), label).toHaveText(label);
  }

  const t = word();
  const body = 'بسطة سوق للمتاجر المستقلة.\n\nنبدأ من الأردن\nثم الخليج.\n\nكل متجر <b>عريض</b> بحقّه.';
  const content = await cmsPage(`disc-${t}`, `عن بسطة ${t}`, body, true);
  await page.goto(`/pages/disc-${t}`);
  await expect(page).toHaveTitle(`عن بسطة ${t} · بسطة`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`عن بسطة ${t}`);
  const time = page.locator('.ac-page__updated time');
  await expect(page.locator('.ac-page__updated')).toContainText('آخر تحديث');
  await expect(time).toHaveAttribute('dateTime', content.updatedAt.toISOString());
  await expect(time).toHaveText(/^\d{1,2} \S+ \d{4}$/);
  await expect(time).not.toHaveText(/[٠-٩]/);
  const paragraphs = page.locator('.ac-prose p');
  await expect(paragraphs).toHaveCount(3);
  // السطر المفرد يبقى داخل فقرته
  expect(await paragraphs.nth(1).evaluate((p) => p.textContent)).toBe('نبدأ من الأردن\nثم الخليج.');
  await expect(paragraphs.nth(2)).toHaveText('كل متجر <b>عريض</b> بحقّه.');
  await expect(page.locator('.ac-prose b')).toHaveCount(0);
});

test('DISC-085: المسودّة وغير الموجودة صفحة 404، وإلغاء نشر صفحة زيرت: الـ API 404 «الصفحة غير موجودة.» فوراً', async ({ page }) => {
  const t = word();
  await cmsPage(`disc-terms-${t}`, 'الشروط', 'نص الشروط.', false);
  for (const slug of [`disc-terms-${t}`, 'لا-يوجد']) {
    const res = await page.goto(`/pages/${slug}`);
    expect(res?.status(), slug).toBe(404);
    await expect(page.getByText('لم نجد هذه الصفحة'), slug).toBeVisible();
  }

  const faq = await cmsPage(`disc-faq-${t}`, `أسئلة ${t}`, 'سؤال وجواب.', true);
  expect((await page.goto(`/pages/disc-faq-${t}`))?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`أسئلة ${t}`);
  await prisma.cmsPage.update({ where: { id: faq.id }, data: { isPublished: false } });
  const api = await fetch(`${API}/pages/disc-faq-${t}`);
  expect(api.status).toBe(404);
  expect(((await api.json()) as { message: string }).message).toBe('الصفحة غير موجودة.');
});

// المتوقَّع: الصفحة المخزّنة تبقى حتى 5 دقائق ثم 404. الواقع: بعد إلغاء النشر بقيت /pages/<slug> 200 بالنسخة
// القديمة أكثر من 6 دقائق — إعادة التوليد في الخلفية ترمي notFound() فيُبقي Next النسخة المخزّنة. قرار صاحبة المشروع.
test.fixme('DISC-085: بعد إلغاء النشر تصير الصفحة المخزّنة 404 خلال 5 دقائق', async ({ page }) => {
  test.setTimeout(480_000);
  const t = word();
  const faq = await cmsPage(`disc-faq-${t}`, `أسئلة ${t}`, 'سؤال وجواب.', true);
  expect((await page.goto(`/pages/disc-faq-${t}`))?.status()).toBe(200);
  await prisma.cmsPage.update({ where: { id: faq.id }, data: { isPublished: false } });
  await expect
    .poll(async () => (await page.goto(`/pages/disc-faq-${t}`))?.status(), { timeout: 330_000, intervals: [10_000, 30_000] })
    .toBe(404);
});

/** معامل الدفع من أسعار القاعدة مستقلّاً عن الخدمة: (هدف ÷ مصدر) × 10^(فرق الخانات) × (1 + الهامش) */
async function sarToUsdMinor(minor: number): Promise<number> {
  const sar = Number((await prisma.exchangeRate.findFirstOrThrow({ where: { baseCode: 'USD', quoteCode: 'SAR', effectiveAt: { lte: new Date() } }, orderBy: { effectiveAt: 'desc' } })).rate);
  const spread = Number((await prisma.setting.findUnique({ where: { key: 'fx_spread_bps' } }))?.valueJson ?? 200);
  return Math.round((minor / sar) * (1 + spread / 10_000));
}

test('DISC-091: زرّ العملة «JOD» وقائمته بالأسماء الكاملة للمتاحة، و USD يكتب الكوكي ويعيد التحميل فيصير السعر 40.80 US$ وتحته سعر المتجر، والبطاقات بالدولار، ويبقى بعد إعادة فتح المتصفّح', async ({ page, context, browser }) => {
  const s = await shop('SAR');
  const w = word();
  const p = await addProduct(s, { nameAr: `${w} منتج بالريال`, price: 15_000n });
  await indexProducts(s, [p.id], { q: w, total: 1 });
  const available = ((await (await fetch(`${API}/storefront/currencies`)).json()) as { currencies: { code: string; nameAr: string }[] }).currencies;

  await page.goto(`/p/${p.slug}`);
  const picker = page.locator('header .cur-pick');
  await expect(picker.locator('.cur-pick__code')).toHaveText('JOD');
  await expect(picker.locator('svg')).toHaveCount(1);
  const select = picker.getByRole('combobox', { name: 'عملة العرض والدفع' });
  await expect(select.locator('option')).toHaveText(available.map((c) => `${c.nameAr} (${c.code})`));
  await expect(select.locator('option', { hasText: 'دينار أردني (JOD)' })).toHaveCount(1);

  await Promise.all([page.waitForEvent('load'), select.selectOption('USD')]);
  await expect(picker.locator('.cur-pick__code')).toHaveText('USD');
  const cookie = (await context.cookies()).find((c) => c.name === 'basta.currency');
  expect(cookie?.value).toBe('USD');
  // سنة لا جلسة: يبقى بعد إغلاق المتصفّح
  expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86_400);

  const usd = (await sarToUsdMinor(15_000)) / 100;
  expect(usd.toFixed(2)).toBe('40.80');
  await expect(page.locator('.sd-price__now')).toContainText(`${usd.toFixed(2)} US$`);
  await expect(page.locator('.sd-price__store')).toContainText('150.00 ر.س');
  await expect(page.locator('.sd-price__store')).toContainText('بعملة المتجر');

  for (const path of ['/', `/search?q=${w}`, `/s/${s.slug}`]) {
    await page.goto(path);
    await expect(page.locator('header .cur-pick__code'), path).toHaveText('USD');
    const prices = page.locator('article.pcard .money');
    await expect(prices.first(), path).toContainText('US$');
    await expect(page.locator('article.pcard').first(), path).not.toContainText('بعملة المتجر');
  }
  const mine = page.locator('article.pcard', { hasText: p.nameAr });
  await expect(mine.locator('.money')).toContainText(`${usd.toFixed(2)} US$`);
  await expect(mine).not.toContainText('ر.س');

  // «إغلاق المتصفّح وفتحه»: سياق جديد بالكوكيز المحفوظة على الجهاز
  const reopened = await browser.newContext({ baseURL: test.info().project.use.baseURL!, locale: 'ar', storageState: await context.storageState() });
  const again = await reopened.newPage();
  await again.goto(`/p/${p.slug}`);
  await expect(again.locator('header .cur-pick__code')).toHaveText('USD');
  await expect(again.locator('.sd-price__now')).toContainText('US$');
  await reopened.close();
});

test('DISC-092: على عرض 375 الزرّ في صفّ أدوات الرأس بلا تمرير أفقي، وكوكي GBP يدوي يُعرض بالدينار والزرّ «JOD»', async ({ page, context }) => {
  const s = await shop('JOD');
  const p = await addProduct(s, { nameAr: `منتج الجوال ${s.t}`, price: 12_000n });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/p/${p.slug}`);
  const picker = page.locator('header .store__tools .cur-pick');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.cur-pick__code')).toHaveText('JOD');
  const box = await picker.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await context.addCookies([{ name: 'basta.currency', value: 'GBP', url: test.info().project.use.baseURL! }]);
  await page.reload();
  await expect(page.locator('header .cur-pick__code')).toHaveText('JOD');
  await expect(page.locator('.sd-price__now')).toContainText('12.000 د.أ');
});
