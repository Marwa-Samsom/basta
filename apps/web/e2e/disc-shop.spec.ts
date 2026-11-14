import { expect, test, type Page } from '@playwright/test';
import { API, PASSWORD, makeAdmin, prisma, tag } from './fixtures';
import { addProduct, indexProducts, makeShop, retire, vendorToken, word, type Shop } from './disc-helpers';

/**
 * صفحة المتجر — ST-11 و ST-12 (DISC-041 · 042 · 043 · 044 · 046 · 047).
 * صفحة المتجر تُقرأ طازجة في كل زيارة (getShop بلا تخزين)، فلا انتظار دقيقة هنا.
 */
const shops: Shop[] = [];
test.afterAll(async () => {
  await retire(...shops);
});
async function shop(opts: Parameters<typeof makeShop>[0] = {}): Promise<Shop> {
  const s = await makeShop(opts);
  shops.push(s);
  return s;
}
const cards = (page: Page) => page.locator('.pgrid .pcard__name');
const productsSection = (page: Page) => page.locator('section[aria-labelledby="sd-shop-products"]');
const meta = (page: Page) => page.locator('.sd-shop__meta');

test('DISC-041: الرأس بالاسم والنجمة و«(8 تقييماً)» و«على بسطة منذ <الشهر> 2026» و«5 منتجاً»، وبطاقتا البائع بلا الإرجاع، ومنتجاته الخمسة الأحدث نشراً أولاً', async ({ page }) => {
  const s = await shop({
    data: {
      descriptionAr: 'متجر صغير للحرف اليدوية.',
      shippingPolicyAr: 'نشحن خلال ثلاثة أيام عمل.',
      returnPolicyAr: null,
      ratingAvg: 4.5,
      ratingCount: 8,
      createdAt: new Date('2026-10-05T10:00:00Z'),
    },
  });
  const other = await shop();
  const foreign = await addProduct(other, { nameAr: `منتج متجر آخر ${other.t}` });
  const now = Date.now();
  const published = [];
  for (let i = 0; i < 5; i++) published.push(await addProduct(s, { nameAr: `حرفة ${i} ${s.t}`, publishedAt: new Date(now - (i + 1) * 3_600_000) }));
  const draft = await addProduct(s, { nameAr: `حرفة مسودّة ${s.t}`, status: 'draft' });

  await page.goto(`/s/${s.slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.nameAr);
  await expect(meta(page).locator('.sd-rating__star')).toBeVisible();
  await expect(meta(page).locator('.sd-rating__avg')).toHaveText('4.5');
  await expect(meta(page).locator('.sd-rating__count')).toHaveText('(8 تقييماً)');
  // الشهر والسنة بأرقام لاتينية (اسم الشهر في الاختبار الموقوف أدناه)
  await expect(meta(page)).toContainText(/على بسطة منذ .+ 2026/);
  await expect(meta(page)).toContainText('5 منتجاً');

  const about = page.locator('.sd-shop__about');
  await expect(about.locator('.sd-infocard__title')).toHaveText(['عن المتجر', 'سياسة الشحن']);
  await expect(about.getByText('متجر صغير للحرف اليدوية.')).toBeVisible();
  await expect(about.getByText('نشحن خلال ثلاثة أيام عمل.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'سياسة الإرجاع' })).toHaveCount(0);

  await expect(productsSection(page).getByRole('heading', { name: 'منتجات المتجر' })).toBeVisible();
  await expect(productsSection(page).locator('.sd-section__note')).toHaveText('5');
  await expect(cards(page)).toHaveText(published.map((p) => p.nameAr));
  await expect(page.getByText(draft.nameAr)).toHaveCount(0);
  await expect(page.getByText(foreign.nameAr)).toHaveCount(0);
});

test('DISC-042: «الكل» ثم فئات البائع بترتيبه وأعدادها بلا الفارغة ولا فئة المسودّات، والفئة تصفّي بالرابط، والنقل يحدّث الأعداد', async ({ page }) => {
  const s = await shop();
  const category = async (nameAr: string, sort: number) => (await prisma.vendorCategory.create({ data: { vendorId: s.vendorId, nameAr, sort } })).id;
  const offers = await category('عروض', 100);
  const shoes = await category('أحذية', 101);
  await category('فارغة', 102);
  const drafts = await category('مسودّات', 103);
  const offerItems = [await addProduct(s, { nameAr: `عرض 1 ${s.t}`, categoryId: offers }), await addProduct(s, { nameAr: `عرض 2 ${s.t}`, categoryId: offers })];
  const shoeItems = [];
  for (let i = 1; i <= 3; i++) shoeItems.push(await addProduct(s, { nameAr: `حذاء ${i} ${s.t}`, categoryId: shoes }));
  await addProduct(s, { nameAr: `مسودّة ${s.t}`, categoryId: drafts, status: 'draft' });

  await page.goto(`/s/${s.slug}`);
  const bar = page.getByRole('navigation', { name: 'فئات المتجر' });
  await expect(bar.getByRole('link')).toHaveText(['الكل', /^عروض\s*2$/, /^أحذية\s*3$/]);
  await expect(bar.getByRole('link', { name: 'الكل' })).toHaveAttribute('aria-current', 'page');
  await expect(meta(page)).toContainText('5 منتجاً');

  await bar.getByRole('link', { name: /^أحذية/ }).click();
  await page.waitForURL((u) => u.searchParams.get('category') === shoes);
  await expect(productsSection(page).getByRole('heading', { level: 2 })).toHaveText('أحذية');
  await expect(productsSection(page).locator('.sd-section__note')).toHaveText('3');
  await expect(cards(page)).toHaveCount(3);
  for (const p of shoeItems) await expect(cards(page).filter({ hasText: p.nameAr })).toHaveCount(1);
  await expect(bar.getByRole('link', { name: /^أحذية/ })).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('link', { name: 'الكل' })).not.toHaveAttribute('aria-current', 'page');
  await expect(meta(page)).not.toContainText('منتجاً');

  // البائع ينقل منشوراً من «عروض» إلى «أحذية» من محرّره
  const token = await vendorToken(s.email);
  const moved = await fetch(`${API}/vendor/products/${offerItems[0]!.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ vendorCategoryId: shoes }),
  });
  expect(moved.status, await moved.clone().text()).toBe(200);
  expect((await prisma.product.findUniqueOrThrow({ where: { id: offerItems[0]!.id } })).status).toBe('active');
  await page.reload();
  await expect(bar.getByRole('link')).toHaveText(['الكل', /^عروض\s*1$/, /^أحذية\s*4$/]);

  await bar.getByRole('link', { name: 'الكل' }).click();
  await page.waitForURL((u) => !u.searchParams.has('category'));
  await expect(cards(page)).toHaveCount(5);
});

