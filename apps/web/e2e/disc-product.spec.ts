import { expect, test, type Page } from '@playwright/test';
import { prisma } from './fixtures';
import { addProduct, attrValue, indexProducts, makeShop, retire, word, type Shop } from './disc-helpers';

/**
 * صفحة المنتج — ST-07 و ST-08 (DISC-050 · 051 · 054 · 058 · 060 · 061 · 063).
 * كل منتج بمسار جديد، فلا تخزين صفحة سابق يخدمه.
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
const price = (page: Page) => page.locator('.sd-buybox .sd-price');
const image = (productId: string, key: string, data: Record<string, unknown> = {}) =>
  prisma.productImage.create({ data: { productId, fileKey: key, ...data } });

async function variant(shop: Shop, productId: string, priceMinor: bigint, data: Record<string, unknown> = {}, options: [string, string][] = []) {
  const v = await prisma.productVariant.create({
    data: {
      productId,
      vendorId: shop.vendorId,
      sku: `DISC-${Math.random().toString(36).slice(2, 10)}`.toUpperCase(),
      priceMinorUnits: priceMinor,
      optionsKey: options.map(([a, x]) => `${a}:${x}`).join('|') || `v-${Math.random()}`,
      isActive: true,
      ...data,
      ...(options.length ? { optionValues: { create: options.map(([attributeId, attributeValueId]) => ({ attributeId, attributeValueId })) } } : {}),
    },
  });
  await prisma.inventory.create({ data: { variantId: v.id, onHand: 10, reserved: 0 } });
  await prisma.inventoryMovement.create({ data: { variantId: v.id, delta: 10, reason: 'import' } });
  return v.id;
}

test('DISC-050: صفحة المنتج كاملة في HTML بلا JavaScript، ومنتج بلا فئة مساره بلا حلقتها', async ({ browser, page }) => {
  const s = await shop({ data: { ratingAvg: 4.2, ratingCount: 20, shippingPolicyAr: null, returnPolicyAr: null } });
  const shirts = await prisma.vendorCategory.create({ data: { vendorId: s.vendorId, nameAr: 'قمصان', sort: 100 } });
  const p = await addProduct(s, {
    nameAr: `قميص كتان ${s.t}`,
    nameEn: 'Linen Shirt',
    descriptionAr: 'قميص صيفي خفيف من الكتان.',
    price: 15_000n,
    categoryId: shirts.id,
  });
  await variant(s, p.id, 12_000n);
  const key = `products/${s.t}/cover`;
  await image(p.id, key);
  const others = [];
  for (let i = 1; i <= 5; i++) others.push(await addProduct(s, { nameAr: `منتج آخر ${i} ${s.t}`, publishedAt: new Date(Date.now() - i * 60_000) }));
  const bare = await addProduct(s, { nameAr: `بلا فئة ${s.t}`, categoryId: null });

  // مواصفات منطقية لا توجد في القاعدة: سمات مؤرشفة للاختبار وحده، تُحذف بعده
  const material = await prisma.attribute.findFirstOrThrow({ where: { code: 'material' } });
  const flags = await Promise.all(
    ['قابل للغسل', 'يحتاج كيّاً', 'مبطّن'].map((nameAr, i) =>
      prisma.attribute.create({ data: { code: `disc-${s.t}-${i}`, nameAr, inputType: 'boolean', archivedAt: new Date(), isFilterable: false } }),
    ),
  );
  await prisma.productAttributeValue.createMany({
    data: [
      { productId: p.id, attributeId: material.id, valueTextAr: 'كتان' },
      { productId: p.id, attributeId: flags[0]!.id, valueBoolean: true },
      { productId: p.id, attributeId: flags[1]!.id, valueBoolean: false },
      { productId: p.id, attributeId: flags[2]!.id, valueBoolean: null },
    ],
  });

  try {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL!, locale: 'ar' });
    const raw = await context.newPage();
    const res = await raw.goto(`/p/${p.slug}`);
    expect(res?.status()).toBe(200);
    await expect(raw.getByRole('heading', { level: 1 })).toHaveText(p.nameAr);
    await expect(raw.locator('p.sd-pdp__en[dir="ltr"][lang="en"]')).toHaveText('Linen Shirt');
    await expect(raw.locator('.sd-pdp__shop')).toHaveText(s.nameAr);
    await expect(raw.locator('.sd-pdp__shop')).toHaveAttribute('href', `/s/${s.slug}`);
    await expect(raw.locator('.sd-pdp__byline .sd-rating__count')).toHaveText('تقييم المتجر من 20');
    // أرخص متغيّر: 12.000 لا 15.000
    await expect(raw.locator('.sd-price__now')).toContainText('12.000');
    await expect(raw.locator('.sd-gallery__stage img')).toHaveAttribute('src', new RegExp(`${key}/full\\.webp$`));
    await expect(raw.locator('#sd-desc')).toHaveText('الوصف');
    await expect(raw.getByText('قميص صيفي خفيف من الكتان.')).toBeVisible();
    await expect(raw.locator('#sd-specs')).toHaveText('المواصفات');
    // كل مواصفة بقيمتها: النصّ كما هو، والمنطقية «نعم» و«لا»، والفارغة «—»
    const rows = await raw.locator('.sd-specs__row').evaluateAll((els) => els.map((e) => [e.querySelector('dt')?.textContent, e.querySelector('dd')?.textContent]));
    expect(rows.sort()).toEqual(
      [
        ['الخامة', 'كتان'],
        ['قابل للغسل', 'نعم'],
        ['يحتاج كيّاً', 'لا'],
        ['مبطّن', '—'],
      ].sort(),
    );
    const crumbs = raw.getByRole('navigation', { name: 'مسار التصفّح' });
    await expect(crumbs.getByRole('listitem')).toHaveText(['الرئيسية', s.nameAr, 'قمصان', p.nameAr]);
    await expect(crumbs.getByRole('link', { name: 'قمصان' })).toHaveAttribute('href', `/s/${s.slug}?category=${shirts.id}`);
    await expect(raw.getByText('يحدّد البائع مدّة الشحن عند الطلب.')).toBeVisible();
    await expect(raw.getByText('سياسة الإرجاع العامة في بسطة تسري.')).toBeVisible();
    const more = raw.locator('section[aria-labelledby="sd-more"]');
    await expect(more.getByRole('heading', { level: 2 })).toHaveText(`المزيد من ${s.nameAr}`);
    await expect(more.locator('.pcard__name')).toHaveCount(4);
    await expect(more.locator('.pcard__name', { hasText: p.nameAr })).toHaveCount(0);
    await expect(more.getByRole('link', { name: 'كل منتجات المتجر' })).toHaveAttribute('href', `/s/${s.slug}`);
    await expect(raw.getByRole('button', { name: 'اسأل المتجر عن هذا المنتج' })).toBeVisible();

    await raw.goto(`/p/${bare.slug}`);
    await expect(raw.getByRole('navigation', { name: 'مسار التصفّح' }).getByRole('listitem')).toHaveText(['الرئيسية', s.nameAr, bare.nameAr]);
    await context.close();

    // بالسكربت: الصفحة نفسها
    await page.goto(`/p/${p.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.nameAr);
    await expect(page.locator('.sd-price__now')).toContainText('12.000');
    expect(others).toHaveLength(5);
  } finally {
    await prisma.productAttributeValue.deleteMany({ where: { attributeId: { in: flags.map((f) => f.id) } } });
    await prisma.attribute.deleteMany({ where: { id: { in: flags.map((f) => f.id) } } });
  }
});

test('DISC-051: الدينار بثلاث خانات ومشطوب ونسبة الخصم، ومقارنة أقل بلا شطب، وسعر المتجر الأصلي تحت المحوَّل، والبطاقة بالمحوَّل وحده', async ({ page, context }) => {
  const jod = await shop({ currency: 'JOD' });
  const sar = await shop({ currency: 'SAR' });
  const red = await attrValue('color', 'أحمر');
  const blue = await attrValue('color', 'أزرق');
  const green = await attrValue('color', 'أخضر');
  const p = await addProduct(jod, { nameAr: `منتج الدينار ${jod.t}`, price: 12_500n, compareAt: 15_000n, options: [[red.attributeId, red.id]] });
  // «مقارنة أقل من السعر» لا تُحفظ أصلاً: القاعدة ترفضها (variant_compare_at_above_price) فلا شطب خاطئ ممكن
  await expect(variant(jod, p.id, 20_000n, { compareAtPriceMinorUnits: 18_000n }, [[blue.attributeId, blue.id]])).rejects.toThrow(/variant_compare_at_above_price/);
  await variant(jod, p.id, 20_000n, {}, [[blue.attributeId, blue.id]]);
  await variant(jod, p.id, 22_000n, {}, [[green.attributeId, green.id]]);
  const w = word();
  const q = await addProduct(sar, { nameAr: `${w} منتج الريال`, price: 4_999n });
  await indexProducts(sar, [q.id], { q: w, total: 1 });

  await page.goto(`/p/${p.slug}`);
  // ثلاث خانات ورمز الدينار
  await expect(price(page).locator('.sd-price__now')).toContainText('12.500 د.أ');
  await expect(price(page).locator('.sd-price__was')).toContainText('15.000');
  await expect(price(page).locator('.sd-price__off')).toHaveText('−17%');
  await expect(price(page).locator('.sd-price__store')).toHaveCount(0);

  await page.getByRole('button', { name: 'أزرق', exact: true }).click();
  await expect(price(page).locator('.sd-price__now')).toContainText('20.000');
  await expect(price(page).locator('.sd-price__was')).toHaveCount(0);
  await expect(price(page).locator('.sd-price__off')).toHaveCount(0);
  await page.getByRole('button', { name: 'أخضر', exact: true }).click();
  await expect(price(page).locator('.sd-price__now')).toContainText('22.000');
  await expect(price(page).locator('.sd-price__was')).toHaveCount(0);

  // منتج الريال بالدينار: محوَّلاً وتحته سعر المتجر بعملته
  await page.goto(`/p/${q.slug}`);
  await expect(price(page).locator('.sd-price__now')).toContainText('د.أ');
  await expect(price(page).locator('.sd-price__store')).toContainText('49.99 ر.س');
  await expect(price(page).locator('.sd-price__store')).toContainText('بعملة المتجر');
  // البطاقة في البحث: المحوَّل وحده
  await page.goto(`/search?q=${w}`);
  const card = page.locator('article.pcard', { hasText: q.nameAr });
  await expect(card.locator('.money')).toContainText('د.أ');
  await expect(card).not.toContainText('ر.س');
  await expect(card).not.toContainText('بعملة المتجر');

  // بعملة الريال: 49.99 بخانتين بلا سطر أصلي
  await context.addCookies([{ name: 'basta.currency', value: 'SAR', url: test.info().project.use.baseURL! }]);
  await page.goto(`/p/${q.slug}`);
  await expect(price(page).locator('.sd-price__now')).toContainText('49.99 ر.س');
  await expect(price(page).locator('.sd-price__store')).toHaveCount(0);
});

test('DISC-054: المنتج النافد 200 ويقول ذلك — التنبيه وزرّ فئته، وشارة الصورة، وزرّ معطّل، و OutOfStock، وبطاقة «نفد» في البحث والمتجر', async ({ page }) => {
  const s = await shop();
  const perfumes = await prisma.vendorCategory.create({ data: { vendorId: s.vendorId, nameAr: 'عطور', sort: 100 } });
  const w = word();
  const p = await addProduct(s, { nameAr: `${w} عطر نافد`, stock: 0, categoryId: perfumes.id });
  const bare = await addProduct(s, { nameAr: `${w} نافد بلا فئة`, stock: 0, categoryId: null });
  // المنتج بلا فئة لا يُحفظ من المحرّر (لا منتج بلا فئة) — يُفهرس المنتج ذو الفئة وحده
  await indexProducts(s, [p.id], { q: w, total: 1 });

  const res = await page.goto(`/p/${p.slug}`);
  expect(res?.status()).toBe(200);
  const alert = page.locator('.alert--warning');
  await expect(alert.getByText('نفد هذا المنتج')).toBeVisible();
  await expect(alert.getByText('البائع لم يُعِد تزويده بعد. تصفّح منتجات مشابهة في المتجر نفسه.')).toBeVisible();
  await expect(alert.getByRole('link', { name: 'المزيد من «عطور»' })).toHaveAttribute('href', `/s/${s.slug}?category=${perfumes.id}`);
  await expect(page.locator('.sd-gallery__flag')).toHaveText('نفد من المخزون');
  await expect(page.getByRole('button', { name: 'نفد من المخزون' })).toBeDisabled();
  const html = await (await page.request.get(`/p/${p.slug}`)).text();
  expect(html).toContain('"availability":"https://schema.org/OutOfStock"');

  await page.goto(`/search?q=${w}`);
  await expect(page.locator('article.pcard', { hasText: p.nameAr }).locator('.pcard__flag')).toHaveText('نفد');
  await page.goto(`/s/${s.slug}`);
  await expect(page.locator('article.pcard', { hasText: p.nameAr }).locator('.pcard__flag')).toHaveText('نفد');

  await page.goto(`/p/${bare.slug}`);
  await expect(page.locator('.alert--warning').getByRole('link', { name: 'منتجات المتجر' })).toHaveAttribute('href', `/s/${s.slug}`);
});

test('DISC-058: «أضف إلى السلة» للضيف — «جارٍ الإضافة…» معطّلاً، سلة بعملة العرض ورمزها في الترويسة، «السلة — 2» بلا إعادة تحميل، والثانية تدمج السطر', async ({ page }) => {
  const s = await shop();
  const p = await addProduct(s, { nameAr: `منتج السلة ${s.t}`, stock: 10 });
  const created: { body: unknown }[] = [];
  const items: { url: string; token: string | undefined }[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'POST' && u.pathname.endsWith('/cart')) created.push({ body: r.postDataJSON() });
    if (r.method() === 'POST' && u.pathname.endsWith('/cart/items')) items.push({ url: r.url(), token: r.headers()['x-cart-token'] });
  });
  await page.route((u) => u.pathname.endsWith('/cart/items'), async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });

  await page.goto(`/p/${p.slug}`);
  expect(await page.evaluate(() => localStorage.getItem('basta.cart'))).toBeNull();
  // علامة في الصفحة نفسها: إعادة التحميل تمحوها
  await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
  await page.getByRole('button', { name: 'زد' }).click();
  await expect(page.locator('.sd-qty__val')).toHaveText('2');
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  const busy = page.getByRole('button', { name: 'جارٍ الإضافة…' });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'أُضيف إلى سلّتك.' })).toContainText('أُضيف إلى سلّتك. اذهب إلى السلة');
  await expect(page.getByRole('link', { name: 'السلة — 2' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);

  const token = await page.evaluate(() => localStorage.getItem('basta.cart'));
  expect(token).toBeTruthy();
  expect(created).toEqual([{ body: { currency: 'JOD' } }]);
  expect(items[0]!.token).toBe(token);
  expect(items[0]!.url).not.toContain(token!);

  await page.getByRole('button', { name: 'أنقص' }).click();
  await expect(page.locator('.sd-qty__val')).toHaveText('1');
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByRole('link', { name: 'السلة — 3' })).toBeVisible();
  expect(created).toHaveLength(1);
  const cart = (await (await page.request.get(`${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:4000/api/v1'}/cart`, { headers: { 'x-cart-token': token! } })).json()) as {
    groups: { lines: { variantId: string; qty: number }[] }[];
  };
  const lines = cart.groups.flatMap((g) => g.lines);
  expect(lines).toEqual([expect.objectContaining({ variantId: p.variantId, qty: 3 })]);

  await page.getByRole('link', { name: 'اذهب إلى السلة' }).click();
  await page.waitForURL((u) => u.pathname === '/cart');
  await expect(page.getByText(p.nameAr)).toBeVisible();

  // رمز سلة منتهٍ: يُستبدل بسلة جديدة وتنجح الإضافة
  await page.evaluate(() => localStorage.setItem('basta.cart', 'expired-cart-token-0000000000000000'));
  await page.goto(`/p/${p.slug}`);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'أُضيف إلى سلّتك.' })).toBeVisible();
  const fresh = await page.evaluate(() => localStorage.getItem('basta.cart'));
  expect(fresh).toBeTruthy();
  expect(fresh).not.toBe('expired-cart-token-0000000000000000');
});

test('DISC-060: المعرض يتبع المتغيّر بقواعد الصورة المربوطة — الغلاف عند التحميل، والمتغيّر بعينه يسبق القيمة، واللون بلا صورة يعود للعامة', async ({ page }) => {
  const s = await shop();
  const [red, blue, green, small, medium] = await Promise.all([
    attrValue('color', 'أحمر'), attrValue('color', 'أزرق'), attrValue('color', 'أخضر'), attrValue('size', 'S'), attrValue('size', 'M'),
  ]);
  // أحمر M أرخص المتغيّرات: المختار عند التحميل — وله صورته، والغلاف يبقى أول ما يُرى
  const p = await addProduct(s, { nameAr: `قميص بالألوان ${s.t}`, price: 9_000n, options: [[red.attributeId, red.id], [medium.attributeId, medium.id]] });
  const redM = p.variantId;
  for (const [c, z] of [[red, small], [blue, small], [blue, medium], [green, small], [green, medium]] as const) {
    await variant(s, p.id, 10_000n, {}, [[c.attributeId, c.id], [z.attributeId, z.id]]);
  }
  const key = (n: number) => `products/${s.t}/img-${n}`;
  await image(p.id, key(1), { sort: 0 });
  await image(p.id, key(2), { sort: 1 });
  await image(p.id, key(3), { sort: 2, optionValueId: blue.id });
  await image(p.id, key(4), { sort: 3, variantId: redM });
  await image(p.id, key(5), { sort: 4, optionValueId: red.id });
  const single = await addProduct(s, { nameAr: `بصورة واحدة ${s.t}` });
  await image(single.id, key(9));

  const stage = page.locator('.sd-gallery__stage img');
  const shows = async (n: number) => {
    await expect(stage).toHaveAttribute('src', new RegExp(`img-${n}/full\\.webp$`));
    await expect(page.getByRole('button', { name: `صورة ${n} من 5` })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sd-gallery__count')).toHaveText(`${n} / 5`);
  };
  const size = (label: string) => page.locator('fieldset', { hasText: 'المقاس' }).getByRole('button', { name: label, exact: true });

  await page.goto(`/p/${p.slug}`);
  await expect(page.getByRole('group', { name: 'صور المنتج' }).getByRole('button')).toHaveCount(5);
  await shows(1);
  await page.getByRole('button', { name: 'أزرق', exact: true }).click();
  await shows(3);
  await page.getByRole('button', { name: 'أحمر', exact: true }).click();
  await size('S').click();
  await shows(5);
  await size('M').click();
  await shows(4);
  await page.getByRole('button', { name: 'أخضر', exact: true }).click();
  await shows(1);
  await page.getByRole('button', { name: 'أزرق', exact: true }).click();
  await shows(3);
  await page.getByRole('button', { name: 'صورة 2 من 5' }).click();
  await shows(2);
  await page.getByRole('button', { name: 'أخضر', exact: true }).click();
  await shows(2);

  await page.getByRole('button', { name: 'أحمر', exact: true }).click();
  await size('M').click();
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'أُضيف إلى سلّتك.' })).toBeVisible();
  await page.goto('/cart');
  await expect(page.locator(`img[src*="${key(4)}/thumb.webp"]`)).toHaveCount(1);

  await page.goto(`/p/${single.slug}`);
  await expect(page.locator('.sd-gallery__stage img')).toHaveAttribute('src', new RegExp(`img-9/full\\.webp$`));
  await expect(page.getByRole('group', { name: 'صور المنتج' })).toHaveCount(0);
  await expect(page.locator('.sd-gallery__count')).toHaveCount(0);
});

test('DISC-061: المنتج غير المرئي صفحة 404 «لم نجد هذه الصفحة» — مسودّة وموقوف ومحذوف ومتغيّرات مؤرشفة ومتجر معلَّق وقيد المراجعة ومحظور', async ({ page }) => {
  const s = await shop();
  const suspended = await shop();
  const review = await shop();
  const banned = await shop();
  const draft = await addProduct(s, { nameAr: `مسودّة ${s.t}`, status: 'draft' });
  const rejected = await addProduct(s, { nameAr: `موقوف ${s.t}`, status: 'rejected' });
  const deleted = await addProduct(s, { nameAr: `محذوف ${s.t}` });
  await prisma.product.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
  const archived = await addProduct(s, { nameAr: `بلا متغيّر ${s.t}` });
  await prisma.productVariant.update({ where: { id: archived.variantId }, data: { isActive: false, archivedAt: new Date() } });
  const ofSuspended = await addProduct(suspended, { nameAr: `منتج معلَّق ${s.t}` });
  const ofReview = await addProduct(review, { nameAr: `منتج قيد المراجعة ${s.t}` });
  const ofBanned = await addProduct(banned, { nameAr: `منتج محظور ${s.t}` });
  await prisma.vendor.update({ where: { id: suspended.vendorId }, data: { status: 'suspended', suspendedAt: new Date() } });
  await prisma.vendor.update({ where: { id: review.vendorId }, data: { status: 'in_review', approvedAt: null } });
  await prisma.vendor.update({ where: { id: banned.vendorId }, data: { status: 'banned' } });

  for (const p of [draft, rejected, deleted, archived, ofSuspended, ofReview, ofBanned]) {
    const res = await page.goto(`/p/${p.slug}`);
    expect(res?.status(), p.nameAr).toBe(404);
    await expect(page.getByText('لم نجد هذه الصفحة'), p.nameAr).toBeVisible();
  }
});

test('DISC-063: الرابط العربي خاماً ومشفّراً مرة يفتح المنتج و canonical مشفّر، والمشفّر مرتين 404، و% المعطوبة 404 لا 500', async ({ page }) => {
  const s = await shop();
  const slug = `قميص-قطني-أزرق-${word()}`;
  await addProduct(s, { nameAr: 'قميص قطني أزرق', slug });
  for (const path of [`/p/${slug}`, `/p/${encodeURIComponent(slug)}`]) {
    const res = await page.goto(path);
    // الطلب إلى الخادم مشفّر مرة واحدة — مشفّراً مرتين (%25D8) لكان 404
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('قميص قطني أزرق');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/p/${encodeURIComponent(slug)}$`));
  }
  expect((await page.goto(`/p/${encodeURIComponent(encodeURIComponent(slug))}`))?.status()).toBe(404);
  await expect(page.getByText('لم نجد هذه الصفحة')).toBeVisible();
  // لا 500 في أي حال
  expect((await page.goto('/p/%E0%A4%A'))?.status()).not.toBe(500);
});

// % المعطوبة كانت تبلغ Next فيردّ «400 Bad Request» بالإنجليزية — الوسيط (proxy.ts) يحوّلها إلى 404 الموقع
test('DISC-063: % المعطوبة في رابط المنتج صفحة 404 «لم نجد هذه الصفحة»', async ({ page }) => {
  expect((await page.goto('/p/%E0%A4%A'))?.status()).toBe(404);
  await expect(page.getByText('لم نجد هذه الصفحة')).toBeVisible();
  await expect(page.getByText('Bad Request')).toHaveCount(0);
});
