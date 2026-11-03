import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { API, makeAdmin, makeVendor, PASSWORD, prisma, register, tag } from './fixtures';

/**
 * «المزيد» و«السابق» و«X من Y» لكل قائمة تكبر — بطلب صاحبة المشروع (3 نوفمبر 2026): «ليش فشي
 * السابق والتالي… في جميع الحالات التي يجب ان يكون موجود فيه» على «صفحات المحتوى» (263 صفاً، ACFG-056).
 * القوائم كانت تُجلب كلها وتُصفّى في الصفحة، أو تقف عند سقف صامت. الآن كلها صفحات من الخادم،
 * والتبويب والبحث يُرسلان إليه — يُفحص هنا في الطلب نفسه لا في الصفوف وحدها.
 */

test.use({ viewport: { width: 1440, height: 900 } });

async function signIn(page: Page, email: string, next: string, totp?: () => string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  if (totp) {
    await page.getByLabel('رمز التحقق الثنائي').fill(totp());
    await page.getByRole('button', { name: 'دخول' }).click();
  }
  await page.waitForURL((u) => u.pathname === next);
}

/** «المزيد» يُلحق الباقي و«السابق» يظهر؛ «السابق» يعيد العدّ إلى الصفحة الأولى ويختفي */
async function moreThenBack(scope: Page | Locator, first: number, total: number, more = 'المزيد'): Promise<void> {
  const count = scope.locator('.list-more__count');
  const back = scope.getByRole('button', { name: 'السابق', exact: true });
  const next = scope.getByRole('button', { name: more, exact: true });
  await expect(count).toHaveText(`${first} من ${total}`);
  await expect(back).toHaveCount(0);
  await next.click();
  await expect(count).toHaveText(`${total} من ${total}`);
  await expect(next).toHaveCount(0);
  await back.click();
  await expect(count).toHaveText(`${first} من ${total}`);
  await expect(back).toHaveCount(0);
  await expect(next).toBeVisible();
}

/** البحث يُرسل إلى الخادم، والقائمة تعرض ما أعاده */
async function search(page: Page, box: Locator, term: string, path: string): Promise<void> {
  const sent = page.waitForRequest((r) => r.url().includes(path) && new URL(r.url()).searchParams.get('search') === term);
  await box.fill(term);
  await sent;
}

/** التبويب يُرسل تصفيته إلى الخادم */
async function tab(page: Page, name: RegExp, path: string, param: string, value: string): Promise<void> {
  const sent = page.waitForRequest((r) => r.url().includes(path) && new URL(r.url()).searchParams.get(param) === value);
  await page.getByRole('tab', { name }).click();
  await sent;
}

const rows = (page: Page) => page.locator('table tbody tr:not(.ac2-rownote):not(.ac2-expand)');

// ====================================================================== الإدارة

test('صفحات المحتوى: «المزيد» و«السابق» والعدّ، والتبويب والبحث من الخادم، وتلميح الرابط بالمعرّف المكتوب', async ({ page }) => {
  const t = tag();
  await prisma.cmsPage.createMany({ data: Array.from({ length: 53 }, (_, i) => ({ slug: `pg-${t}-${i}`, titleAr: `صفحة ${t} ${i}`, bodyAr: 'نص.', isPublished: i < 40 })) });
  try {
    const admin = await makeAdmin(t, ['content.manage']);
    await signIn(page, admin.email, '/admin/pages', admin.totp);
    await search(page, page.getByRole('searchbox', { name: 'ابحث بعنوان الصفحة' }), t, '/admin/pages');
    await moreThenBack(page, 50, 53);
    await tab(page, /^مسوّدة/, '/admin/pages', 'status', 'draft');
    await expect(rows(page)).toHaveCount(13);
    await expect(page.locator('.list-more')).toHaveCount(0);

    // «يظهر في الرابط: /pages/terms» كان ثابتاً مهما كُتب المعرّف
    await page.getByRole('button', { name: 'صفحة جديدة' }).click();
    await page.getByLabel('المُعرّف النصّي').fill('tajriba');
    await expect(page.getByText('يظهر في الرابط: /pages/tajriba')).toBeVisible();
    await expect(page.getByText('/pages/terms')).toHaveCount(0);
  } finally {
    await prisma.cmsPage.deleteMany({ where: { slug: { startsWith: `pg-${t}-` } } });
  }
});