test('DISC-043: فئة متجر آخر في الرابط — «منتجات المتجر» و«لا منتجات في هذه الفئة» و«كل منتجات المتجر»، ولا منتج للمتجر الآخر', async ({ page }) => {
  const a = await shop();
  const b = await shop();
  await addProduct(a, { nameAr: `منتج أ ${a.t}` });
  const watches = await prisma.vendorCategory.create({ data: { vendorId: b.vendorId, nameAr: 'ساعات', sort: 100 } });
  const watch = await addProduct(b, { nameAr: `ساعة ب ${b.t}`, categoryId: watches.id });

  await page.goto(`/s/${a.slug}?category=${watches.id}`);
  await expect(productsSection(page).getByRole('heading', { level: 2 })).toHaveText('منتجات المتجر');
  await expect(page.getByText('لا منتجات في هذه الفئة')).toBeVisible();
  await expect(page.getByRole('link', { name: 'كل منتجات المتجر' })).toHaveAttribute('href', `/s/${a.slug}`);
  await expect(page.getByText(watch.nameAr)).toHaveCount(0);
  await expect(cards(page)).toHaveCount(0);
});

test('DISC-044: فئة أو صفحة معطوبة في الرابط — كل المنتجات بلا خطأ، والصفحة غير الصالحة تُعامل كالأولى', async ({ page }) => {
  const s = await shop();
  const items = [await addProduct(s, { nameAr: `منتج 1 ${s.t}` }), await addProduct(s, { nameAr: `منتج 2 ${s.t}` })];
  for (const query of ['category=x', 'category=123', 'page=0', 'page=abc']) {
    const res = await page.goto(`/s/${s.slug}?${query}`);
    expect(res?.status(), query).toBe(200);
    await expect(productsSection(page).getByRole('heading', { level: 2 }), query).toHaveText('منتجات المتجر');
    await expect(cards(page), query).toHaveCount(2);
    for (const p of items) await expect(cards(page).filter({ hasText: p.nameAr }), query).toHaveCount(1);
    await expect(page.getByText('حدث خلل غير متوقّع')).toHaveCount(0);
  }
});

