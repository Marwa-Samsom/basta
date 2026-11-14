import { expect, test, type Page } from '@playwright/test';
import { prisma } from './fixtures';
import { addProduct, attrValue, indexProducts, makeShop, retire, word, type Shop } from './disc-helpers';

/**
 * البحث كما يراه المشتري (DISC) — الاقتراحات، صفحة النتائج، بلا نتائج، الأوجه والترتيب.
 * كل حالة بكلمة عشوائية في أسماء منتجاتها: البحث يعيدها وحدها من قاعدة التطوير كلها.
 * ما يحسبه الخادم مفحوص في apps/api: storefront-disc.integration.spec.ts.
 */
const box = (page: Page) => page.getByRole('combobox', { name: 'ابحث في بسطة' });
const cards = (page: Page) => page.locator('.pgrid .pcard__name');
const facets = (page: Page) => page.locator('aside.sd-facets');
const chip = (page: Page, label: string) => facets(page).locator('a.sd-fchip', { hasText: label });
const search = (page: Page, q: string, extra = '') => page.goto(`/search?q=${encodeURIComponent(q)}${extra}`);
const params = (page: Page) => new URL(page.url()).searchParams;

const shops: Shop[] = [];
test.afterAll(async () => {
  await retire(...shops);
});
async function shop(opts: Parameters<typeof makeShop>[0] = {}): Promise<Shop> {
  const s = await makeShop(opts);
  shops.push(s);
  return s;
}

