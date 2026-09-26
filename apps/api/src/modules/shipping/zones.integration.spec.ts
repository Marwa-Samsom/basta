/**
 * VD-16 — مناطق الشحن عبر الواجهة البرمجية الحيّة.
 *
 * ما يُثبَت:
 *   · منطقة تُنشأ من الواجهة تقرؤها نواة التسعير نفسها (PricingService.quote):
 *     البلد، والمدينة الأدقّ تفوز، و«حسب الوزن» و«مجاني فوق مبلغ» كما تحسبها
 *   · التحقّق يرفض كل شكل تسيء النواة قراءته: حقل لا تقرؤه الطريقة، حقل ناقص،
 *     مبلغ سالب أو عشري، مدى أيام مقلوب، تغطية أو تسعيرات فارغة
 *   · الاتساق: تغطيتان متعادلتان في منطقتين مفعّلتين مرفوضتان، ومنطقة مفعّلة
 *     بلا تسعيرة مفعّلة مرفوضة
 *   · العزل: بائع لا يرى مناطق غيره ولا يلمسها (404 لا 403)، والمشتري لا يصل إليها
 *
 * قاعدة التطوير مشتركة: كل شيء باسم فيه SUFFIX، ومنتجات الاختبار تُؤرشف في النهاية.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { PricingService } from '../pricing/public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let pricing: PricingService;
let dbUp = false;

const SUFFIX = `shz${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';

interface Seat {
  vendorId: string;
  variantId: string;
  productId: string;
  token: string;
}
const seats: Seat[] = [];
let customerToken = '';

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token?: string, body?: unknown): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

async function login(email: string): Promise<string> {
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tokens.accessToken as string;
}

const flat = (price: string, minDays = 2, maxDays = 4) => ({ method: 'flat', priceMinorUnits: price, minDays, maxDays });

/** شحن بائع في سلّة من متغيّره وحده، كما تحسبه نواة التسعير عند الدفع */
async function quote(i: number, address: { country: string; region: string | null; city: string | null }, qty = 1) {
  const q = await pricing.quote({ items: [{ variantId: seats[i]!.variantId, qty }], currency: 'SAR', address, couponCode: null });
  const sub = q.subOrders.find((s) => s.vendorId === seats[i]!.vendorId);
  return { blockers: q.blockers, shipping: sub?.vendor.shipping ?? null, days: sub?.shipping ?? null };
}