test('DISC-046: المتجر المعلَّق 200 بحالته — لا منتجات ولا فئات ولا سياسات، وبلا JSON-LD وبـ noindex، ويغيب عن الدليل وصفحات منتجاته 404، ويعود برفع التعليق', async ({ page }) => {
  const s = await shop({ data: { descriptionAr: 'وصف المتجر المعلَّق.', shippingPolicyAr: 'شحن سريع.', returnPolicyAr: 'إرجاع خلال أسبوع.' } });
  const own = await prisma.vendorCategory.create({ data: { vendorId: s.vendorId, nameAr: 'فئة المعلَّق', sort: 100 } });
  const product = await addProduct(s, { nameAr: `منتج المعلَّق ${s.t}`, categoryId: own.id });
  await prisma.vendor.update({ where: { id: s.vendorId }, data: { status: 'suspended', suspendedAt: new Date() } });

  const res = await page.goto(`/s/${s.slug}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.nameAr);
  await expect(meta(page)).toContainText('على بسطة منذ');
  await expect(page.locator('.sd-shop__paused')).toHaveText('لا يستقبل طلبات حالياً');
  const card = page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'هذا المتجر لا يستقبل طلبات حالياً' }) });
  await expect(card.getByText('يمكنك تصفّح متاجر أخرى تبيع منتجات مشابهة.')).toBeVisible();
  await expect(card.getByRole('link', { name: 'تصفّح المتاجر' })).toHaveAttribute('href', '/shops');
  await expect(page.getByText(product.nameAr)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'فئات المتجر' })).toHaveCount(0);
  await expect(meta(page)).not.toContainText('منتجاً');
  await expect(page.locator('.sd-infocard')).toHaveCount(0);

  const html = await (await page.request.get(`/s/${s.slug}`)).text();
  expect(html).not.toContain('application/ld+json');
  expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);

  await page.goto(`/shops?name=${encodeURIComponent(s.nameAr)}`);
  await expect(page.getByRole('main').getByRole('link', { name: s.nameAr })).toHaveCount(0);
  await expect(page.locator('.store__cat', { hasText: s.nameAr })).toHaveCount(0);
  const pdp = await page.goto(`/p/${product.slug}`);
  expect(pdp?.status()).toBe(404);
  await expect(page.getByText('لم نجد هذه الصفحة')).toBeVisible();

  await prisma.vendor.update({ where: { id: s.vendorId }, data: { status: 'approved', suspendedAt: null } });
  await page.goto(`/s/${s.slug}`);
  await expect(cards(page)).toHaveText([product.nameAr]);
  await expect(page.getByRole('navigation', { name: 'فئات المتجر' })).toBeVisible();
  await expect(page.locator('.sd-infocard')).toHaveCount(3);
  await expect(page.locator('.sd-shop__paused')).toHaveCount(0);
  const html2 = await (await page.request.get(`/s/${s.slug}`)).text();
  expect(html2).toContain('application/ld+json');
});

test('DISC-047: متجر قيد المراجعة ينشر — قبل الاعتماد بحالته والمنتج 404 ولا بحث ولا دليل؛ بعد اعتماد المدير يظهر في الكل', async ({ page }) => {
  test.setTimeout(240_000);
  const w = word();
  const s = await shop();
  const lamp = await addProduct(s, { nameAr: `مصباح نحاسي ${w}` });
  // النشر يحدث والمتجر معتمد (فيُفهرس)، ثم يُعاد إلى المراجعة — كمتجر أرسل طلبه ونشر قبل اعتماده
  await indexProducts(s, [lamp.id], { q: w, total: 1 });
  await prisma.vendor.update({ where: { id: s.vendorId }, data: { status: 'in_review', approvedAt: null, submittedAt: new Date() } });
  const token = await vendorToken(s.email);
  await fetch(`${API}/vendor/products/${lamp.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' });
  await expect.poll(async () => ((await (await fetch(`${API}/storefront/products?q=${w}`)).json()) as { total: number }).total, { timeout: 20_000 }).toBe(0);

  await page.goto(`/s/${s.slug}`);
  await expect(page.locator('.sd-shop__paused')).toHaveText('لا يستقبل طلبات حالياً');
  expect((await page.goto(`/p/${lamp.slug}`))?.status()).toBe(404);
  await page.goto(`/search?q=${w}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`لا نتائج لـ «${w}»`);
  expect(((await (await fetch(`${API}/storefront/suggest?q=${w}`)).json()) as { suggestions: string[] }).suggestions).toEqual([]);
  await page.goto(`/shops?name=${encodeURIComponent(s.nameAr)}`);
  await expect(page.getByRole('main').getByRole('link', { name: s.nameAr })).toHaveCount(0);

  const admin = await makeAdmin(tag(), ['vendors.review']);
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: PASSWORD, totp: admin.totp() }) });
  expect(login.status).toBe(200);
  const adminToken = ((await login.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
  const approved = await fetch(`${API}/admin/vendors/${s.vendorId}/approve`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } });
  expect(approved.status, await approved.clone().text()).toBe(204);

  // البحث فوراً: الاعتماد يزامن الفهرس
  await expect
    .poll(async () => {
      await page.goto(`/search?q=${w}`);
      return cards(page).allTextContents();
    }, { timeout: 20_000 })
    .toEqual([lamp.nameAr]);
  await page.goto(`/s/${s.slug}`);
  await expect(cards(page)).toHaveText([lamp.nameAr]);
  await expect(page.locator('.sd-shop__paused')).toHaveCount(0);
  // صفحة المنتج بعد دقيقة التخزين على الأكثر
  await expect
    .poll(async () => (await page.goto(`/p/${lamp.slug}`))?.status(), { timeout: 100_000, intervals: [5_000] })
    .toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(lamp.nameAr);
  await page.goto(`/shops?name=${encodeURIComponent(s.nameAr)}`);
  await expect(page.getByRole('main').getByRole('link', { name: s.nameAr }).first()).toBeVisible();
});

// أسماء الشهور على طريقة مصر — قرار صاحبة المشروع 14 نوفمبر 2026: كانت ar-JO تقول «تشرين الأول»
// وصارت intlLocale في كل تاريخ (s/[slug] وحالة التأهيل ومهلة التحويل في الخادم).
test('DISC-041: «على بسطة منذ أكتوبر 2026» باسم الشهر «أكتوبر»', async ({ page }) => {
  const s = await shop({ data: { createdAt: new Date('2026-10-05T10:00:00Z') } });
  await addProduct(s, { nameAr: `منتج ${s.t}` });
  await page.goto(`/s/${s.slug}`);
  await expect(meta(page)).toContainText('على بسطة منذ أكتوبر 2026');
  await expect(meta(page)).not.toContainText('تشرين');
});