test('DISC-011: طلب اقتراح واحد بعد التوقّف لا لكل ضغطة، وأسماء نصّية والمكرّر مرة، والضغط يفتح نتائجه', async ({ page }) => {
  const w = word();
  const a = await shop();
  const b = await shop();
  const ids = [(await addProduct(a, { nameAr: `${w} قميص قطني أزرق` })).id, (await addProduct(a, { nameAr: `${w} قميص كتان` })).id];
  const twin = (await addProduct(b, { nameAr: `${w} قميص كتان` })).id;
  await indexProducts(a, ids, { q: w, total: 2 });
  await indexProducts(b, [twin], { q: w, total: 3 });

  const calls: { q: string | null; at: number }[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.endsWith('/storefront/suggest')) calls.push({ q: u.searchParams.get('q'), at: Date.now() });
  });
  await page.goto('/');
  await box(page).click();
  await box(page).pressSequentially(w, { delay: 40 });
  const typed = Date.now();
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option')).toHaveCount(2);
  // ضغطات عشر متتالية: طلب واحد بالكلمة كاملة، بعد نحو 200ms من آخرها
  expect(calls.map((c) => c.q)).toEqual([w]);
  expect(calls[0]!.at - typed).toBeGreaterThanOrEqual(150);
  // أسماء نصّية لا بطاقات: لا صورة ولا سعر داخل القائمة، والاسم المكرّر بين متجرين مرة
  await expect(list.locator('img, .money')).toHaveCount(0);
  await expect(list.getByRole('option', { name: `${w} قميص كتان`, exact: true })).toHaveCount(1);

  await list.getByRole('option', { name: `${w} قميص كتان`, exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/search' && u.searchParams.get('q') === `${w} قميص كتان`);
  // المسافة %20 في الرابط
  expect(page.url()).toContain(`q=${encodeURIComponent(`${w} قميص كتان`)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`نتائج «${w} قميص كتان»`);
});

// الاقتراح المختار يصير في الخانة — go() في search-box.tsx يضعه قبل فتح نتائجه
test('DISC-011: بعد الضغط على اقتراح يحمل الصندوق الاقتراح نفسه', async ({ page }) => {
  await page.route((u) => u.pathname.endsWith('/storefront/suggest'), (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ suggestions: ['قميص كتان'] }) }),
  );
  await page.goto('/');
  await box(page).fill('قمي');
  await page.getByRole('listbox').getByRole('option', { name: 'قميص كتان' }).click();
  await page.waitForURL((u) => u.searchParams.get('q') === 'قميص كتان');
  await expect(box(page)).toHaveValue('قميص كتان');
});

test('DISC-015: بعد 429 لا طلبات اقتراح عشر ثوانٍ كاملة ثم تعود', async ({ page }) => {
  test.setTimeout(60_000);
  let calls = 0;
  await page.route((u) => u.pathname.endsWith('/storefront/suggest'), (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ message: 'محاولات كثيرة' }) })
      : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ suggestions: ['قميص قطني'] }) });
  });
  await page.goto('/');
  await box(page).fill('قمي');
  await expect.poll(() => calls).toBe(1);
  const paused = Date.now();
  // داخل المهلة: كتابة بعد كتابة ولا طلب
  for (const text of ['قميص', 'قميص ق', 'قميص قط']) {
    await box(page).fill(text);
    await page.waitForTimeout(2_000);
  }
  expect(calls).toBe(1);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  // بعد انقضاء العشر: أول كتابة تطلب من جديد وتظهر القائمة
  await page.waitForTimeout(Math.max(0, 10_500 - (Date.now() - paused)));
  await box(page).fill('قميص قطن');
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByRole('listbox').getByRole('option', { name: 'قميص قطني' })).toBeVisible();
});

test('DISC-017: المسار والعنوان والعدد وعنوان التبويب، والسعر المعدَّل يظهر فوراً', async ({ page }) => {
  const w = word();
  const s = await shop();
  const items = [];
  for (let i = 1; i <= 5; i++) items.push(await addProduct(s, { nameAr: `${w} قميص ${i}`, price: BigInt(10_000 + i * 1_000) }));
  await indexProducts(s, items.map((p) => p.id), { q: w, total: 5 });

  await page.goto('/');
  await box(page).fill(w);
  await box(page).press('Enter');
  await page.waitForURL((u) => u.pathname === '/search' && u.searchParams.get('q') === w);
  const crumbs = page.getByRole('navigation', { name: 'مسار التصفّح' });
  await expect(crumbs.getByRole('listitem')).toHaveText(['الرئيسية', 'نتائج البحث']);
  await expect(crumbs.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`نتائج «${w}»`);
  await expect(page.locator('.sd-list__count')).toHaveText('5 نتيجة');
  await expect(page).toHaveTitle(`بحث: ${w} · بسطة`);
  await expect(cards(page)).toHaveCount(5);
  // البطاقة نفسها في كل مكان: الاسم والمتجر والسعر والقلب
  const first = page.locator('.pgrid article.pcard').first();
  await expect(first.locator('.pcard__vendor')).toHaveText(s.nameAr);
  await expect(first.locator('.money')).toBeVisible();
  await expect(first.getByRole('button', { name: /في المفضّلة$/ })).toBeVisible();

  // البائع يعدّل السعر: البحث بكلمة لا يُخزَّن والسعر من القاعدة لا من الفهرس
  await prisma.productVariant.update({ where: { id: items[0]!.variantId }, data: { priceMinorUnits: 7_777n } });
  await page.reload();
  await expect(page.locator('article.pcard', { hasText: `${w} قميص 1` }).locator('.money')).toContainText('7.777');
});

test('DISC-021: بلا نتائج — لا شبكة ولا أوجه ولا ترتيب، والنصائح، و«تصفّح المتاجر» بستة حدّاً أعلى', async ({ page }) => {
  const q = 'زقزقةغيرموجودة';
  await search(page, q);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`لا نتائج لـ «${q}»`);
  await expect(page.getByText('جرّب كلمات أقل أو تحقّق من الإملاء.')).toBeVisible();
  await expect(page.getByText('جرّب كلمة أعمّ: «قميص» بدل «قميص قطني أزرق مقاس M».')).toBeVisible();
  await expect(page.getByText('الأخطاء الإملائية والهمزات مقبولة، والمرادفات الشائعة كذلك.')).toBeVisible();
  await expect(page.locator('.pgrid')).toHaveCount(0);
  await expect(page.locator('.sd-facets, .sd-facets-m')).toHaveCount(0);
  await expect(page.locator('.sd-sort')).toHaveCount(0);

  const section = page.locator('section', { has: page.getByRole('heading', { name: 'تصفّح المتاجر' }) });
  const tiles = section.locator('a.sd-tile');
  const n = await tiles.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(6);
  for (const href of await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) expect(href).toMatch(/^\/s\/[^/]+$/);
  await expect(section.getByRole('link', { name: 'كل المتاجر' })).toHaveAttribute('href', '/shops');

  const target = await tiles.first().getAttribute('href');
  await tiles.first().click();
  await page.waitForURL((u) => u.pathname === target);
  await page.goBack();
  await section.getByRole('link', { name: 'كل المتاجر' }).click();
  await page.waitForURL((u) => u.pathname === '/shops');
});

test('DISC-023: وجه «اللون» «أحمر 20» ثم «أزرق 10»، والضغط يضع attrs ويُسقط page ويضيّق إلى 20', async ({ page }) => {
  test.setTimeout(240_000);
  const w = word();
  const s = await shop();
  const red = await attrValue('color', 'أحمر');
  const blue = await attrValue('color', 'أزرق');
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) ids.push((await addProduct(s, { nameAr: `${w} قميص صوف ${i}`, options: [[red.attributeId, red.id]] })).id);
  for (let i = 0; i < 10; i++) ids.push((await addProduct(s, { nameAr: `${w} قميص كتان ${i}`, options: [[blue.attributeId, blue.id]] })).id);
  await indexProducts(s, ids, { q: w, total: 30 });

  await search(page, w, '&page=2');
  await expect(page.locator('.sd-list__count')).toHaveText('30 نتيجة');
  const colorFacet = facets(page).locator('section.sd-facet', { has: page.getByRole('heading', { name: 'اللون' }) });
  await expect(colorFacet.locator('a.sd-fchip')).toHaveText([/^أحمر\s*20$/, /^أزرق\s*10$/]);

  await chip(page, 'أحمر').click();
  await page.waitForURL((u) => u.searchParams.get('attrs') === red.id);
  expect(params(page).has('page')).toBe(false);
  await expect(page.locator('.sd-list__count')).toHaveText('20 نتيجة');
});

test('DISC-024: أحمر ثم M — الرابط بالقيمتين، القميص الأحمر M وحده، رقاقتان وaria-current، والضغط الثاني يزيل M', async ({ page }) => {
  const w = word();
  const s = await shop();
  const red = await attrValue('color', 'أحمر');
  const blue = await attrValue('color', 'أزرق');
  const m = await attrValue('size', 'M');
  const l = await attrValue('size', 'L');
  const redM = await addProduct(s, { nameAr: `${w} قميص أحمر M`, options: [[red.attributeId, red.id], [m.attributeId, m.id]] });
  const redL = await addProduct(s, { nameAr: `${w} قميص أحمر L`, options: [[red.attributeId, red.id], [l.attributeId, l.id]] });
  const blueM = await addProduct(s, { nameAr: `${w} قميص أزرق M`, options: [[blue.attributeId, blue.id], [m.attributeId, m.id]] });
  await indexProducts(s, [redM.id, redL.id, blueM.id], { q: w, total: 3 });

  await search(page, w);
  await chip(page, 'أحمر').click();
  await page.waitForURL((u) => u.searchParams.get('attrs') === red.id);
  await facets(page).locator('section.sd-facet', { has: page.getByRole('heading', { name: 'المقاس' }) }).locator('a.sd-fchip', { hasText: /^M/ }).click();
  await page.waitForURL((u) => u.searchParams.get('attrs') === `${red.id},${m.id}`);
  await expect(cards(page)).toHaveText([redM.nameAr]);

  const applied = page.locator('.sd-applied');
  await expect(applied.getByRole('link', { name: 'أزل التصفية: اللون: أحمر' })).toBeVisible();
  await expect(applied.getByRole('link', { name: 'أزل التصفية: المقاس: M' })).toBeVisible();
  await expect(chip(page, 'أحمر')).toHaveAttribute('aria-current', 'true');
  const mChip = facets(page).locator('section.sd-facet', { has: page.getByRole('heading', { name: 'المقاس' }) }).locator('a.sd-fchip', { hasText: /^M/ });
  await expect(mChip).toHaveAttribute('aria-current', 'true');

  await mChip.click();
  await page.waitForURL((u) => u.searchParams.get('attrs') === red.id);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page)).toContainText([redM.nameAr]);
  await expect(cards(page)).toContainText([redL.nameAr]);
});

test('DISC-026: «المتوفّر فقط» يضع inStock=true وعلامته وaria-current ورقاقته، ويُظهر المتوفّر وحده', async ({ page }) => {
  const w = word();
  const s = await shop();
  const a = await addProduct(s, { nameAr: `${w} قميص أ`, stock: 1 });
  const b = await addProduct(s, { nameAr: `${w} قميص ب`, stock: 0 });
  await indexProducts(s, [a.id, b.id], { q: w, total: 2 });

  await search(page, w);
  await expect(cards(page)).toHaveCount(2);
  const facet = facets(page).getByRole('link', { name: 'المتوفّر فقط' });
  await facet.click();
  await page.waitForURL((u) => u.searchParams.get('inStock') === 'true');
  await expect(facets(page).getByRole('link', { name: 'المتوفّر فقط' })).toHaveAttribute('aria-current', 'true');
  await expect(facets(page).getByRole('link', { name: 'المتوفّر فقط' }).locator('.sd-check')).toHaveAttribute('data-on', 'true');
  await expect(page.locator('.sd-applied').getByRole('link', { name: 'أزل التصفية: المتوفّر فقط' })).toBeVisible();
  await expect(cards(page)).toHaveText([a.nameAr]);
});

test('DISC-027: «المتجر» يظهر بمتجرين بعدّهما تنازلياً والمعلَّق غائب، ويغيب بمتجر واحد، والاختيار يضيّق ويُزال', async ({ page }) => {
  const shoe = word();
  const perfume = word();
  const big = await shop();
  const small = await shop();
  const gone = await shop();
  const bigIds = [(await addProduct(big, { nameAr: `${shoe} حذاء 1` })).id, (await addProduct(big, { nameAr: `${shoe} حذاء 2` })).id];
  const smallIds = [(await addProduct(small, { nameAr: `${shoe} حذاء خفيف` })).id, (await addProduct(small, { nameAr: `${perfume} عطر` })).id];
  const goneIds = [(await addProduct(gone, { nameAr: `${shoe} حذاء قديم` })).id];
  await indexProducts(big, bigIds, { q: shoe, total: 2 });
  await indexProducts(small, smallIds, { q: shoe, total: 3 });
  await indexProducts(gone, goneIds, { q: shoe, total: 4 });
  // يُعلَّق بالقاعدة مباشرةً: وثيقته تبقى في الفهرس
  await prisma.vendor.update({ where: { id: gone.vendorId }, data: { status: 'suspended', suspendedAt: new Date() } });

  await search(page, perfume);
  await expect(facets(page).getByRole('heading', { name: 'المتجر' })).toHaveCount(0);

  await search(page, shoe);
  const vendorFacet = facets(page).locator('section.sd-facet', { has: page.getByRole('heading', { name: 'المتجر' }) });
  await expect(vendorFacet.locator('a.sd-facet__item .sd-facet__label')).toHaveText([big.nameAr, small.nameAr]);
  await expect(vendorFacet.locator('a.sd-facet__item .sd-facet__count')).toHaveText(['2', '1']);
  await expect(vendorFacet.getByText(gone.nameAr)).toHaveCount(0);

  await vendorFacet.locator('a.sd-facet__item', { hasText: big.nameAr }).click();
  await page.waitForURL((u) => u.searchParams.get('vendorId') === big.vendorId);
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('.pgrid .pcard__vendor')).toHaveText([big.nameAr, big.nameAr]);
  await expect(page.locator('.sd-applied').getByRole('link', { name: `أزل التصفية: ${big.nameAr}` })).toBeVisible();

  // الإزالة من رقاقة التصفية المطبّقة
  await page.locator('.sd-applied').getByRole('link', { name: `أزل التصفية: ${big.nameAr}` }).click();
  await page.waitForURL((u) => !u.searchParams.has('vendorId'));
  await expect(cards(page)).toHaveCount(3);
});

// DISC-027: بعد اختيار متجر يبقى في الأوجه متجر واحد فيختفي قسم «المتجر»، والإزالة من رقاقة التصفية
// المطبّقة (الاختبار السابق) — قبلته صاحبة المشروع 14 نوفمبر 2026 بديلاً عن الضغط الثاني.

test('DISC-029: زرّ الترتيب افتراضه «الأكثر ملاءمة» وعلامة ✓ على الحالي، وكل خيار يضع sort ويُسقط page، والسعر بالدولار بين العملات', async ({ page }) => {
  const w = word();
  const jod = await shop({ currency: 'JOD' });
  const usd = await shop({ currency: 'USD', data: { country: 'JO' } });
  const now = Date.now();
  const x = await addProduct(jod, { nameAr: `${w} قميص س`, price: 10_000n, publishedAt: new Date(now - 3 * 86_400_000) });
  const y = await addProduct(jod, { nameAr: `${w} قميص ص`, price: 12_000n, publishedAt: new Date(now - 86_400_000) });
  const z = await addProduct(jod, { nameAr: `${w} قميص ع`, price: 15_000n, publishedAt: new Date(now - 2 * 86_400_000) });
  const d = await addProduct(usd, { nameAr: `${w} قميص دولار`, price: 900n, publishedAt: new Date(now - 20 * 86_400_000) });
  await indexProducts(jod, [x.id, y.id, z.id], { q: w, total: 3 });
  await indexProducts(usd, [d.id], { q: w, total: 4 });

  await search(page, w, '&pageSize=2&page=2');
  const sort = page.locator('details.sd-sort');
  await expect(sort.locator('summary')).toContainText('الأكثر ملاءمة');
  await sort.locator('summary').click();
  const options = sort.getByRole('navigation', { name: 'الترتيب' }).getByRole('link');
  await expect(options).toHaveText(['الأكثر ملاءمة', 'الأحدث', 'السعر من الأقل', 'السعر من الأعلى']);
  await expect(options.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(options.nth(0).locator('svg')).toHaveCount(1);
  await expect(options.nth(2).locator('svg')).toHaveCount(0);

  const open = async () => {
    if (!(await page.locator('details.sd-sort').evaluate((d) => (d as HTMLDetailsElement).open))) await page.locator('details.sd-sort summary').click();
  };
  const choose = async (label: string, key: string | null) => {
    await open();
    await page.locator('details.sd-sort').getByRole('link', { name: label }).click();
    await page.waitForURL((u) => u.searchParams.get('sort') === key && !u.searchParams.has('page'));
    await expect(page.locator('details.sd-sort summary')).toContainText(label);
  };
  await choose('السعر من الأقل', 'price_asc');
  // 9.00 دولار أرخص من 10.000 دينار: الترتيب بقيمة موحّدة لا بالوحدة الخام
  await expect(cards(page)).toHaveText([d.nameAr, x.nameAr]);
  await open();
  await expect(page.locator('details.sd-sort').getByRole('link', { name: 'السعر من الأقل' })).toHaveAttribute('aria-current', 'true');

  await choose('السعر من الأعلى', 'price_desc');
  await expect(cards(page)).toHaveText([z.nameAr, y.nameAr]);
  await choose('الأحدث', 'newest');
  // بتاريخ النشر: ص نُشر أمس، ثم ع قبل يومين
  await expect(cards(page)).toHaveText([y.nameAr, z.nameAr]);
  await choose('الأكثر ملاءمة', null);
  expect(params(page).has('sort')).toBe(false);
});

test('DISC-036: نصّ الحقن يُعرض حرفياً في «لا نتائج لـ» ولا يُنفَّذ سكربت', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  for (const q of ['<script>alert(1)</script>', "' OR 1=1; DROP TABLE users; --"]) {
    const res = await search(page, q);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`لا نتائج لـ «${q}»`);
  }
  expect(dialogs).toEqual([]);
  expect(await prisma.user.count()).toBeGreaterThan(0);
});
