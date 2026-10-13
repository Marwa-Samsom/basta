/**
 * بلا شركة شحن (SHIPPING_CARRIER=none) — التوصيل ذاتي وحده.
 *
 * كانت الشركة الوهمية تعلّم كل شحنة «سُلّمت» بعد نحو أربعين دقيقة، فتبدأ فترة
 * التعليق ثم يُحرَّر مال البائع، والمشتري لم يستلم شيئاً. ما يُثبَت:
 *   · لا شركة في القائمة، ولا بوليصة، ولا شحنة باسم شركة
 *   · لا مهمة تتقدّم بالشحنات: شحنة ذاتية تبقى «مشحونة» حتى يؤكّد البائع التسليم
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const previous = process.env['SHIPPING_CARRIER'];
const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;
let token = '';
let vendorId = '';
let advanceAll: () => Promise<number>;

const SUFFIX = `nocar${Date.now()}`;
const PASSWORD = 'كلمة-مرور-البائع-الطويلة';
const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  // قبل استيراد التطبيق: الإعداد يُقرأ مرة عند أول إقلاع
  process.env['SHIPPING_CARRIER'] = 'none';
  const [{ Test }, { AppModule }, { configureApp }, { hashPassword }, { TrackingService }] = await Promise.all([
    import('@nestjs/testing'),
    import('../../app.module'),
    import('../../app.setup'),
    import('../identity/public'),
    import('./public'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const tracking = app.get(TrackingService);
  advanceAll = () => tracking.advanceAll();

  const email = `seller.${SUFFIX}@basta.test`;
  const user = await prisma.user.create({
    data: { email, fullName: 'بائع بلا شركة', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ role: 'vendor_owner' }] } },
  });
  const vendor = await prisma.vendor.create({
    data: { ownerUserId: user.id, slug: `v-${SUFFIX}`, nameAr: 'متجر يوصّل بنفسه', status: 'approved', approvedAt: new Date(), settlementCurrency: 'JOD', country: 'JO' },
  });
  vendorId = vendor.id;
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
  token = login.json().tokens.accessToken as string;
}, 90_000);

afterAll(async () => {
  if (previous === undefined) delete process.env['SHIPPING_CARRIER'];
  else process.env['SHIPPING_CARRIER'] = previous;
  await app?.close();
  await prisma.$disconnect();
});

describe('SHIPPING_CARRIER=none — التوصيل ذاتي وحده', () => {
  it('لا شركة في القائمة ولا بوليصة، ولا شحنة باسم شركة', async () => {
    if (!dbUp) return;
    expect((await call('GET', '/vendor/shipping/carriers')).json()).toEqual([{ code: 'self', nameAr: 'توصيل ذاتي' }]);

    const waybill = await call('POST', `/vendor/shipping/waybill/${randomUUID()}`);
    expect(waybill.statusCode).toBe(409);
    expect(waybill.json().message).toMatch(/التوصيل ذاتي/);

    const named = await call('POST', `/vendor/orders/${randomUUID()}/transition`, { to: 'shipped', tracking: 'BX1234567890', carrierCode: 'basta-express' });
    expect(named.statusCode).toBe(400);
    expect(named.json().message).toMatch(/لا شركة شحن موصولة/);
  });

  it('لا مهمة تعلّم شيئاً مستلَماً: الشحنة المشحونة تبقى حتى يؤكّد البائع', async () => {
    if (!dbUp) return;
    // شحنة باسم الشركة الوهمية من قبل (بيانات قديمة) لا تتقدّم أيضاً
    const customer = await prisma.user.create({ data: { email: `buyer.${SUFFIX}@basta.test`, fullName: 'مشترٍ', passwordHash: 'x' } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `NC-${SUFFIX}`,
        idempotencyKey: randomUUID(),
        customerUserId: customer.id,
        status: 'processing',
        currency: 'JOD',
        itemsSubtotalMinorUnits: 1000n,
        grandTotalMinorUnits: 1000n,
        shippingAddressSnapshot: {},
      },
    });
    const sub = await prisma.subOrder.create({
      data: {
        orderId: order.id,
        vendorId,
        subOrderNumber: `NC-${SUFFIX}-1`,
        status: 'shipped',
        settlementCurrency: 'JOD',
        fxRateSnapshot: 1,
        itemsSubtotalMinorUnits: 1000n,
        totalMinorUnits: 1000n,
        chargeTotalMinorUnits: 1000n,
        commissionRateBpsSnapshot: 1000,
        commissionMinorUnits: 100n,
        vendorNetMinorUnits: 900n,
        shipment: { create: { carrierCode: 'basta-express', trackingNumber: `BX${Date.now()}`, status: 'in_transit', shippedAt: new Date() } },
      },
    });

    try {
      expect(await advanceAll()).toBe(0);
      expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('shipped');
    } finally {
      // طلب مصنوع بلا دفع ولا دفتر: يبقى فيظهر في مراقبات الانحراف لكل الاختبارات الأخرى
      await prisma.shipment.deleteMany({ where: { subOrderId: sub.id } });
      await prisma.subOrder.delete({ where: { id: sub.id } });
      await prisma.order.delete({ where: { id: order.id } });
    }
  });
});