test('الكوبونات: «المزيد» و«السابق» والعدّ، والحالة من الخادم', async ({ page }) => {
  const t = tag();
  const stem = `PG${t.slice(-8)}`.toUpperCase();
  await prisma.coupon.createMany({
    data: Array.from({ length: 53 }, (_, i) => ({ code: `${stem}${i}`, scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform', isActive: i !== 0 })),
  });
  try {
    const admin = await makeAdmin(t, ['coupons.manage']);
    await signIn(page, admin.email, '/admin/coupons', admin.totp);
    await search(page, page.getByRole('searchbox', { name: 'ابحث برمز الكوبون' }), stem, '/admin/coupons');
    await moreThenBack(page, 50, 53);
    await tab(page, /^موقوف/, '/admin/coupons', 'state', 'off');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`${stem}0`);
  } finally {
    await prisma.coupon.deleteMany({ where: { code: { startsWith: stem } } });
  }
});

test('اللافتات: «المزيد» و«السابق» والعدّ، و«الرئيسية» من الخادم', async ({ page }) => {
  const t = tag();
  await prisma.banner.createMany({
    data: Array.from({ length: 52 }, (_, i) => ({ placement: i < 50 ? 'home_hero' : 'category_top', imageKey: `banners/${randomUUID()}`, titleAr: `لافتة ${t} ${i}`, isActive: false, sort: i })),
  });
  try {
    const admin = await makeAdmin(t, ['content.manage']);
    await signIn(page, admin.email, '/admin/storefront', admin.totp);
    await search(page, page.getByRole('searchbox', { name: 'ابحث بعنوان اللافتة' }), t, '/admin/banners');
    await moreThenBack(page, 50, 52);
    await tab(page, /^الرئيسية/, '/admin/banners', 'filter', 'home');
    await expect(page.locator('.list-more')).toHaveCount(0);
    await expect(page.locator('table tbody tr')).toHaveCount(50);
  } finally {
    await prisma.banner.deleteMany({ where: { titleAr: { contains: t } } });
  }
});

test('العمولة: النسب الخاصة «المزيد» و«السابق» والعدّ، والبحث باسم المتجر من الخادم', async ({ page }) => {
  const t = tag();
  const owners = Array.from({ length: 52 }, (_, i) => ({ id: randomUUID(), email: `cm${i}.${t}@basta.test`, fullName: `مالك ${i}`, passwordHash: 'x' }));
  await prisma.user.createMany({ data: owners });
  const shops = owners.map((o, i) => ({ id: randomUUID(), ownerUserId: o.id, slug: `cm-${t}-${i}`, nameAr: `عمولة ${t} ${i}`, status: 'approved' as const, approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA' }));
  await prisma.vendor.createMany({ data: shops });
  await prisma.commissionRule.createMany({ data: shops.map((s, i) => ({ scope: 'vendor', vendorId: s.id, rateBps: 100 + i, effectiveFrom: new Date(Date.now() - i * 1000) })) });

  const admin = await makeAdmin(t, ['commissions.edit']);
  await signIn(page, admin.email, '/admin/commissions', admin.totp);
  await search(page, page.getByRole('searchbox', { name: 'صفِّ النسب الخاصة باسم المتجر' }), `عمولة ${t}`, '/admin/finance/commissions');
  const custom = page.locator('section', { has: page.getByRole('heading', { name: 'نسب خاصة بمتاجر' }) });
  await moreThenBack(custom, 50, 52);
});

test('مستخدمو الإدارة: «المزيد» و«السابق» والعدّ، و«بلا تحقّق بخطوتين» من الخادم', async ({ page }) => {
  const t = tag();
  const made = Array.from({ length: 52 }, (_, i) => ({ id: randomUUID(), email: `adm${i}.${t}@basta.test`, fullName: `مشرف ${t} ${i}`, passwordHash: 'x', ...(i < 20 ? { totpEnabledAt: new Date() } : {}) }));
  await prisma.user.createMany({ data: made });
  await prisma.userRole.createMany({ data: made.map((u) => ({ userId: u.id, role: 'admin' as const })) });

  const admin = await makeAdmin(t, ['users.manage']);
  await signIn(page, admin.email, '/admin/users', admin.totp);
  await search(page, page.getByRole('searchbox', { name: 'ابحث بالاسم أو البريد' }), `مشرف ${t}`, '/admin/users');
  await moreThenBack(page, 50, 52);
  await tab(page, /^بلا تحقّق بخطوتين/, '/admin/users', 'filter', 'tfa_off');
  await expect(rows(page)).toHaveCount(32);
});

test('الخصائص: «المزيد» و«السابق» والعدّ، و«محاور المتغيّرات» من الخادم', async ({ page }) => {
  const t = tag();
  await prisma.attribute.createMany({
    data: Array.from({ length: 52 }, (_, i) => ({ code: `pg_${t}_${i}`, nameAr: `خصيصة ${t} ${i}`, inputType: 'text', isVariantAxis: i < 10, archivedAt: new Date() })),
  });
  try {
    const admin = await makeAdmin(t, ['catalog.manage']);
    await signIn(page, admin.email, '/admin/attributes', admin.totp);
    await search(page, page.getByRole('searchbox', { name: 'ابحث في الخصائص' }), `pg_${t}`, '/admin/attributes');
    await moreThenBack(page, 50, 52);
    await tab(page, /^محاور المتغيّرات/, '/admin/attributes', 'filter', 'axis');
    await expect(rows(page)).toHaveCount(10);
  } finally {
    await prisma.attribute.deleteMany({ where: { code: { startsWith: `pg_${t}_` } } });
  }
});

test('الحملات: «المزيد» و«السابق» والعدّ، والحالة من الخادم', async ({ page }) => {
  const t = tag();
  const h = 3_600_000;
  const now = Date.now();
  // منتهية وموقوفة فقط: لا تظهر في الرئيسية، وتُمحى بعد الاختبار
  await prisma.campaign.createMany({
    data: Array.from({ length: 52 }, (_, i) => ({
      nameAr: `حملة ${t} ${i}`, placement: 'home_top', isActive: i >= 20 ? false : true,
      startsAt: new Date(now - 3 * h), endsAt: new Date(i < 20 ? now - h : now + h),
    })),
  });
  try {
    const admin = await makeAdmin(t, ['content.manage']);
    await signIn(page, admin.email, '/admin/campaigns', admin.totp);
    await search(page, page.getByRole('searchbox', { name: 'ابحث باسم الحملة' }), t, '/admin/campaigns');
    await moreThenBack(page, 50, 52);
    await tab(page, /^منتهية/, '/admin/campaigns', 'status', 'ended');
    await expect(rows(page)).toHaveCount(20);
  } finally {
    await prisma.campaign.deleteMany({ where: { nameAr: { contains: t } } });
  }
});

test('التقارير: فترة مرفوضة وتصدير مرفوض برسالة واحدة لا اثنتين، وتغيير الفترة يمسح رفض التصدير', async ({ page }) => {
  const t = tag();
  const admin = await makeAdmin(t, ['reports.view']);
  // الفترة الحقيقية 367 يوماً يرفضها الخادم نفسه — تُبدَّل في الطلب لا في منتقي التاريخ
  let tooLong = true;
  const stretch = (url: string) => {
    const u = new URL(url);
    u.searchParams.set('from', '2025-01-01');
    u.searchParams.set('to', '2026-01-02');
    return u.toString();
  };
  await page.route(/\/api\/v1\/admin\/reports\/financial\?/, (route) => (tooLong ? route.continue({ url: stretch(route.request().url()) }) : route.continue()));
  await page.route(/\/api\/v1\/admin\/reports\/financial\.(csv|xlsx)\?/, (route) => route.continue({ url: stretch(route.request().url()) }));
  let downloads = 0;
  page.on('download', () => downloads++);

  await signIn(page, admin.email, '/admin/reports', admin.totp);
  const alerts = page.getByRole('alert').filter({ hasText: 'يوماً على الأكثر' });
  await expect(alerts).toHaveCount(1);
  const rejected = page.waitForResponse((r) => r.url().includes('/admin/reports/financial.csv'));
  await page.getByRole('button', { name: 'تصدير CSV' }).click();
  expect((await rejected).status()).toBe(400);
  // ACFG-090: لا ملف، وتنبيه أحمر بالسبب — واحد لا اثنان
  // الرفض وصل — يُنتظر رسمه ثم يُعدّ: قبل التصليح كان الثاني يظهر فوق الأول
  await page.waitForTimeout(500);
  expect(await alerts.count()).toBe(1);
  expect(downloads).toBe(0);

  // التقرير بفترة صحيحة والتصدير ما زال مرفوضاً: رفضه وحده يظهر، وتغيير الفترة يمسحه
  tooLong = false;
  await page.getByRole('button', { name: 'آخر 7 أيام' }).click();
  await expect(alerts).toHaveCount(0);
  const again = page.waitForResponse((r) => r.url().includes('/admin/reports/financial.csv'));
  await page.getByRole('button', { name: 'تصدير CSV' }).click();
  await again;
  await expect(alerts).toHaveCount(1);
  await page.getByRole('button', { name: 'آخر 30 يوماً' }).click();
  await expect(alerts).toHaveCount(0);
  expect(downloads).toBe(0);
});

// ======================================================================== البائع

/** دخول من الواجهة البرمجية — طلب الاختبار يُبنى قبل أن تُفتح أي صفحة */
async function apiToken(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  expect(res.ok, `دخول ${email}: ${res.status}`).toBe(true);
  return ((await res.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function post<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  expect(res.ok, `${path} ${res.status} ${res.ok ? '' : await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** متجر ومشترية بطلب مدفوع، وعلى طلب المتجر 21 نزاعاً، وبينهما 31 محادثة */
async function shopWithHistory(t: string) {
  const v = await makeVendor(t);
  const buyerEmail = `buyer.${t}@basta.test`;
  const buyerId = await register(buyerEmail, `مشترية ${t}`);
  const auth = { authorization: `Bearer ${await apiToken(buyerEmail)}` };
  const cart = await post<{ token: string }>('/cart', { currency: 'SAR' }, auth);
  const h = { ...auth, 'x-cart-token': cart.token };
  await post('/cart/items', { variantId: v.variantId, qty: 1 }, h);
  const quote = await post<{ currency: string; totals: { total: { minorUnits: string } } }>('/checkout/quote', { country: 'SA', region: 'الرياض', city: 'الرياض' }, h);
  const address = { recipientName: 'مشترية الصفحات', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' };
  const order = await post<{ orderNumber: string }>(
    '/checkout',
    { address, paymentToken: 'tok_success', expectedTotal: quote.totals.total.minorUnits, expectedCurrency: quote.currency },
    { ...h, 'idempotency-key': randomUUID() },
  );
  const sub = await prisma.subOrder.findFirstOrThrow({ where: { order: { orderNumber: order.orderNumber } } });
  const reasons = ['damaged', 'not_received', 'other'];
  await prisma.dispute.createMany({
    data: Array.from({ length: 21 }, (_, i) => ({ subOrderId: sub.id, openedByUserId: buyerId, against: 'vendor', reasonCode: reasons[i % 3]!, status: 'closed', createdAt: new Date(Date.now() - i * 60_000) })),
  });
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: v.vendorId }, orderBy: { sort: 'asc' } });
  const products = Array.from({ length: 31 }, (_, i) => ({ id: randomUUID(), vendorId: v.vendorId, vendorCategoryId: category.id, slug: `msg-${t}-${i}`, nameAr: `منتج محادثة ${t} ${i}`, status: 'draft' as const }));
  await prisma.product.createMany({ data: products });
  await prisma.conversation.createMany({
    data: products.map((p, i) => ({
      customerId: buyerId, vendorId: v.vendorId, contextKey: `product:${p.id}`, productId: p.id, lastPreview: `سؤال ${i}`, lastSenderSide: 'customer',
      lastMessageAt: new Date(Date.now() - i * 60_000), customerReadAt: new Date(),
    })),
  });
  return { v, buyerEmail, buyerId, sub };
}

test('لوحة البائع: النزاعات والرسائل والسحوبات والإشعارات بـ«المزيد» و«السابق» والعدّ، والبحث والرقائق من الخادم', async ({ page }) => {
  const t = tag();
  const { v } = await shopWithHistory(t);
  const wallet = await prisma.wallet.upsert({ where: { vendorId_currency: { vendorId: v.vendorId, currency: 'SAR' } }, create: { vendorId: v.vendorId, currency: 'SAR' }, update: {} });
  await prisma.payoutRequest.createMany({
    data: Array.from({ length: 21 }, (_, i) => ({
      vendorId: v.vendorId, walletId: wallet.id, currency: 'SAR', amountMinorUnits: BigInt(1000 + i), status: 'rejected' as const,
      rejectReason: 'اختبار الصفحات', bankAccountSnapshot: { bankName: 'بنك تجريبي', iban: 'SA0380000000608010167519' }, requestedAt: new Date(Date.now() - i * 60_000),
    })),
  });
  // إشعارات طلب الاختبار تُترك خارج العدّ — الصندوق بما أُنشئ هنا وحده
  await prisma.notification.updateMany({ where: { userId: v.userId }, data: { status: 'skipped' } });
  await prisma.notification.createMany({
    data: Array.from({ length: 35 }, (_, i) => ({
      userId: v.userId, channel: 'in_app', templateCode: i < 20 ? 'vendor_new_order' : 'payout_paid', payloadJson: {}, status: 'sent',
      body: `إشعار ${t} ${i}`, sentAt: new Date(Date.now() - i * 60_000), createdAt: new Date(Date.now() - i * 60_000),
    })),
  });

  await signIn(page, v.email, '/vendor/disputes');
  await moreThenBack(page, 20, 21);
  await search(page, page.getByRole('searchbox', { name: 'صفِّ النزاعات' }), 'تالفاً', '/vendor/disputes');
  await expect(page.locator('.sp-dlist tbody tr')).toHaveCount(7);

  await page.goto('/vendor/messages');
  const list = page.locator('.ms-list');
  await moreThenBack(list, 30, 31);
  await search(page, page.getByRole('searchbox', { name: 'صفِّ المحادثات' }), `منتج محادثة ${t} 7`, '/vendor/conversations');
  await expect(list.locator('.ms-row')).toHaveCount(1);
  await expect(page.getByText(/^31 محادثة/)).toBeVisible();

  await page.goto('/vendor/finance');
  await moreThenBack(page.locator('section', { has: page.getByRole('heading', { name: 'سجلّ السحوبات' }) }), 20, 21);

  await page.goto('/vendor/notifications');
  await moreThenBack(page, 30, 35, 'الأقدم');
  const money = page.waitForRequest((r) => r.url().includes('/me/notifications') && (new URL(r.url()).searchParams.get('codes') ?? '').split(',').includes('payout_paid'));
  await page.getByRole('button', { name: /^المال/ }).click();
  await money;
  await expect(page.locator('.vx-note')).toHaveCount(15);
  await expect(page.getByRole('button', { name: /^المال/ })).toContainText('15');
  await expect(page.getByRole('button', { name: /^الطلبات/ })).toContainText('20');
});

test('كشف الحساب: «السابق» بجانب «حمّل القيود التالية»، والعدّ للمدة كلها', async ({ page }) => {
  const t = tag();
  const v = await makeVendor(t);
  // ألف قيد لا يُصنع لاختبار زرّ — الكشف وصفحاته من ردّ مُعترَض
  const row = (i: number) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, createdAt: new Date(Date.now() - (10 - i) * 60_000).toISOString(), entryType: 'sale_credit', label: 'مبيعات',
    direction: 'credit', bucket: 'pending', amountMinorUnits: '1000', subOrderNumber: null, memo: null, reversesEntryId: null, pendingAfter: String(1000 * (i + 1)), availableAfter: '0',
  });
  const balance = { pendingMinorUnits: '0', availableMinorUnits: '0' };
  await page.route(/\/api\/v1\/vendor\/finance\/wallets(\?.*)?$/, (route) =>
    route.fulfill({ json: [{ currency: 'SAR', pendingMinorUnits: '0', availableMinorUnits: '0', withdrawnMinorUnits: '0', nextReleaseAt: null, canWithdraw: false, minPayoutMinorUnits: '0' }] }),
  );
  await page.route(/\/api\/v1\/vendor\/finance\/statement\?/, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    return route.fulfill({
      json: cursor
        ? { currency: 'SAR', opening: balance, closing: balance, rows: [row(2)], nextCursor: null, total: 3 }
        : { currency: 'SAR', opening: balance, closing: balance, rows: [row(0), row(1)], nextCursor: row(1).id, total: 3 },
    });
  });
  await signIn(page, v.email, '/vendor/finance/statement');
  await moreThenBack(page, 2, 3, 'حمّل القيود التالية');
});

// ======================================================================== المشتري

test('حساب المشتري: «طلباتي» والنزاعات والرسائل بـ«المزيد» و«السابق» والعدّ، والإشعارات بعدّها', async ({ page }) => {
  const t = tag();
  const { buyerEmail, buyerId } = await shopWithHistory(t);
  await prisma.notification.updateMany({ where: { userId: buyerId }, data: { status: 'skipped' } });
  await prisma.notification.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      userId: buyerId, channel: 'in_app', templateCode: 'order_placed', payloadJson: {}, status: 'sent', body: `إشعار ${i}`,
      sentAt: new Date(Date.now() - i * 60_000), createdAt: new Date(Date.now() - i * 60_000),
    })),
  });
  // «طلباتي» كانت أول عشرين وحدها — خمسة وعشرون طلباً من ردّ مُعترَض، والطلب الثاني يحمل page=2
  const order = (i: number) => ({
    number: `BST-${t}-${i}`, status: 'completed', currency: 'SAR', grandTotalMinorUnits: '10000', placedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    payment: null, stores: [{ vendor: 'متجر', status: 'delivered', items: [{ productNameSnapshotAr: 'منتج', imageKeySnapshot: null, qty: 1 }] }],
  });
  await page.route(/\/api\/v1\/me\/orders(\?.*)?$/, (route) => {
    const p = Number(new URL(route.request().url()).searchParams.get('page') ?? '1');
    return route.fulfill({ json: { items: p === 1 ? Array.from({ length: 20 }, (_, i) => order(i)) : Array.from({ length: 5 }, (_, i) => order(20 + i)), total: 25 } });
  });

  await signIn(page, buyerEmail, '/account/orders');
  await moreThenBack(page, 20, 25);

  await page.goto('/account/disputes');
  await moreThenBack(page, 20, 21);

  await page.goto('/account/messages');
  await moreThenBack(page.locator('.ms-list'), 30, 31);

  await page.goto('/account/notifications');
  await expect(page.locator('.list-more__count')).toHaveText('20 من 25');
  await page.getByRole('button', { name: 'حمّل المزيد' }).click();
  await expect(page.locator('.list-more__count')).toHaveText('25 من 25');
});

test('ملف العميل في الإدارة: طلباته بـ«المزيد» و«السابق» والعدّ (كانت آخر عشرين)', async ({ page }) => {
  const t = tag();
  const email = `customer.${t}@basta.test`;
  const userId = await register(email, `عميلة ${t}`);
  // خمسة وعشرون طلباً من ردّ مُعترَض — الصفحة الثانية تُطلب بـ page=2
  const order = (i: number) => ({ id: randomUUID(), orderNumber: `BST-${t}-${i}`, status: 'completed', currency: 'SAR', grandTotalMinorUnits: '10000', placedAt: new Date(Date.now() - i * 86_400_000).toISOString() });
  await page.route(new RegExp(`/api/v1/admin/customers/${userId}/orders(\\?.*)?$`), (route) => {
    const p = Number(new URL(route.request().url()).searchParams.get('page') ?? '1');
    return route.fulfill({ json: { items: p === 1 ? Array.from({ length: 20 }, (_, i) => order(i)) : Array.from({ length: 5 }, (_, i) => order(20 + i)), total: 25 } });
  });
  const admin = await makeAdmin(t, ['customers.manage']);
  await signIn(page, admin.email, '/admin/customers', admin.totp);
  await page.getByRole('searchbox', { name: 'بحث في العملاء' }).fill(email);
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'الملف' }).click();
  await moreThenBack(page.locator('.ao-cprofile'), 20, 25);
});
