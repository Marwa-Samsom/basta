/**
 * عملة العرض — قرار صاحبة المشروع 18 أكتوبر 2026، عبر الواجهة البرمجية الحيّة.
 *
 * ما يُثبَت:
 *   1. المتاح للاختيار والافتراضية من الإدارة؛ والمجهولة تسقط إلى الافتراضية.
 *   2. صفحة المنتج بعملة المشتري بمعامل الدفع نفسه (يُحسب هنا مستقلّاً من أسعار
 *      القاعدة)، ومعها سعر المتجر بعملته؛ وبعملة المتجر لا «أصلي».
 *   3. **ما يُرى هو ما يُخصم**: سعر القطعة في السلة = سعرها في صفحة المنتج، وأسطر
 *      المتجر مجموعها مجموعه، ومجاميع المتاجر مجموع الطلب.
 *   4. حدّا السعر بعملة العرض يُحوَّلان لكل عملة متجر بلا خطأ تقريب عند الحدّ.
 *   5. دولار الفهرس (priceUsd) لكل منتج — مفتاح ترتيب واحد بين العملات.
 *   6. عملة الحساب تُحفظ وتُقرأ، والمجهولة 400، والضيف 401.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { StorefrontService } from '../catalog/public';
import { hashPassword } from '../identity/public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `fx${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';

const shopper = { userId: '', token: '' };
const vendorIds: string[] = [];
/** منتج بالريال (250.00) وآخر بالدينار (30.000) */
const sar = { id: '', slug: '', variantId: '' };
const jod = { id: '', slug: '', variantId: '' };

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
function call(method: 'GET' | 'PUT' | 'POST', url: string, opts: { token?: string; cart?: string; body?: unknown } = {}): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cart ? { 'x-cart-token': opts.cart } : {}),
    },
    ...(opts.body !== undefined ? { payload: opts.body as Record<string, unknown> } : {}),
  });
}

/** معامل الدفع من أسعار القاعدة، مستقلّاً عن الخدمة: (هدف ÷ مصدر) × 10^(فرق الخانات) × (1 + الهامش) */
async function factor(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const rate = async (code: string) =>
    code === 'USD'
      ? 1
      : Number(
          (await prisma.exchangeRate.findFirstOrThrow({
            where: { baseCode: 'USD', quoteCode: code, effectiveAt: { lte: new Date() } },
            orderBy: { effectiveAt: 'desc' },
          })).rate,
        );
  const digits = async (code: string) => (await prisma.currency.findUniqueOrThrow({ where: { code } })).minorUnitDigits;
  const spread = Number((await prisma.setting.findUnique({ where: { key: 'fx_spread_bps' } }))?.valueJson ?? 200);
  return ((await rate(to)) / (await rate(from))) * 10 ** ((await digits(to)) - (await digits(from))) * (1 + spread / 10_000);
}

async function makeShop(currency: 'SAR' | 'JOD', price: bigint, into: { id: string; slug: string; variantId: string }) {
  const owner = await prisma.user.create({
    data: {
      email: `owner.${currency.toLowerCase()}.${SUFFIX}@basta.test`,
      fullName: `بائع ${currency}`,
      passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'vendor_owner' } },
    },
  });
  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: owner.id,
      slug: `fx-${currency.toLowerCase()}-${SUFFIX}`,
      nameAr: `متجر ${currency}`,
      status: 'approved',
      approvedAt: new Date(),
      settlementCurrency: currency,
      country: currency === 'SAR' ? 'SA' : 'JO',
    },
  });
  vendorIds.push(vendor.id);
  // فئة صريحة لا قوالب المتجر: الاختبار لا يعتمد على مشغِّل زرع الفئات
  const category = await prisma.vendorCategory.create({ data: { vendorId: vendor.id, nameAr: 'عام', sort: 0 } });
  const slug = `fx-${currency.toLowerCase()}-${SUFFIX}`;
  const product = await prisma.product.create({
    data: { vendorId: vendor.id, vendorCategoryId: category.id, slug, nameAr: `منتج ${currency}`, status: 'active', publishedAt: new Date() },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, vendorId: vendor.id, sku: `FX-${currency}-${SUFFIX}`.toUpperCase(), priceMinorUnits: price, optionsKey: '', isActive: true },
  });
  // المخزون يطابق مجموع حركاته — حارس audit_inventory_drift
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: 10, reserved: 0, lowStockThreshold: 2 } });
  await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 10, reason: 'import', actorUserId: null } });
  Object.assign(into, { id: product.id, slug, variantId: variant.id });
}

interface Money {
  minorUnits: string;
  currency: string;
  formatted: string;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات عملة العرض متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await makeShop('SAR', 25_000n, sar);
  await makeShop('JOD', 30_000n, jod);