const RIYADH = { country: 'SA', region: 'الرياض', city: 'الرياض' };
const JEDDAH = { country: 'SA', region: 'مكة المكرمة', city: 'جدة' };

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات مناطق الشحن متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  pricing = app.get(PricingService);

  const home = await prisma.category.findUniqueOrThrow({ where: { slug: 'home' } });
  for (const tag of ['a', 'b']) {
    const email = `ship${tag}.${SUFFIX}@basta.test`;
    const u = await prisma.user.create({
      data: { email, fullName: `بائع شحن ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
    });
    const vendor = await prisma.vendor.create({
      data: {
        ownerUserId: u.id, slug: `ship-${tag}-${SUFFIX}`, nameAr: `متجر شحن ${tag} ${SUFFIX}`, status: 'approved',
        approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA',
      },
    });
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, categoryId: home.id, slug: `ship-${tag}-${SUFFIX}`, nameAr: `منتج شحن ${tag}`, status: 'active', publishedAt: new Date() },
    });
    // 2.4 كغ — «حسب الوزن» يقرّبها إلى 3
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendor.id, sku: `SHZ-${tag}-${SUFFIX}`.toUpperCase(), priceMinorUnits: 10_000n, optionsKey: '', isActive: true, weightGrams: 2_400 },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 50, reserved: 0 } });
    // المخزون يطابق مجموع حركاته — حارس audit_inventory_drift في verify يفحص ذلك (ADR-006)
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 50, reason: 'import' } });
    seats.push({ vendorId: vendor.id, variantId: variant.id, productId: product.id, token: await login(email) });
  }
  await prisma.user.create({
    data: { email: `shipc.${SUFFIX}@basta.test`, fullName: 'مشترٍ', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  customerToken = await login(`shipc.${SUFFIX}@basta.test`);
}, 120_000);

afterAll(async () => {
  if (dbUp && seats.length) {
    const now = new Date();
    await prisma.productVariant.updateMany({ where: { id: { in: seats.map((s) => s.variantId) } }, data: { archivedAt: now, isActive: false } });
    await prisma.product.updateMany({ where: { id: { in: seats.map((s) => s.productId) } }, data: { deletedAt: now, status: 'archived' } });
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('VD-16 · المنطقة المنشأة من الواجهة تقرؤها نواة التسعير', () => {
  it('بلا منطقة: البائع لا يشحن — ثم منطقة بلد كامل تُسعِّر كل مدنه', async () => {
    if (!dbUp) return;
    const before = await quote(0, RIYADH);
    expect(before.blockers.length).toBeGreaterThan(0);
    expect(before.blockers.join(' ')).toContain('لا يشحن إلى عنوانك');

    const res = await call('POST', '/vendor/shipping/zones', seats[0]!.token, {
      nameAr: 'السعودية كلها',
      regions: [{ country: 'sa' }],
      rates: [flat('2500', 3, 5)],
    });
    expect(res.statusCode, res.body).toBe(201);
    const zone = res.json();
    expect(zone.regions).toEqual([expect.objectContaining({ country: 'SA', region: null, city: null })]);
    expect(zone.rates[0]).toMatchObject({ method: 'flat', priceMinorUnits: '2500', perKgMinorUnits: null, minDays: 3, maxDays: 5, isActive: true });

    for (const addr of [RIYADH, JEDDAH]) {
      const q = await quote(0, addr);
      expect(q.blockers).toEqual([]);
      expect(q.shipping).toBe(2_500n);
      expect(q.days).toEqual({ minDays: 3, maxDays: 5 });
    }
    expect((await quote(0, { country: 'JO', region: 'عمّان', city: 'عمّان' })).blockers.join(' ')).toContain('لا يشحن إلى عنوانك');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'shipping_zone.create', entityId: zone.id } });
    expect(audit).not.toBeNull();
  });

  it('المدينة الأدقّ تفوز على البلد، و«حسب الوزن» و«مجاني فوق مبلغ» كما تحسبها النواة', async () => {
    if (!dbUp) return;
    const res = await call('POST', '/vendor/shipping/zones', seats[0]!.token, {
      nameAr: 'الرياض',
      regions: [{ country: 'SA', region: '  الرياض ', city: 'الرياض  ' }],
      rates: [
        { method: 'by_weight', priceMinorUnits: '500', perKgMinorUnits: '300', minDays: 1, maxDays: 2 },
        { method: 'free_over', priceMinorUnits: '4000', freeOverMinorUnits: '30000', minDays: 2, maxDays: 3 },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    // القصّ يطابق ما يفعله التسعير
    expect(res.json().regions[0]).toMatchObject({ region: 'الرياض', city: 'الرياض' });

    // قطعة 2.4 كغ ← 3 كغ: 500 + 3×300 = 1400؛ «مجاني فوق» لم يبلغ حدّه ← 4000؛ الأرخص 1400
    const one = await quote(0, RIYADH, 1);
    expect(one.shipping).toBe(1_400n);
    expect(one.days).toEqual({ minDays: 1, maxDays: 2 });
    // ثلاث قطع = 30000 تبلغ الحدّ ← مجاني
    const three = await quote(0, RIYADH, 3);
    expect(three.shipping).toBe(0n);
    expect(three.days).toEqual({ minDays: 2, maxDays: 3 });
    // جدة خارج المدينة ← منطقة البلد
    expect((await quote(0, JEDDAH)).shipping).toBe(2_500n);
  });

  it('تبديل الطريقة يمسح حقول الطريقة السابقة، والإيقاف يُخرج التسعيرة من الحساب', async () => {
    if (!dbUp) return;
    const zone = (await call('GET', '/vendor/shipping/zones', seats[0]!.token)).json().zones.find((z: { nameAr: string }) => z.nameAr === 'الرياض');
    const byWeight = zone.rates.find((r: { method: string }) => r.method === 'by_weight');
    const sw = await call('PATCH', `/vendor/shipping/rates/${byWeight.id}`, seats[0]!.token, { method: 'flat', priceMinorUnits: '900' });
    expect(sw.statusCode, sw.body).toBe(200);
    expect(sw.json().rates.find((r: { id: string }) => r.id === byWeight.id)).toMatchObject({ method: 'flat', priceMinorUnits: '900', perKgMinorUnits: null });
    expect((await quote(0, RIYADH)).shipping).toBe(900n);

    const off = await call('PATCH', `/vendor/shipping/rates/${byWeight.id}`, seats[0]!.token, { isActive: false });
    expect(off.statusCode, off.body).toBe(200);
    expect((await quote(0, RIYADH)).shipping).toBe(4_000n);
  });
});

describe('VD-16 · التحقّق يرفض الأشكال التي تسيء النواة قراءتها', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['ثابت مع سعر كيلو', { method: 'flat', priceMinorUnits: '100', perKgMinorUnits: '50', minDays: 1, maxDays: 2 }],
    ['ثابت مع حدّ مجاني', { method: 'flat', priceMinorUnits: '100', freeOverMinorUnits: '5000', minDays: 1, maxDays: 2 }],
    ['حسب الوزن بلا سعر كيلو', { method: 'by_weight', priceMinorUnits: '100', minDays: 1, maxDays: 2 }],
    ['حسب الوزن بسعر كيلو صفر', { method: 'by_weight', priceMinorUnits: '100', perKgMinorUnits: '0', minDays: 1, maxDays: 2 }],
    ['مجاني فوق بلا حدّ', { method: 'free_over', priceMinorUnits: '100', minDays: 1, maxDays: 2 }],
    ['مدى أيام مقلوب', { method: 'flat', priceMinorUnits: '100', minDays: 5, maxDays: 2 }],
    ['مدى ينتهي بصفر', { method: 'flat', priceMinorUnits: '100', minDays: 0, maxDays: 0 }],
    ['مبلغ سالب', { method: 'flat', priceMinorUnits: '-100', minDays: 1, maxDays: 2 }],
    ['مبلغ عشري', { method: 'flat', priceMinorUnits: '12.5', minDays: 1, maxDays: 2 }],
    ['مبلغ عدداً لا نصاً', { method: 'flat', priceMinorUnits: 100, minDays: 1, maxDays: 2 }],
    ['طريقة مجهولة', { method: 'per_item', priceMinorUnits: '100', minDays: 1, maxDays: 2 }],
    ['أيام كسرية', { method: 'flat', priceMinorUnits: '100', minDays: 1.5, maxDays: 2 }],
  ];
  for (const [name, rate] of bad) {
    it(`تسعيرة مرفوضة: ${name}`, async () => {
      if (!dbUp) return;
      const res = await call('POST', '/vendor/shipping/zones', seats[1]!.token, { nameAr: `مرفوضة ${name}`, regions: [{ country: 'AE' }], rates: [rate] });
      expect(res.statusCode, res.body).toBe(400);
    });
  }

  it('تغطية أو تسعيرات فارغة، وبلد بغير رمزه — مرفوضة، ولا منطقة تُحفظ', async () => {
    if (!dbUp) return;
    for (const body of [
      { nameAr: 'بلا تغطية', regions: [], rates: [flat('100')] },
      { nameAr: 'بلا تسعيرة', regions: [{ country: 'AE' }], rates: [] },
      { nameAr: 'بلد خطأ', regions: [{ country: 'SAU' }], rates: [flat('100')] },
      { nameAr: 'حقل زائد', regions: [{ country: 'AE' }], rates: [flat('100')], vendorId: seats[0]!.vendorId },
    ]) {
      const res = await call('POST', '/vendor/shipping/zones', seats[1]!.token, body);
      expect(res.statusCode, `${body.nameAr}: ${res.body}`).toBe(400);
    }
    expect(await prisma.shippingZone.count({ where: { vendorId: seats[1]!.vendorId } })).toBe(0);
  });

  it('تسعيرة مرفوضة عند الإضافة والتعديل أيضاً — لا عند الإنشاء وحده', async () => {
    if (!dbUp) return;
    const zone = (await call('GET', '/vendor/shipping/zones', seats[0]!.token)).json().zones[0];
    const add = await call('POST', `/vendor/shipping/zones/${zone.id}/rates`, seats[0]!.token, { method: 'by_weight', priceMinorUnits: '100', minDays: 1, maxDays: 2 });
    expect(add.statusCode, add.body).toBe(400);
    const edit = await call('PATCH', `/vendor/shipping/rates/${zone.rates[0].id}`, seats[0]!.token, { minDays: 9, maxDays: 3 });
    expect(edit.statusCode, edit.body).toBe(400);
    const kg = await call('PATCH', `/vendor/shipping/rates/${zone.rates[0].id}`, seats[0]!.token, { perKgMinorUnits: '100' });
    expect(kg.statusCode, kg.body).toBe(400);
  });
});

describe('VD-16 · الاتساق: لا تعادل ولا منطقة مفعّلة بلا سعر', () => {
  it('منطقة ثانية مفعّلة بالبلد نفسه مرفوضة — والموقوفة مقبولة، ثم تفعيلها مرفوض', async () => {
    if (!dbUp) return;
    const dup = await call('POST', '/vendor/shipping/zones', seats[0]!.token, { nameAr: 'تكرار البلد', regions: [{ country: 'SA' }], rates: [flat('100')] });
    expect(dup.statusCode, dup.body).toBe(409);

    const off = await call('POST', '/vendor/shipping/zones', seats[0]!.token, { nameAr: 'احتياط', isActive: false, regions: [{ country: 'SA' }], rates: [flat('100')] });
    expect(off.statusCode, off.body).toBe(201);
    const on = await call('PATCH', `/vendor/shipping/zones/${off.json().id}`, seats[0]!.token, { isActive: true });
    expect(on.statusCode, on.body).toBe(409);
    // الموقوفة لا تُقرأ: السعر كما كان
    expect((await quote(0, JEDDAH)).shipping).toBe(2_500n);
  });

  it('مدينة بلا محافظة تتعادل مع المدينة نفسها بمحافظتها — مرفوضة؛ ومحافظة أعمّ مقبولة', async () => {
    if (!dbUp) return;
    const tie = await call('POST', '/vendor/shipping/zones', seats[0]!.token, { nameAr: 'مدينة الرياض', regions: [{ country: 'SA', city: 'الرياض' }], rates: [flat('100')] });
    expect(tie.statusCode, tie.body).toBe(409);
    const wider = await call('POST', '/vendor/shipping/zones', seats[0]!.token, { nameAr: 'محافظة الرياض', regions: [{ country: 'SA', region: 'الرياض' }], rates: [flat('1800')] });
    expect(wider.statusCode, wider.body).toBe(201);
    // مدينة الرياض ما زالت تفوز؛ مدينة أخرى في المحافظة تأخذ سعر المحافظة
    expect((await quote(0, RIYADH)).shipping).toBe(4_000n);
    expect((await quote(0, { country: 'SA', region: 'الرياض', city: 'الخرج' })).shipping).toBe(1_800n);
  });

  it('إيقاف آخر تسعيرة مفعّلة في منطقة مفعّلة مرفوض — والإيقاف بعد إيقاف المنطقة مقبول', async () => {
    if (!dbUp) return;
    const zones = (await call('GET', '/vendor/shipping/zones', seats[0]!.token)).json().zones;
    const zone = zones.find((z: { nameAr: string }) => z.nameAr === 'محافظة الرياض');
    const last = await call('PATCH', `/vendor/shipping/rates/${zone.rates[0].id}`, seats[0]!.token, { isActive: false });
    expect(last.statusCode, last.body).toBe(409);
    expect((await prisma.shippingRate.findUniqueOrThrow({ where: { id: zone.rates[0].id } })).isActive).toBe(true);

    expect((await call('PATCH', `/vendor/shipping/zones/${zone.id}`, seats[0]!.token, { isActive: false })).statusCode).toBe(200);
    expect((await call('PATCH', `/vendor/shipping/rates/${zone.rates[0].id}`, seats[0]!.token, { isActive: false })).statusCode).toBe(200);
    // وتفعيل منطقة بلا تسعيرة مفعّلة مرفوض
    expect((await call('PATCH', `/vendor/shipping/zones/${zone.id}`, seats[0]!.token, { isActive: true })).statusCode).toBe(409);
  });
});

describe('VD-16 · العزل بين البائعين', () => {
  it('البائع ب لا يرى مناطق أ ولا يعدّلها ولا يحذفها ولا يضيف إليها — 404، وبيانات أ كما هي', async () => {
    if (!dbUp) return;
    const mine = (await call('GET', '/vendor/shipping/zones', seats[0]!.token)).json();
    const zone = mine.zones.find((z: { nameAr: string }) => z.nameAr === 'السعودية كلها');
    const snapshot = JSON.stringify(zone);

    const theirs = (await call('GET', '/vendor/shipping/zones', seats[1]!.token)).json();
    expect(theirs.zones.map((z: { id: string }) => z.id)).not.toContain(zone.id);

    const b = seats[1]!.token;
    const attempts = [
      await call('PATCH', `/vendor/shipping/zones/${zone.id}`, b, { nameAr: 'اختطاف', regions: [{ country: 'KW' }] }),
      await call('PATCH', `/vendor/shipping/zones/${zone.id}`, b, { isActive: false }),
      await call('POST', `/vendor/shipping/zones/${zone.id}/rates`, b, flat('1')),
      await call('PATCH', `/vendor/shipping/rates/${zone.rates[0].id}`, b, { priceMinorUnits: '1' }),
      await call('PATCH', `/vendor/shipping/rates/${zone.rates[0].id}`, b, { isActive: false }),
      await call('DELETE', `/vendor/shipping/zones/${zone.id}`, b),
    ];
    for (const r of attempts) expect(r.statusCode, r.body).toBe(404);

    const after = (await call('GET', '/vendor/shipping/zones', seats[0]!.token)).json().zones.find((z: { id: string }) => z.id === zone.id);
    expect(JSON.stringify(after)).toBe(snapshot);
    expect(await prisma.shippingRate.count({ where: { zoneId: zone.id } })).toBe(zone.rates.length);
  });

  it('المشتري لا يصل إلى مناطق الشحن أصلاً', async () => {
    if (!dbUp) return;
    expect((await call('GET', '/vendor/shipping/zones', customerToken)).statusCode).toBe(403);
    expect((await call('POST', '/vendor/shipping/zones', customerToken, { nameAr: 'x', regions: [{ country: 'SA' }], rates: [flat('1')] })).statusCode).toBe(403);
  });

  it('الحذف يُخرج المنطقة من التسعير ويُسجَّل في التدقيق', async () => {
    if (!dbUp) return;
    const zones = (await call('GET', '/vendor/shipping/zones', seats[0]!.token)).json().zones;
    const city = zones.find((z: { nameAr: string }) => z.nameAr === 'الرياض');
    const del = await call('DELETE', `/vendor/shipping/zones/${city.id}`, seats[0]!.token);
    expect(del.statusCode, del.body).toBe(204);
    expect((await quote(0, RIYADH)).shipping).toBe(2_500n);
    expect(await prisma.auditLog.count({ where: { action: 'shipping_zone.delete', entityId: city.id } })).toBe(1);
  });
});
