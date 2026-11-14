/**
 * ST-23 · المفضّلة — عبر الواجهة البرمجية الحيّة.
 *
 * ما يُثبَت:
 *   1. الضيف 401 على كل المسارات.
 *   2. الحفظ يلتقط أرخص متغيّر نشط بعملة البائع، والتكرار لا يكتب فوقه.
 *   3. ما لا يراه المشتري لا يُحفظ: مسوّدة، محذوف، غير موجود، معرّف مشوّه — 404.
 *   4. تغيّر السعر بعد الحفظ: drop / rise بالفرق الصحيح، ونفاد المخزون sold_out،
 *      والقليل low، وما لم يعد معروضاً يبقى في القائمة unavailable لا يختفي.
 *   5. **عزل المالك**: لا يرى أحد مفضّلة غيره ولا يحذف منها — نزع شرط المالك
 *      يجب أن يُسقط هذا (اختبار طفرة).
 *   6. السقف: 200 ثم 409 برسالة تقول ما العمل، والتكرار عند السقف لا يُرفض.
 *   7. بعملة العرض: المبالغ محوَّلة بمعامل الدفع نفسه، و«انخفض/ارتفع» من سعر
 *      المتجر لا من الصرف (18 أكتوبر 2026). الحالات أعلاه تُقرأ بعملة المتجر (SAR).
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { MAX_WISHLIST } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `wish${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';

const alice = { userId: '', token: '' };
const bob = { userId: '', token: '' };
const carol = { userId: '', token: '' };
let vendorId = '';
const productIds: string[] = [];

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
function call(method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, token?: string, body?: unknown): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

async function makeUser(tag: string) {
  const email = `${tag}.${SUFFIX}@basta.test`;
  const u = await prisma.user.create({
    data: { email, fullName: `مشترٍ ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
  expect(res.statusCode, res.body).toBe(200);
  return { userId: u.id, token: res.json().tokens.accessToken as string };
}

/**
 * معامل الريال ← الدينار كما يحسبه الدفع، من أسعار القاعدة مستقلّاً عن الخدمة:
 * (دينار/دولار ÷ ريال/دولار) × 10^(3−2) × (1 + الهامش).
 */
async function sarToJod(): Promise<number> {
  const rate = async (code: string) =>
    Number((await prisma.exchangeRate.findFirstOrThrow({ where: { baseCode: 'USD', quoteCode: code, effectiveAt: { lte: new Date() } }, orderBy: { effectiveAt: 'desc' } })).rate);
  const spread = Number((await prisma.setting.findUnique({ where: { key: 'fx_spread_bps' } }))?.valueJson ?? 200);
  return ((await rate('JOD')) / (await rate('SAR'))) * 10 * (1 + spread / 10_000);
}

