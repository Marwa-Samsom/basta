import { expect, test, type Page } from '@playwright/test';
import { API, prisma, signInBuyer } from './fixtures';
import { addProduct, makeShop, retire, type Shop } from './disc-helpers';

/**
 * المفضّلة في الصفحة — ST-23 (DISC-080 · 082 · 083). المحفوظات تُكتب بالقاعدة بسعر حفظها ثم
 * يتغيّر المنتج، فالصفحة تقول ما تغيّر منذ الحفظ. منطق الحالة نفسه مفحوص في apps/api:
 * wishlist.integration.spec.ts.
 */
const shops: Shop[] = [];
const buyers: string[] = [];
test.afterAll(async () => {
  await retire(...shops);
  if (buyers.length) await prisma.user.deleteMany({ where: { id: { in: buyers } } }).catch(() => undefined);
});
async function shop(): Promise<Shop> {
  const s = await makeShop();
  shops.push(s);
  return s;
}
async function buyer(page: Page): Promise<string> {
  const { userId } = await signInBuyer(page);
  buyers.push(userId);
  return userId;
}
const save = (userId: string, productId: string, saved: bigint, createdAt = new Date()) =>
  prisma.wishlistItem.create({ data: { userId, productId, savedPriceMinorUnits: saved, currency: 'JOD', createdAt } });
/** عدد قطع سلة هذا المتصفّح — صفحة الحساب بلا زرّ سلة في رأسها */
async function cartCount(page: Page): Promise<number> {
  const token = await page.evaluate(() => localStorage.getItem('basta.cart'));
  if (!token) return 0;
  const cart = (await (await page.request.get(`${API}/cart`, { headers: { 'x-cart-token': token } })).json()) as { groups: { lines: { qty: number }[] }[] };
  return cart.groups.flatMap((g) => g.lines).reduce((n, l) => n + l.qty, 0);
}
const card = (page: Page, name: string) => page.locator('article.wl-card', { has: page.getByRole('heading', { name, exact: true }) });

test('DISC-080: عند السقف — القلب يرتدّ والإشعار برسالة الخادم كاملة، والصفحة تقول «بلغت الحد (200)»', async ({ page }) => {
  const s = await shop();
  const userId = await buyer(page);
  const fresh = await addProduct(s, { nameAr: `منتج جديد ${s.t}` });
  // 200 محفوظ: مسوّدات بلا متغيّرات لا تظهر في أي مكان
  await prisma.product.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ vendorId: s.vendorId, slug: `disc-cap-${s.t}-${i}`, nameAr: `حشو ${i}`, status: 'draft' as const })) });
  const filler = await prisma.product.findMany({ where: { slug: { startsWith: `disc-cap-${s.t}-` } }, select: { id: true } });
  await prisma.wishlistItem.createMany({ data: filler.map((p) => ({ userId, productId: p.id, savedPriceMinorUnits: 100n, currency: 'JOD' })) });

  await page.goto(`/p/${fresh.slug}`);
  const heart = page.getByRole('button', { name: 'احفظ في المفضّلة' });
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();
  await expect(page.locator('#wish-toast')).toHaveText('بلغت مفضّلتك 200 منتج. أزل منتجاً لم تعد تريده ثم احفظ الجديد.');
  await expect(page.getByRole('button', { name: 'احفظ في المفضّلة' })).toHaveAttribute('aria-pressed', 'false');
  expect(await prisma.wishlistItem.count({ where: { userId } })).toBe(200);

  await page.goto('/account/wishlist');
  await expect(page.getByText('بلغت الحد (200) — أزل منتجاً لتحفظ غيره')).toBeVisible();
});