  const email = `shopper.${SUFFIX}@basta.test`;
  const u = await prisma.user.create({
    data: { email, fullName: 'مشترٍ العملة', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  const login = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  expect(login.statusCode, login.body).toBe(200);
  Object.assign(shopper, { userId: u.id, token: login.json().tokens.accessToken as string });
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (dbUp) {
    // المنتجات لا تُحذف (مفاتيح المخزون) — تُسحب من المتجر كي لا تظهر للزوار
    await prisma.product.updateMany({ where: { id: { in: [sar.id, jod.id].filter(Boolean) } }, data: { status: 'draft', deletedAt: new Date() } });
    await prisma.vendor.updateMany({ where: { id: { in: vendorIds } }, data: { status: 'suspended' } });
    if (shopper.userId) await prisma.user.delete({ where: { id: shopper.userId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('عملة العرض — 18 أكتوبر 2026', () => {
  it('العملات المتاحة والافتراضية، والمجهولة تسقط إلى الافتراضية لا إلى خطأ', async () => {
    if (!dbUp) return;
    const opts = (await call('GET', '/storefront/currencies')).json() as { defaultCurrency: string; currencies: { code: string; nameAr: string; symbol: string }[] };
    const codes = opts.currencies.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['JOD', 'SAR', 'USD']));
    expect(codes).toContain(opts.defaultCurrency);
    expect(opts.currencies.every((c) => c.nameAr && c.symbol)).toBe(true);

    const unknown = await call('GET', `/storefront/products/${sar.slug}?currency=xyz`);
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().currency).toBe(opts.defaultCurrency);
    expect((await call('GET', `/storefront/products/${sar.slug}?currency=12`)).statusCode).toBe(400);
  });

  it('صفحة المنتج بعملة المشتري بمعامل الدفع، ومعها سعر المتجر بعملته', async () => {
    if (!dbUp) return;
    const inJod = (await call('GET', `/storefront/products/${sar.slug}?currency=JOD`)).json();
    expect(inJod.currency).toBe('JOD');
    expect(inJod.storeCurrency).toBe('SAR');
    expect(inJod.variants[0].price).toMatchObject({ currency: 'JOD', minorUnits: String(Math.round(25_000 * (await factor('SAR', 'JOD')))) });
    expect(inJod.variants[0].originalPrice).toMatchObject({ currency: 'SAR', minorUnits: '25000' });
    expect(inJod.priceFrom).toEqual(inJod.variants[0].price);

    // بعملة المتجر نفسها: السعر كما هو بلا هامش ولا «أصلي»
    const own = (await call('GET', `/storefront/products/${sar.slug}?currency=SAR`)).json();
    expect(own.variants[0].price).toMatchObject({ currency: 'SAR', minorUnits: '25000' });
    expect(own.variants[0].originalPrice).toBeNull();

    // البطاقات في صفحة المتجر بالعملة نفسها
    const shop = (await call('GET', `/storefront/shops/fx-sar-${SUFFIX}?currency=USD`)).json();
    expect(shop.products[0].price).toMatchObject({ currency: 'USD', minorUnits: String(Math.round(25_000 * (await factor('SAR', 'USD')))) });
  });

  it('ما يُرى هو ما يُخصم: سعر القطعة في السلة = صفحة المنتج، والأسطر تجمع المتجر، والمتاجر تجمع الطلب', async () => {
    if (!dbUp) return;
    const created = await call('POST', '/cart', { body: { currency: 'JOD' } });
    expect(created.statusCode, created.body).toBe(201);
    const cart = created.json().token as string;
    expect((await call('POST', '/cart/items', { cart, body: { variantId: sar.variantId, qty: 3 } })).statusCode).toBe(201);
    const view = (await call('POST', '/cart/items', { cart, body: { variantId: jod.variantId, qty: 1 } })).json() as {
      currency: string;
      groups: { storeCurrency: string; subtotal: Money; lines: { variantId: string; unitPrice: Money; lineTotal: Money; originalUnitPrice: Money | null; originalLineTotal: Money | null }[] }[];
      totals: { items: Money };
    };
    expect(view.currency).toBe('JOD');

    const page = (await call('GET', `/storefront/products/${sar.slug}?currency=JOD`)).json();
    const sarGroup = view.groups.find((g) => g.storeCurrency === 'SAR')!;
    const line = sarGroup.lines.find((l) => l.variantId === sar.variantId)!;
    expect(line.unitPrice).toEqual(page.variants[0].price);
    expect(line.originalUnitPrice).toMatchObject({ currency: 'SAR', minorUnits: '25000' });
    expect(line.originalLineTotal).toMatchObject({ currency: 'SAR', minorUnits: '75000' });
    expect(line.lineTotal.currency).toBe('JOD');

    const jodGroup = view.groups.find((g) => g.storeCurrency === 'JOD')!;
    expect(jodGroup.lines[0]!.originalUnitPrice).toBeNull();
    expect(jodGroup.lines[0]!.lineTotal).toMatchObject({ currency: 'JOD', minorUnits: '30000' });

    for (const g of view.groups) {
      const sum = g.lines.reduce((a, l) => a + BigInt(l.lineTotal.minorUnits), 0n);
      expect(String(sum)).toBe(g.subtotal.minorUnits);
      expect(g.subtotal.currency).toBe('JOD');
    }
    const items = view.groups.reduce((a, g) => a + BigInt(g.subtotal.minorUnits), 0n);
    expect(String(items)).toBe(view.totals.items.minorUnits);

    // تغيير العملة يعيد تسعير السلة كلها؛ والمجهولة تُرفض بسبب يُقرأ
    const bad = await call('PUT', '/cart/currency', { cart, body: { currency: 'XYZ' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/عملة غير مدعومة/);
    const usd = (await call('PUT', '/cart/currency', { cart, body: { currency: 'usd' } })).json();
    expect(usd.currency).toBe('USD');
    expect(usd.groups.every((g: { subtotal: Money }) => g.subtotal.currency === 'USD')).toBe(true);
  });

  it('حدّا السعر بعملة العرض: الحدّ المعروض بالضبط داخل، وما دونه بوحدة خارج — لكل عملة متجر', async () => {
    if (!dbUp) return;
    const shown = BigInt((await call('GET', `/storefront/products/${sar.slug}?currency=JOD`)).json().variants[0].price.minorUnits);
    const ids = async (vendorId: string, q: string) =>
      ((await call('GET', `/storefront/products?vendorId=${vendorId}&currency=JOD&${q}`)).json().items as { id: string }[]).map((i) => i.id);

    // متجر بالريال، الحدّ بالدينار: يُحوَّل عكسياً بلا خطأ تقريب عند الحدّ
    expect(await ids(vendorIds[0]!, `maxPrice=${shown}`)).toEqual([sar.id]);
    expect(await ids(vendorIds[0]!, `maxPrice=${shown - 1n}`)).toEqual([]);
    expect(await ids(vendorIds[0]!, `minPrice=${shown}`)).toEqual([sar.id]);
    expect(await ids(vendorIds[0]!, `minPrice=${shown + 1n}`)).toEqual([]);
    // متجر بالدينار: يُقارن بسعره كما هو
    expect(await ids(vendorIds[1]!, 'minPrice=30000&maxPrice=30000')).toEqual([jod.id]);
    expect(await ids(vendorIds[1]!, 'maxPrice=29999')).toEqual([]);

    const range = (await call('GET', `/storefront/products?vendorId=${vendorIds[0]}&currency=JOD`)).json().facets.priceRange;
    expect(range).toEqual({ minMinor: String(shown), maxMinor: String(shown), currency: 'JOD' });
  });

  it('دولار الفهرس لكل منتج بلا هامش — 250 ريالاً و30 ديناراً على مسطرة واحدة', async () => {
    if (!dbUp) return;
    const docs = await app.get(StorefrontService).documentsFor([sar.id, jod.id]);
    const usd = (id: string) => docs.find((d) => d.id === id)!.priceUsd!;
    const spread = Number((await prisma.setting.findUnique({ where: { key: 'fx_spread_bps' } }))?.valueJson ?? 200);
    const noSpread = (k: number) => k / (1 + spread / 10_000);
    expect(usd(sar.id)).toBeCloseTo((25_000 * noSpread(await factor('SAR', 'USD'))) / 100, 6);
    expect(usd(jod.id)).toBeCloseTo((30_000 * noSpread(await factor('JOD', 'USD'))) / 100, 6);
  });

  it('عملة الحساب تُحفظ وتُقرأ، والمجهولة 400، والضيف 401', async () => {
    if (!dbUp) return;
    const saved = await call('PUT', '/me/account/currency', { token: shopper.token, body: { currency: 'sar' } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toEqual({ preferredCurrency: 'SAR' });
    expect((await call('GET', '/me/account', { token: shopper.token })).json().preferredCurrency).toBe('SAR');

    expect((await call('PUT', '/me/account/currency', { token: shopper.token, body: { currency: 'XYZ' } })).statusCode).toBe(400);
    expect((await call('PUT', '/me/account/currency', { body: { currency: 'SAR' } })).statusCode).toBe(401);
    expect((await call('GET', '/me/account', { token: shopper.token })).json().preferredCurrency).toBe('SAR');
  });
});
