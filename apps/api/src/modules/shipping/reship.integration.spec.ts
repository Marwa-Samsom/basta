/**
 * إعادة الشحن بعد «تعذّر التوصيل» — VOPS-035 (29 أكتوبر 2026).
 *
 * كانت أحداث المحاولة الأولى تبقى وآخرها «تعذّر»، فمهمة الشركة لا تتقدّم بالشحنة المعادة أبداً، والتتبّع
 * العام يُظهر «تعذّر التوصيل» أعلى الرقم الجديد؛ وزرّ البوليصة يظهر على «تعذّر التوصيل» والخادم يرفضه؛
 * ومرجعٌ يكتبه البائع بيده يبقى باسم الشركة. ما يُثبَت:
 *   · بوليصة جديدة بعد «تعذّر» تُشحن وتمضي من «استلمت الشركة» حتى «تم التسليم» كأول مرة
 *   · التتبّع العام للرقم الجديد بمحاولته وحدها
 *   · المرجع المكتوب باليد بعد «تعذّر» توصيل ذاتي: لا يُتتبَّع علناً، ويصل المشتري «مرجع التوصيل»
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrackingCode } from './domain/carrier';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;
let token = '';
let vendorId = '';
let customerId = '';
let record: (trackingNumber: string, code: TrackingCode) => Promise<boolean>;

const SUFFIX = `reship${Date.now()}`;
const PASSWORD = 'كلمة-مرور-البائع-الطويلة';
const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
const statusOf = async (id: string) => (await prisma.subOrder.findUniqueOrThrow({ where: { id } })).status;

/** فرعي جاهز للشحن لهذا البائع — بلا دفع ولا قطع: الشحن والتسليم لا يمسّان الدفتر */
async function readySub(tag: string): Promise<string> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `RS-${SUFFIX}-${tag}`,
      idempotencyKey: randomUUID(),
      customerUserId: customerId,
      status: 'processing',
      currency: 'SAR',
      itemsSubtotalMinorUnits: 1000n,
      grandTotalMinorUnits: 1000n,
      shippingAddressSnapshot: { recipientName: 'مشترية الإعادة', city: 'الرياض' },
    },
  });
  const sub = await prisma.subOrder.create({
    data: {
      orderId: order.id,
      vendorId,
      subOrderNumber: `RS-${SUFFIX}-${tag}-1`,
      status: 'ready_to_ship',
      settlementCurrency: 'SAR',
      fxRateSnapshot: 1,
      itemsSubtotalMinorUnits: 1000n,
      totalMinorUnits: 1000n,
      chargeTotalMinorUnits: 1000n,
      commissionRateBpsSnapshot: 1000,
      commissionMinorUnits: 100n,
      vendorNetMinorUnits: 900n,
    },
  });
  return sub.id;
}

/** بوليصة من الشركة ثم «تأكيد الشحن» برقمها */
async function shipWithWaybill(subId: string): Promise<string> {
  const wb = await call('POST', `/vendor/shipping/waybill/${subId}`);
  expect(wb.statusCode, wb.body).toBe(201);
  const shipped = await call('POST', `/vendor/orders/${subId}/transition`, { to: 'shipped', tracking: wb.json().trackingNumber, carrierCode: wb.json().carrierCode });
  expect(shipped.statusCode, shipped.body).toBe(200);
  return wb.json().trackingNumber as string;
}

/** الشركة تستلم الطرد وتخرج به ثم يتعذّر التوصيل */
async function fail(trackingNumber: string) {
  for (const code of ['picked_up', 'in_transit', 'out_for_delivery', 'failed'] as const) expect(await record(trackingNumber, code)).toBe(true);
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
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
  record = (trackingNumber, code) => tracking.record(trackingNumber, code);

  const email = `seller.${SUFFIX}@basta.test`;
  const owner = await prisma.user.create({
    data: { email, fullName: 'بائع يعيد الشحن', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ role: 'vendor_owner' }] } },
  });
  vendorId = (
    await prisma.vendor.create({
      data: { ownerUserId: owner.id, slug: `v-${SUFFIX}`, nameAr: 'متجر يعيد الشحن', status: 'approved', approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA' },
    })
  ).id;
  customerId = (await prisma.user.create({ data: { email: `buyer.${SUFFIX}@basta.test`, fullName: 'مشترية الإعادة', passwordHash: 'x' } })).id;
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
  token = login.json().tokens.accessToken as string;
}, 90_000);

afterAll(async () => {
  if (dbUp) {
    // طلبات مصنوعة بلا دفع ولا دفتر: تبقى فتظهر في مراقبات الانحراف لكل الاختبارات الأخرى
    const orders = await prisma.order.findMany({ where: { customerUserId: customerId }, select: { id: true } });
    await prisma.subOrder.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
    await prisma.notification.deleteMany({ where: { userId: customerId } });
    await prisma.user.delete({ where: { id: customerId } });
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('إعادة الشحن بعد «تعذّر التوصيل» (VOPS-035)', () => {
  it('بوليصة جديدة بعد «تعذّر» تُشحن وتمضي حتى التسليم، والتتبّع العام بمحاولتها وحدها', async () => {
    if (!dbUp) return;
    const sub = await readySub('a');
    const first = await shipWithWaybill(sub);
    await fail(first);
    expect(await statusOf(sub)).toBe('delivery_failed');

    // البوليصة على «تعذّر التوصيل» — كان 409
    const second = await shipWithWaybill(sub);
    expect(second).not.toBe(first);
    expect(await statusOf(sub)).toBe('shipped');

    // الرقم الجديد بلا أحداث المحاولة الفاشلة — كان يُظهر «تعذّر التوصيل» أعلاه
    const fresh = await call('GET', `/track/${second}`);
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json().events).toEqual([]);

    // الشركة تمضي بالطرد من أوله — كانت «استلمت الشركة» الأولى تمنع الثانية فلا يتقدّم أبداً
    for (const code of ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'] as const) expect(await record(second, code)).toBe(true);
    expect(await statusOf(sub)).toBe('delivered');
    const done = await call('GET', `/track/${second}`);
    expect(done.json().events.map((e: { code: string }) => e.code)).toEqual(['delivered', 'out_for_delivery', 'in_transit', 'picked_up']);

    // المحاولة الأولى تبقى تاريخاً على الشحنة
    const events = await prisma.shipmentEvent.count({ where: { shipment: { subOrderId: sub } } });
    expect(events).toBe(8);
  });

  it('مرجع يكتبه البائع بيده بعد «تعذّر» توصيل ذاتي: لا يُتتبَّع علناً، ويصل المشتري «مرجع التوصيل»', async () => {
    if (!dbUp) return;
    const sub = await readySub('b');
    await fail(await shipWithWaybill(sub));

    const ref = `MANDOOB-${SUFFIX}`;
    const again = await call('POST', `/vendor/orders/${sub}/transition`, { to: 'shipped', tracking: ref, carrierCode: 'self' });
    expect(again.statusCode, again.body).toBe(200);

    // كان يبقى «بسطة إكسبرس» برقم لم تُصدره
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { subOrderId: sub } });
    expect(shipment).toMatchObject({ carrierCode: 'self', trackingNumber: ref });
    expect((await call('GET', `/track/${ref}`)).statusCode).toBe(404);

    const notice = await prisma.notification.findFirstOrThrow({
      where: { userId: customerId, templateCode: 'order_shipped', channel: 'in_app', payloadJson: { path: ['tracking_number'], equals: ref } },
    });
    expect(notice.payloadJson).toMatchObject({ tracking_label: 'مرجع التوصيل' });
  });
});