test('DISC-082: بطاقات المحفوظ — انخفض وارتفع وقارب النفاد ونفد (يغلب تغيّر السعر) وغير متاح بإيقاف الإدارة وبتعليق المتجر', async ({ page }) => {
  const s = await shop();
  const gone = await shop();
  const userId = await buyer(page);
  const a = await addProduct(s, { nameAr: `ينخفض ${s.t}`, price: 10_000n });
  const b = await addProduct(s, { nameAr: `يرتفع ${s.t}`, price: 6_500n });
  const c = await addProduct(s, { nameAr: `قليل ${s.t}`, price: 4_000n, stock: 2 });
  const d = await addProduct(s, { nameAr: `نفد ${s.t}`, price: 7_000n, stock: 0 });
  const e = await addProduct(s, { nameAr: `موقوف ${s.t}`, price: 3_000n });
  const f = await addProduct(gone, { nameAr: `متجره معلَّق ${s.t}`, price: 3_000n });
  await save(userId, a.id, 13_000n);
  await save(userId, b.id, 5_000n);
  await save(userId, c.id, 4_000n);
  await save(userId, d.id, 9_000n);
  await save(userId, e.id, 3_000n);
  await save(userId, f.id, 3_000n);
  await prisma.product.update({ where: { id: e.id }, data: { status: 'rejected', rejectReason: 'مخالف' } });
  await prisma.vendor.update({ where: { id: gone.vendorId }, data: { status: 'suspended', suspendedAt: new Date() } });

  await page.goto('/account/wishlist');
  const drop = card(page, a.nameAr);
  await expect(drop.locator('.wl-card__flag')).toHaveText('انخفض السعر');
  await expect(drop.locator('.wl-card__price .money')).toContainText('10.000');
  await expect(drop.locator('.wl-card__price s')).toContainText('13.000');
  await expect(drop.locator('.wl-card__price s .visually-hidden')).toHaveText('سعره عند الحفظ ');
  await expect(drop.locator('.wl-card__note')).toContainText('انخفض');
  await expect(drop.locator('.wl-card__note')).toContainText('3.000');
  await expect(drop.locator('.wl-card__note')).toContainText('منذ حفظه');

  const rise = card(page, b.nameAr);
  await expect(rise.locator('.wl-card__flag')).toHaveText('ارتفع السعر');
  await expect(rise.locator('.wl-card__note')).toContainText('ارتفع');
  await expect(rise.locator('.wl-card__note')).toContainText('1.500');
  await expect(rise.locator('.wl-card__note')).toContainText('منذ حفظه');

  const low = card(page, c.nameAr);
  await expect(low.locator('.wl-card__flag')).toHaveCount(0);
  await expect(low.locator('.wl-card__note')).toHaveText('بقي 2 فقط');

  const soldOut = card(page, d.nameAr);
  await expect(soldOut.locator('.wl-card__flag')).toHaveText('نفد');
  await expect(soldOut.locator('.wl-card__note')).toHaveText('نفد من المتجر');
  await expect(soldOut.getByRole('button', { name: 'نفد', exact: true })).toBeDisabled();
  await expect(soldOut.getByText('انخفض')).toHaveCount(0);

  for (const item of [e, f]) {
    const unavailable = card(page, item.nameAr);
    await expect(unavailable.locator('.wl-card__flag'), item.nameAr).toHaveText('غير متاح');
    await expect(unavailable.locator('.wl-card__note'), item.nameAr).toHaveText('لم يعد معروضاً في المتجر');
    await expect(unavailable.locator(`a[href="/p/${item.slug}"]`), item.nameAr).toHaveCount(0);
    await expect(unavailable.locator('.wl-card__price'), item.nameAr).toHaveCount(0);
    await expect(unavailable.getByRole('button', { name: 'غير متاح', exact: true }), item.nameAr).toBeDisabled();
  }
  // يبقيان حتى يزيلهما صاحبهما
  await page.reload();
  await expect(card(page, e.nameAr)).toBeVisible();
  await expect(card(page, f.nameAr)).toBeVisible();
});