/** منتج بمتغيّراته ومخزونها، مباشرةً بالقاعدة — الاختبار عن المفضّلة لا عن الإنشاء */
async function makeProduct(
  nameAr: string,
  variants: readonly { price: bigint; stock: number }[],
  status: 'active' | 'draft' = 'active',
): Promise<{ id: string; variantIds: string[] }> {
  const product = await prisma.product.create({
    data: {
      vendorId,
      slug: `wish-${SUFFIX}-${Math.random().toString(36).slice(2, 9)}`,
      nameAr,
      status,
      publishedAt: status === 'active' ? new Date() : null,
    },
  });
  productIds.push(product.id);
  const variantIds: string[] = [];
  for (const [i, v] of variants.entries()) {
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        vendorId,
        sku: `WSH-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
        priceMinorUnits: v.price,
        optionsKey: variants.length > 1 ? `opt-${i}` : '',
        isActive: true,
      },
    });
    variantIds.push(variant.id);
    // المخزون يطابق مجموع حركاته — حارس audit_inventory_drift (الدرس 24)
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: v.stock, reserved: 0, lowStockThreshold: 2 } });
    if (v.stock > 0) {
      await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: v.stock, reason: 'import', actorUserId: null } });
    }
  }
  return { id: product.id, variantIds };
}

interface Item {
  productId: string;
  slug: string;
  nameAr: string;
  image: string | null;
  shop: { slug: string; nameAr: string };
  savedPrice: { minorUnits: string; currency: string; formatted: string };
  currentPrice: { minorUnits: string; currency: string; formatted: string } | null;
  delta: { minorUnits: string; currency: string; formatted: string } | null;
  state: string;
  available: number;
  hasVariants: boolean;
  variantId: string | null;
}

/** بعملة المتجر افتراضاً — منطق الحالة يُقرأ بالأرقام كما سعّرها البائع */
async function listOf(user: { token: string }, currency = 'SAR'): Promise<Item[]> {
  const r = await call('GET', `/me/wishlist?currency=${currency}`, user.token);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().items as Item[];
}

const save = (user: { token: string }, productId: string) => call('PUT', `/me/wishlist/${productId}`, user.token);

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات المفضّلة متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const owner = await prisma.user.create({
    data: {
      email: `owner.${SUFFIX}@basta.test`,
      fullName: 'بائع المفضّلة',
      passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'vendor_owner' } },
    },
  });
  vendorId = (
    await prisma.vendor.create({
      data: {
        ownerUserId: owner.id,
        slug: `shop-${SUFFIX}`,
        nameAr: 'متجر المفضّلة',
        status: 'approved',
        approvedAt: new Date(),
        settlementCurrency: 'SAR',
        country: 'SA',
      },
    })
  ).id;

  Object.assign(alice, await makeUser('alice'));
  Object.assign(bob, await makeUser('bob'));
  Object.assign(carol, await makeUser('carol'));
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (dbUp) {
    // المحفوظ يسقط مع صاحبه (Cascade). المنتجات لا تُحذف (مفاتيح المخزون)، فتُسحب من
    // المتجر كي لا تظهر للزوار في قاعدة التطوير.
    await prisma.user.deleteMany({ where: { id: { in: [alice.userId, bob.userId, carol.userId].filter(Boolean) } } }).catch(() => undefined);
    if (productIds.length) {
      await prisma.product
        .updateMany({ where: { id: { in: productIds } }, data: { status: 'archived', deletedAt: new Date() } })
        .catch(() => undefined);
    }
  }
  await prisma.$disconnect();
});

describe('ST-23 · المفضّلة', () => {
  it('بلا دخول: 401 على كل المسارات', async () => {
    if (!dbUp) return;
    const p = await makeProduct('منتج للضيف', [{ price: 1_000n, stock: 5 }]);
    expect((await call('GET', '/me/wishlist')).statusCode).toBe(401);
    expect((await call('GET', '/me/wishlist/ids')).statusCode).toBe(401);
    expect((await call('PUT', `/me/wishlist/${p.id}`)).statusCode).toBe(401);
    expect((await call('DELETE', `/me/wishlist/${p.id}`)).statusCode).toBe(401);
  });

  it('الحفظ يلتقط أرخص متغيّر نشط بعملة البائع، والتكرار لا يكتب فوق السعر المحفوظ', async () => {
    if (!dbUp) return;
    const multi = await makeProduct('قميص بمقاسين', [
      { price: 10_000n, stock: 5 },
      { price: 8_000n, stock: 5 },
    ]);
    const single = await makeProduct('وشاح قطني', [{ price: 5_800n, stock: 10 }]);

    expect((await save(alice, multi.id)).statusCode).toBe(204);
    expect((await save(alice, single.id)).statusCode).toBe(204);

    let items = await listOf(alice);
    // الأحدث أولاً
    expect(items.map((i) => i.productId).slice(0, 2)).toEqual([single.id, multi.id]);
    const m = items.find((i) => i.productId === multi.id)!;
    expect(m.savedPrice).toMatchObject({ minorUnits: '8000', currency: 'SAR' });
    expect(m.currentPrice?.minorUnits).toBe('8000');
    expect(m.state).toBe('ok');
    expect(m.delta).toBeNull();
    expect(m.hasVariants).toBe(true);
    expect(m.variantId).toBeNull();
    expect(m.shop.slug).toBe(`shop-${SUFFIX}`);

    const s = items.find((i) => i.productId === single.id)!;
    expect(s.hasVariants).toBe(false);
    expect(s.variantId).toBe(single.variantIds[0]);

    // السعر يرتفع ثم يعيد المشتري الضغط: السعر المحفوظ يبقى سعر الحفظ الأول
    await prisma.productVariant.update({ where: { id: single.variantIds[0]! }, data: { priceMinorUnits: 7_000n } });
    expect((await save(alice, single.id)).statusCode).toBe(204);
    expect(await prisma.wishlistItem.count({ where: { userId: alice.userId, productId: single.id } })).toBe(1);
    items = await listOf(alice);
    const again = items.find((i) => i.productId === single.id)!;
    expect(again.savedPrice.minorUnits).toBe('5800');
    expect(again.currentPrice?.minorUnits).toBe('7000');

    const ids = await call('GET', '/me/wishlist/ids', alice.token);
    expect(ids.statusCode).toBe(200);
    expect(ids.json().ids).toEqual(expect.arrayContaining([multi.id, single.id]));
  });

  it('ما لا يراه المشتري لا يُحفظ: مسوّدة ومحذوف وغير موجود ومعرّف مشوّه — 404', async () => {
    if (!dbUp) return;
    const draft = await makeProduct('مسوّدة', [{ price: 1_000n, stock: 5 }], 'draft');
    const deleted = await makeProduct('محذوف', [{ price: 1_000n, stock: 5 }]);
    await prisma.product.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    expect((await save(alice, draft.id)).statusCode).toBe(404);
    expect((await save(alice, deleted.id)).statusCode).toBe(404);
    expect((await save(alice, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await save(alice, 'not-a-uuid')).statusCode).toBe(404);
    expect(await prisma.wishlistItem.count({ where: { userId: alice.userId, productId: { in: [draft.id, deleted.id] } } })).toBe(0);
  });

  it('تغيّر السعر: drop و rise بالفرق الصحيح، والنفاد sold_out، والقليل low', async () => {
    if (!dbUp) return;
    const drop = await makeProduct('قميص ينخفض', [{ price: 9_200n, stock: 10 }]);
    const rise = await makeProduct('عطر يرتفع', [{ price: 38_000n, stock: 10 }]);
    const sold = await makeProduct('مفارش نفدت', [{ price: 24_000n, stock: 0 }]);
    const low = await makeProduct('وشاح قليل', [
      { price: 5_800n, stock: 2 },
      { price: 6_000n, stock: 1 },
    ]);
    for (const p of [drop, rise, sold, low]) expect((await save(bob, p.id)).statusCode).toBe(204);

    await prisma.productVariant.update({ where: { id: drop.variantIds[0]! }, data: { priceMinorUnits: 7_900n } });
    await prisma.productVariant.update({ where: { id: rise.variantIds[0]! }, data: { priceMinorUnits: 42_000n } });

    const items = await listOf(bob);
    const by = (id: string) => items.find((i) => i.productId === id)!;

    expect(by(drop.id).state).toBe('drop');
    expect(by(drop.id).delta).toMatchObject({ minorUnits: '1300', currency: 'SAR' });
    expect(by(drop.id).savedPrice.minorUnits).toBe('9200');
    expect(by(drop.id).currentPrice?.minorUnits).toBe('7900');

    expect(by(rise.id).state).toBe('rise');
    expect(by(rise.id).delta?.minorUnits).toBe('4000');

    // بالدينار: كل مبلغ محوَّل بمعامل الدفع (سعر اليوم + الهامش)، والحالة كما هي
    const k = await sarToJod();
    const jod = await listOf(bob, 'JOD');
    const j = (id: string) => jod.find((i) => i.productId === id)!;
    expect(j(drop.id).state).toBe('drop');
    expect(j(drop.id).savedPrice).toMatchObject({ minorUnits: String(Math.round(9_200 * k)), currency: 'JOD' });
    expect(j(drop.id).currentPrice).toMatchObject({ minorUnits: String(Math.round(7_900 * k)), currency: 'JOD' });
    expect(j(drop.id).delta).toMatchObject({ minorUnits: String(Math.round(1_300 * k)), currency: 'JOD' });
    expect(j(rise.id).state).toBe('rise');

    expect(by(sold.id).state).toBe('sold_out');
    expect(by(sold.id).available).toBe(0);

    // المتاح عبر المتغيّرات كلها: 2 + 1 = 3
    expect(by(low.id).state).toBe('low');
    expect(by(low.id).available).toBe(3);
  });

  it('ما لم يعد معروضاً يبقى في القائمة بحالة unavailable ويُزال بطلب صاحبه', async () => {
    if (!dbUp) return;
    const p = await makeProduct('منتج سيُؤرشف', [{ price: 3_000n, stock: 4 }]);
    expect((await save(bob, p.id)).statusCode).toBe(204);
    await prisma.product.update({ where: { id: p.id }, data: { status: 'archived' } });

    const item = (await listOf(bob)).find((i) => i.productId === p.id)!;
    expect(item.state).toBe('unavailable');
    expect(item.currentPrice).toBeNull();
    expect(item.variantId).toBeNull();
    expect(item.savedPrice.minorUnits).toBe('3000');

    expect((await call('DELETE', `/me/wishlist/${p.id}`, bob.token)).statusCode).toBe(204);
    expect((await listOf(bob)).some((i) => i.productId === p.id)).toBe(false);
  });

  it('عزل المالك: لا يرى أحد مفضّلة غيره ولا يحذف منها', async () => {
    if (!dbUp) return;
    const p = await makeProduct('منتج أليس', [{ price: 2_500n, stock: 5 }]);
    expect((await save(alice, p.id)).statusCode).toBe(204);

    const carolItems = await listOf(carol);
    expect(carolItems.some((i) => i.productId === p.id)).toBe(false);
    expect(carolItems).toHaveLength(0);
    expect((await call('GET', '/me/wishlist/ids', carol.token)).json().ids).toEqual([]);

    // حذف كارول لمنتج في مفضّلة أليس: 204 بلا أثر — الرد لا يكشف شيئاً والصف باقٍ
    expect((await call('DELETE', `/me/wishlist/${p.id}`, carol.token)).statusCode).toBe(204);
    expect(await prisma.wishlistItem.count({ where: { userId: alice.userId, productId: p.id } })).toBe(1);
    expect((await listOf(alice)).some((i) => i.productId === p.id)).toBe(true);
  });

  it('الإزالة عديمة الأثر: مرتان متتاليتان 204', async () => {
    if (!dbUp) return;
    const p = await makeProduct('يُزال مرتين', [{ price: 1_500n, stock: 5 }]);
    expect((await save(alice, p.id)).statusCode).toBe(204);
    expect((await call('DELETE', `/me/wishlist/${p.id}`, alice.token)).statusCode).toBe(204);
    expect((await call('DELETE', `/me/wishlist/${p.id}`, alice.token)).statusCode).toBe(204);
    expect(await prisma.wishlistItem.count({ where: { userId: alice.userId, productId: p.id } })).toBe(0);
  });

  it(`السقف ${MAX_WISHLIST}: الجديد 409 برسالة واضحة، والمحفوظ من قبل يُقبل تكراره`, async () => {
    if (!dbUp) return;
    const kept = await makeProduct('محفوظ قبل السقف', [{ price: 1_000n, stock: 5 }]);
    const extra = await makeProduct('بعد السقف', [{ price: 1_000n, stock: 5 }]);
    expect((await save(carol, kept.id)).statusCode).toBe(204);

    // الحشو مسوّدات تُدرج مباشرةً: 199 منتجاً بلا متغيّرات لا تظهر في أي مكان
    const filler = Array.from({ length: MAX_WISHLIST - 1 }, (_, i) => ({
      vendorId,
      slug: `wish-fill-${SUFFIX}-${i}`,
      nameAr: `حشو ${i}`,
      status: 'draft' as const,
    }));
    await prisma.product.createMany({ data: filler });
    const fillerIds = (await prisma.product.findMany({ where: { slug: { startsWith: `wish-fill-${SUFFIX}-` } }, select: { id: true } })).map((r) => r.id);
    productIds.push(...fillerIds);
    await prisma.wishlistItem.createMany({
      data: fillerIds.map((productId) => ({ userId: carol.userId, productId, savedPriceMinorUnits: 100n, currency: 'SAR' })),
    });
    expect(await prisma.wishlistItem.count({ where: { userId: carol.userId } })).toBe(MAX_WISHLIST);

    const over = await save(carol, extra.id);
    expect(over.statusCode).toBe(409);
    expect(over.json().message).toContain(`${MAX_WISHLIST}`);
    expect(over.json().message).toMatch(/أزل/);
    expect(await prisma.wishlistItem.count({ where: { userId: carol.userId } })).toBe(MAX_WISHLIST);

    expect((await save(carol, kept.id)).statusCode).toBe(204);

    // بعد إزالة واحد يتّسع مكان
    expect((await call('DELETE', `/me/wishlist/${kept.id}`, carol.token)).statusCode).toBe(204);
    expect((await save(carol, extra.id)).statusCode).toBe(204);
  });
});

describe('ST-23 · المفضّلة — حالات DISC', () => {
  /** متجر بالدينار: الحالة بأرقام JOD كما كتبتها (13.000 و15.000 ومعطّل 9.000) */
  async function jodProduct(nameAr: string, variants: readonly { price: bigint; active: boolean }[]) {
    const owner = await prisma.user.create({
      data: { email: `jod.${Math.random().toString(36).slice(2, 8)}.${SUFFIX}@basta.test`, fullName: 'بائع بالدينار', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
    });
    const vendor = await prisma.vendor.create({
      data: { ownerUserId: owner.id, slug: `jod-${Math.random().toString(36).slice(2, 8)}-${SUFFIX}`, nameAr: 'متجر الدينار', status: 'approved', approvedAt: new Date(), settlementCurrency: 'JOD', country: 'JO' },
    });
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, slug: `wish-jod-${SUFFIX}-${Math.random().toString(36).slice(2, 9)}`, nameAr, status: 'active', publishedAt: new Date(), hasVariants: true },
    });
    productIds.push(product.id);
    const variantIds: string[] = [];
    for (const [i, v] of variants.entries()) {
      const variant = await prisma.productVariant.create({
        data: { productId: product.id, vendorId: vendor.id, sku: `WJD-${Math.random().toString(36).slice(2, 9).toUpperCase()}`, priceMinorUnits: v.price, optionsKey: `opt-${i}`, isActive: v.active },
      });
      variantIds.push(variant.id);
      await prisma.inventory.create({ data: { variantId: variant.id, onHand: 5, reserved: 0 } });
      await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 5, reason: 'import', actorUserId: null } });
    }
    return { id: product.id, vendorId: vendor.id, variantIds };
  }

  it('DISC-077: 13.000 JOD المحفوظ لا المعطّل الأرخص (9.000)، والحفظ الثاني بعد الخفض لا يغيّره، فالقائمة drop بـ3.000 — وبالريال محوَّلة والحالة drop', async () => {
    if (!dbUp) return;
    const p = await jodProduct('قميص بالدينار', [
      { price: 13_000n, active: true },
      { price: 15_000n, active: true },
      { price: 9_000n, active: false },
    ]);
    expect((await save(alice, p.id)).statusCode).toBe(204);
    const row = await prisma.wishlistItem.findFirstOrThrow({ where: { userId: alice.userId, productId: p.id } });
    expect(row.savedPriceMinorUnits).toBe(13_000n);
    expect(row.currency).toBe('JOD');

    await prisma.productVariant.update({ where: { id: p.variantIds[0]! }, data: { priceMinorUnits: 10_000n } });
    expect((await save(alice, p.id)).statusCode).toBe(204);
    expect((await prisma.wishlistItem.findFirstOrThrow({ where: { userId: alice.userId, productId: p.id } })).savedPriceMinorUnits).toBe(13_000n);

    const item = (await listOf(alice, 'JOD')).find((i) => i.productId === p.id)!;
    expect(item.savedPrice).toMatchObject({ minorUnits: '13000', currency: 'JOD' });
    expect(item.currentPrice).toMatchObject({ minorUnits: '10000', currency: 'JOD' });
    expect(item.delta).toMatchObject({ minorUnits: '3000', currency: 'JOD' });
    expect(item.state).toBe('drop');

    // بالريال: الثلاثة محوَّلة بمعامل الدفع، والحالة من سعر المتجر لا من الصرف
    const k = 1 / (await sarToJod()) * (1 + Number((await prisma.setting.findUnique({ where: { key: 'fx_spread_bps' } }))?.valueJson ?? 200) / 10_000) ** 2;
    const sar = (await listOf(alice, 'SAR')).find((i) => i.productId === p.id)!;
    expect(sar.state).toBe('drop');
    expect(sar.savedPrice.currency).toBe('SAR');
    expect(sar.currentPrice?.currency).toBe('SAR');
    expect(sar.delta?.currency).toBe('SAR');
    expect(Number(sar.savedPrice.minorUnits)).toBe(Math.round(13_000 * k));
    expect(Number(sar.currentPrice?.minorUnits)).toBe(Math.round(10_000 * k));
  });

  it('DISC-078: الموقوف من الإدارة ومنتج المتجر المعلَّق 404، وكل حالات الرفض برسالة «المنتج غير موجود أو لم يعد معروضاً.» ولا صف', async () => {
    if (!dbUp) return;
    const stopped = await makeProduct('موقوف من الإدارة', [{ price: 1_000n, stock: 5 }]);
    await prisma.product.update({ where: { id: stopped.id }, data: { status: 'rejected', rejectReason: 'مخالف' } });
    const draft = await makeProduct('مسوّدة للرسالة', [{ price: 1_000n, stock: 5 }], 'draft');
    const deleted = await makeProduct('محذوف للرسالة', [{ price: 1_000n, stock: 5 }]);
    await prisma.product.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const other = await jodProduct('منتج متجر معلَّق', [{ price: 2_000n, active: true }]);
    await prisma.vendor.update({ where: { id: other.vendorId }, data: { status: 'suspended', suspendedAt: new Date() } });

    for (const id of [stopped.id, other.id, draft.id, deleted.id, '00000000-0000-4000-8000-000000000000', 'abc']) {
      const res = await save(alice, id);
      expect(res.statusCode, id).toBe(404);
      expect(res.json().message, id).toBe('المنتج غير موجود أو لم يعد معروضاً.');
    }
    expect(await prisma.wishlistItem.count({ where: { userId: alice.userId, productId: { in: [stopped.id, other.id, draft.id, deleted.id] } } })).toBe(0);
  });

  it(`DISC-080: عند ${MAX_WISHLIST - 1} طلبا حفظ متزامنان لمنتجين جديدين — واحد 204 والآخر 409 بالرسالة كاملة، والعدد ${MAX_WISHLIST} لا أكثر`, async () => {
    if (!dbUp) return;
    const dave = await makeUser('dave');
    try {
      const filler = Array.from({ length: MAX_WISHLIST - 1 }, (_, i) => ({ vendorId, slug: `wish-race-${SUFFIX}-${i}`, nameAr: `حشو تزامن ${i}`, status: 'draft' as const }));
      await prisma.product.createMany({ data: filler });
      const fillerIds = (await prisma.product.findMany({ where: { slug: { startsWith: `wish-race-${SUFFIX}-` } }, select: { id: true } })).map((r) => r.id);
      productIds.push(...fillerIds);
      await prisma.wishlistItem.createMany({ data: fillerIds.map((productId) => ({ userId: dave.userId, productId, savedPriceMinorUnits: 100n, currency: 'SAR' })) });
      const one = await makeProduct('تزامن أول', [{ price: 1_000n, stock: 5 }]);
      const two = await makeProduct('تزامن ثانٍ', [{ price: 1_000n, stock: 5 }]);

      const results = await Promise.all([save(dave, one.id), save(dave, two.id)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([204, 409]);
      const refused = results.find((r) => r.statusCode === 409)!;
      expect(refused.json().message).toBe(`بلغت مفضّلتك ${MAX_WISHLIST} منتج. أزل منتجاً لم تعد تريده ثم احفظ الجديد.`);
      expect(await prisma.wishlistItem.count({ where: { userId: dave.userId } })).toBe(MAX_WISHLIST);
    } finally {
      await prisma.user.delete({ where: { id: dave.userId } }).catch(() => undefined);
    }
  });
});