test('DISC-083: «انقله إلى السلة» يضيف 1 ويُزيل ويعلن، وفشلا الإزالة والإضافة برسالتيهما، و«اختر الخيارات» رابط المنتج، والإزالة تنقل التركيز إلى التالي', async ({ page }) => {
  const s = await shop();
  const userId = await buyer(page);
  const now = Date.now();
  const a = await addProduct(s, { nameAr: `منقول ${s.t}` });
  const b = await addProduct(s, { nameAr: `بخيارات ${s.t}` });
  for (const price of [11_000n, 12_000n]) {
    const v = await prisma.productVariant.create({
      data: { productId: b.id, vendorId: s.vendorId, sku: `DISC-${Math.random().toString(36).slice(2, 10)}`.toUpperCase(), priceMinorUnits: price, optionsKey: `o-${price}`, isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: v.id, onHand: 5, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: v.id, delta: 5, reason: 'import' } });
  }
  const c = await addProduct(s, { nameAr: `يُزال ${s.t}` });
  const d = await addProduct(s, { nameAr: `بعده ${s.t}` });
  const fails = await addProduct(s, { nameAr: `إزالته تفشل ${s.t}` });
  const refused = await addProduct(s, { nameAr: `إضافته تفشل ${s.t}` });
  // الأحدث أولاً: ج ثم د متجاوران
  await save(userId, d.id, 10_000n, new Date(now - 60_000));
  await save(userId, c.id, 10_000n, new Date(now - 50_000));
  await save(userId, b.id, 11_000n, new Date(now - 40_000));
  await save(userId, refused.id, 10_000n, new Date(now - 30_000));
  await save(userId, fails.id, 10_000n, new Date(now - 20_000));
  await save(userId, a.id, 10_000n, new Date(now - 10_000));

  await page.route((u) => u.pathname.endsWith('/cart/items'), async (route) => {
    const body = route.request().postDataJSON() as { variantId: string };
    if (body.variantId === refused.variantId) {
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'CONFLICT', message: 'الكمية المطلوبة غير متوفّرة الآن.' }) });
    }
    await new Promise((r) => setTimeout(r, 700));
    return route.continue();
  });
  await page.route((u) => u.pathname.endsWith(`/me/wishlist/${fails.id}`), (route) =>
    route.request().method() === 'DELETE' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"خلل"}' }) : route.continue(),
  );

  await page.goto('/account/wishlist');
  // أ: «جارٍ النقل…» ثم يختفي ويُعلن النقل، والسلة 1
  await card(page, a.nameAr).getByRole('button', { name: 'انقله إلى السلة' }).click();
  await expect(card(page, a.nameAr).getByRole('button', { name: 'جارٍ النقل…' })).toBeVisible();
  await expect(card(page, a.nameAr)).toHaveCount(0);
  const moved = page.locator('.wl-moved');
  await expect(moved).toContainText(`نُقل «${a.nameAr}» إلى سلّتك.`);
  await expect(moved.getByRole('link', { name: 'اذهب إلى السلة' })).toHaveAttribute('href', '/cart');
  await expect.poll(() => cartCount(page)).toBe(1);
  expect(await prisma.wishlistItem.count({ where: { userId, productId: a.id } })).toBe(0);

  // الإزالة بعد الإضافة تفشل: يُقال ذلك والمنتج في السلة
  await card(page, fails.nameAr).getByRole('button', { name: 'انقله إلى السلة' }).click();
  await expect(page.getByText(`أُضيف «${fails.nameAr}» إلى سلّتك، لكن تعذّرت إزالته من المفضّلة. أزله يدوياً إن شئت.`)).toBeVisible();
  await expect.poll(() => cartCount(page)).toBe(2);

  // الإضافة تفشل: البطاقة باقية ورسالة الخادم تحت «لم يكتمل الطلب»
  await card(page, refused.nameAr).getByRole('button', { name: 'انقله إلى السلة' }).click();
  const alert = page.locator('.alert', { hasText: 'لم يكتمل الطلب' });
  await expect(alert).toContainText('الكمية المطلوبة غير متوفّرة الآن.');
  await expect(card(page, refused.nameAr)).toBeVisible();

  // ب بثلاثة متغيّرات: رابط إلى صفحته بلا تخمين خيار
  await expect(card(page, b.nameAr).getByRole('link', { name: 'اختر الخيارات' })).toHaveAttribute('href', `/p/${b.slug}`);

  // ج: يختفي ويُعلن، والتركيز إلى زرّ إزالة د
  await card(page, c.nameAr).getByRole('button', { name: `أزل «${c.nameAr}» من المفضّلة` }).click();
  await expect(card(page, c.nameAr)).toHaveCount(0);
  await expect(page.locator('p.visually-hidden[role="status"]')).toHaveText(`أُزيل «${c.nameAr}» من المفضّلة.`);
  await expect(page.getByRole('button', { name: `أزل «${d.nameAr}» من المفضّلة` })).toBeFocused();
  // وعدد السلة في رأس المتجر
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'السلة — 2' })).toBeVisible();
});
