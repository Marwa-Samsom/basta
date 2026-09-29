/**
 * بوابة المرحلة 09 — البنود الأربعة، عبر الواجهة البرمجية الحيّة.
 *
 *   1. انتقال غير مسموح (سُلّم ← قيد التجهيز) يُرفض على الخادم
 *   2. إرجاع جزئي يردّ المبلغ الصحيح ويعيد الكمية الصحيحة للمخزون
 *   3. إلغاء فرعي واحد لا يمسّ إخوته
 *   4. كل تغيير حالة له سطر تدقيق بالفاعل والوقت
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { LedgerService } from '../finance/public';
import { NotificationsService } from '../notifications/public';
import { FakePaymentProvider } from '../payments/public';
import { TrackingService } from '../shipping/public';
import { toCharge } from './domain/refunds';
import { OrderLifecycleService, OrderScheduler } from './public';
import { REFUND_STALE_MS, stalledRefund } from './application/order-lifecycle.service';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let fake: FakePaymentProvider;
let scheduler: OrderScheduler;
let tracking: TrackingService;
let lifecycle: OrderLifecycleService;
let dbUp = false;

const SUFFIX = `or${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';

interface Seat {
  userId: string;
  token: string;
}
const vendors: (Seat & { vendorId: string; variantId: string })[] = [];
let buyer: Seat;
let stranger: Seat;
let admin: Seat;

const ADDRESS = {
  recipientName: 'مشترٍ تجريبي',
  phone: '+962790000000',
  country: 'JO',
  region: 'العاصمة',
  city: 'عمّان',
  street: 'شارع الجامعة 12',
};

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;

async function call(method: 'GET' | 'POST', url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();
const adminTotpSecret = generateSecret();

async function login(email: string, totp?: string): Promise<string> {
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD, ...(totp ? { totp } : {}) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tokens.accessToken as string;
}

async function user(tag: string, role: 'customer' | 'vendor_owner' | 'admin', permissions: string[] = []) {
  const email = `${tag}.${SUFFIX}@basta.test`;
  const u = await prisma.user.create({
    data: {
      email,
      fullName: `مستخدم ${tag}`,
      passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role } },
      ...(permissions.length ? { permissions: { create: permissions.map((permission) => ({ permission })) } } : {}),
      // الإدارة بتحقّق ثنائي إلزامي — بدونه رمزها محدود ويُرفض كل إجراء
      ...(role === 'admin' ? { totpSecretEnc: adminTotpSecret, totpEnabledAt: new Date() } : {}),
    },
  });
  return { id: u.id, email };
}

/** طلب مدفوع بسطر من كل بائع — يعيد الطلب بفرعيّاته */
async function placeOrder(qty: [number, number]) {
  const cart = await call('POST', '/cart', undefined, { currency: 'JOD' });
  const token = cart.json().token as string;
  for (const [i, v] of vendors.entries()) {
    const r = await call('POST', '/cart/items', undefined, { variantId: v.variantId, qty: qty[i] }, { 'x-cart-token': token });
    expect(r.statusCode, r.body).toBe(201);
  }
  // الإجمالي كما يراه المشتري تحت «ادفع» — يُرسل مع الطلب ولا يُخصم غيره
  const shown = (await call('POST', '/checkout/quote', undefined, { country: ADDRESS.country, region: ADDRESS.region, city: ADDRESS.city }, { 'x-cart-token': token })).json();
  const res = await call('POST', '/checkout', buyer.token, { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: shown.totals.total.minorUnits, expectedCurrency: shown.currency }, {
    'x-cart-token': token,
    'idempotency-key': randomUUID(),
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().outcome).toBe('paid');
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: res.json().orderId },
    include: { subOrders: { include: { items: true } }, payment: true },
  });
  const byVendor = (i: number) => order.subOrders.find((s) => s.vendorId === vendors[i]!.vendorId)!;
  return { order, a: byVendor(0), b: byVendor(1) };
}

async function vendorMove(i: number, subOrderId: string, to: string, extra: Record<string, unknown> = {}) {
  return call('POST', `/vendor/orders/${subOrderId}/transition`, vendors[i]!.token, { to, ...extra });
}

/** يسير بالفرعي من «بانتظار البائع» حتى «سُلّم» بفاعليه الصحيحين */
async function deliver(i: number, subOrderId: string) {
  for (const to of ['accepted', 'preparing', 'ready_to_ship']) {
    const r = await vendorMove(i, subOrderId, to);
    expect(r.statusCode, r.body).toBe(200);
  }
  const wb = await call('POST', `/vendor/shipping/waybill/${subOrderId}`, vendors[i]!.token);
  expect(wb.statusCode, wb.body).toBe(201);
  const shipped = await vendorMove(i, subOrderId, 'shipped', {
    tracking: wb.json().trackingNumber,
    carrierCode: wb.json().carrierCode,
  });
  expect(shipped.statusCode, shipped.body).toBe(200);
  // شركة الشحن تعلن التسليم عبر آلة الحالات بفاعل carrier
  for (const code of ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'] as const) {
    await tracking.record(wb.json().trackingNumber, code);
  }
  return wb.json().trackingNumber as string;
}

const stock = async (variantId: string) =>
  (await prisma.inventory.findUniqueOrThrow({ where: { variantId }, select: { onHand: true } })).onHand;

const statusOf = async (id: string) =>
  (await prisma.subOrder.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات الطلبات الحيّة متخطّاة.\n');
    return;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  fake = app.get(FakePaymentProvider);
  scheduler = app.get(OrderScheduler);
  tracking = app.get(TrackingService);
  lifecycle = app.get(OrderLifecycleService);

  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'home' } });

  // بائعان بعملتين: الريال (تحويل) والدينار (عملة الدفع نفسها)
  for (const [tag, currency, price] of [
    ['sar', 'SAR', 19_900n],
    ['jod', 'JOD', 12_500n],
  ] as const) {
    const u = await user(`v${tag}`, 'vendor_owner');
    const vendor = await prisma.vendor.create({
      data: {
        ownerUserId: u.id,
        slug: `v-${tag}-${SUFFIX}`,
        nameAr: `متجر ${tag}`,
        status: 'approved',
        approvedAt: new Date(),
        settlementCurrency: currency,
        country: 'JO',
        shippingZones: {
          create: {
            nameAr: 'الأردن',
            regions: { create: { country: 'JO' } },
            rates: { create: { method: 'flat', priceMinorUnits: 1_000n, minDays: 1, maxDays: 3 } },
          },
        },
      },
    });
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, categoryId: category.id, slug: `p-${tag}-${SUFFIX}`, nameAr: `منتج ${tag}`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendor.id, sku: `SKU-${tag}-${SUFFIX}`.toUpperCase(), priceMinorUnits: price, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 50, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 50, reason: 'import' } });
    vendors.push({ userId: u.id, vendorId: vendor.id, variantId: variant.id, token: await login(u.email) });
  }

  const b = await user('buyer', 'customer');
  buyer = { userId: b.id, token: await login(b.email) };
  const s = await user('stranger', 'customer');
  stranger = { userId: s.id, token: await login(s.email) };
  const a = await user('admin', 'admin', ['orders.cancel', 'orders.manage', 'disputes.resolve']);
  admin = {
    userId: a.id,
    token: await login(a.email, generateSync({ strategy: 'totp', secret: adminTotpSecret, crypto: totpCrypto, base32: totpBase32 })),
  };
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('بوابة 09 · البند 1 — الانتقال غير المسموح يُرفض على الخادم', () => {
  it('سُلّم ← قيد التجهيز: 409، والحالة والتاريخ كما هما', async () => {
    if (!dbUp) return;
    const { a } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    expect(await statusOf(a.id)).toBe('delivered');
    const historyBefore = await prisma.subOrderStatusHistory.count({ where: { subOrderId: a.id } });

    const res = await vendorMove(0, a.id, 'preparing');
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/غير مسموح/);

    expect(await statusOf(a.id)).toBe('delivered');
    expect(await prisma.subOrderStatusHistory.count({ where: { subOrderId: a.id } })).toBe(historyBefore);
  });

  it('الفاعل الخطأ مرفوض: بائع يعلن الإكمال، ومشترٍ يلغي بعد بدء التجهيز', async () => {
    if (!dbUp) return;
    const { a, order } = await placeOrder([1, 1]);
    await vendorMove(0, a.id, 'accepted');
    await vendorMove(0, a.id, 'preparing');
    const cancel = await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/cancel`, buyer.token, {});
    expect(cancel.statusCode).toBe(409);
    const complete = await vendorMove(0, a.id, 'completed');
    expect(complete.statusCode).toBe(409);
    const noTracking = await vendorMove(0, a.id, 'ready_to_ship');
    expect(noTracking.statusCode).toBe(200);
    expect((await vendorMove(0, a.id, 'shipped')).statusCode).toBe(400);
  });

  it('طلب غيرك «غير موجود»: بائع آخر ومشترٍ آخر يسمعان 404', async () => {
    if (!dbUp) return;
    const { a, order } = await placeOrder([1, 1]);
    expect((await vendorMove(1, a.id, 'accepted')).statusCode).toBe(404);
    expect((await call('GET', `/vendor/orders/${a.id}`, vendors[1]!.token)).statusCode).toBe(404);
    expect((await call('GET', `/me/orders/${order.orderNumber}`, stranger.token)).statusCode).toBe(404);
    expect((await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/cancel`, stranger.token, {})).statusCode).toBe(404);
    expect(await statusOf(a.id)).toBe('awaiting_vendor');
  });

  it('قبولان متزامنان للطلب نفسه: واحد يمرّ، والآخر يُرفض، وسطر تاريخ واحد', async () => {
    if (!dbUp) return;
    const { a } = await placeOrder([1, 1]);
    const results = await Promise.all([vendorMove(0, a.id, 'accepted'), vendorMove(0, a.id, 'accepted')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    // وعلى مستوى الخدمة بلا طبقة HTTP: خمسة إلغاءات متزامنة تتسابق على السطر نفسه
    const { b } = await placeOrder([1, 1]);
    const stockB = await stock(vendors[1]!.variantId);
    const raced = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        lifecycle.transition(b.id, 'canceled_by_customer', { kind: 'customer', userId: buyer.userId }),
      ),
    );
    expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // إلغاء واحد = قطعة واحدة تعود واسترداد واحد، لا خمسة
    expect(await stock(vendors[1]!.variantId)).toBe(stockB + 1);
    expect(await prisma.refund.count({ where: { subOrderId: b.id } })).toBe(1);
    expect(await prisma.subOrderStatusHistory.count({ where: { subOrderId: a.id, toStatus: 'accepted' } })).toBe(1);
  });
});

describe('بوابة 09 · البند 2 — الإرجاع الجزئي', () => {
  it('قطعة من ثلاث: يُردّ نصيبها بسعر اللقطة، وتعود قطعة واحدة للمخزون', async () => {
    if (!dbUp) return;
    const { a, order } = await placeOrder([3, 1]);
    await deliver(0, a.id);
    const line = a.items[0]!;
    const stockBefore = await stock(vendors[0]!.variantId);

    const req = await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/return`, buyer.token, {
      items: [{ orderItemId: line.id, qty: 1 }],
      reasonCode: 'damaged',
      description: 'وصلت قطعة مكسورة',
    });
    expect(req.statusCode, req.body).toBe(201);
    expect(await statusOf(a.id)).toBe('return_requested');

    // إرجاع أكثر مما بقي يُرفض قبل أي أثر
    const received = await vendorMove(0, a.id, 'returned', { returnRequestId: req.json().returnRequestId });
    expect(received.statusCode, received.body).toBe(200);

    // المخزون: قطعة واحدة بالضبط، بحركة «return» موثّقة
    expect(await stock(vendors[0]!.variantId)).toBe(stockBefore + 1);
    const movement = await prisma.inventoryMovement.findFirst({
      where: { variantId: vendors[0]!.variantId, reason: 'return', refId: a.id },
    });
    expect(movement?.delta).toBe(1);

    // المبلغ: ثلث السطر بعملة البائع، محوَّلاً لعملة الدفع بسعر اللقطة لا سعر اليوم
    const expected = toCharge(line.lineTotalMinorUnits / 3n, a.fxRateSnapshot.toString());
    const refunds = await prisma.refund.findMany({ where: { subOrderId: a.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.amountMinorUnits).toBe(expected);
    expect(refunds[0]!.status).toBe('succeeded');
    expect(expected).toBeGreaterThan(0n);
    expect(expected).toBeLessThan(a.chargeTotalMinorUnits!);
    // والبوابة استلمت المبلغ نفسه
    expect(fake.refundsOf(order.payment!.providerIntentId!)).toContain(expected);

    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(item.refundedQty).toBe(1);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe('partially_refunded');
    expect(await statusOf(a.id)).toBe('refunded');
  });

  it('لا إرجاع لأكثر مما اشتُري، ولا قبل التسليم', async () => {
    if (!dbUp) return;
    const { a, order } = await placeOrder([2, 1]);
    const early = await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/return`, buyer.token, {
      items: [{ orderItemId: a.items[0]!.id, qty: 1 }],
      reasonCode: 'damaged',
    });
    expect(early.statusCode).toBe(409);
    await deliver(0, a.id);
    const tooMany = await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/return`, buyer.token, {
      items: [{ orderItemId: a.items[0]!.id, qty: 3 }],
      reasonCode: 'damaged',
    });
    expect(tooMany.statusCode).toBe(400);
    expect(await statusOf(a.id)).toBe('delivered');
  });
});

describe('بوابة 09 · البند 3 — إلغاء فرعي لا يمسّ إخوته', () => {
  it('المشتري يلغي متجراً: يُردّ حصّته كاملة ويعود مخزونه، والآخر كما هو', async () => {
    if (!dbUp) return;
    const { a, b, order } = await placeOrder([2, 2]);
    await vendorMove(0, a.id, 'accepted');
    const aBefore = await prisma.subOrder.findUniqueOrThrow({ where: { id: a.id }, include: { statusHistory: true } });
    const stockA = await stock(vendors[0]!.variantId);
    const stockB = await stock(vendors[1]!.variantId);

    const res = await call('POST', `/me/orders/${order.orderNumber}/stores/${b.id}/cancel`, buyer.token, { reason: 'غيّرت رأيي' });
    expect(res.statusCode, res.body).toBe(200);

    // الفرعي الملغى: قطعتاه عادتا، وحصّته بعملة الدفع رُدّت بالقرش
    expect(await statusOf(b.id)).toBe('refunded');
    expect(await stock(vendors[1]!.variantId)).toBe(stockB + 2);
    const refunds = await prisma.refund.findMany({ where: { subOrderId: b.id } });
    expect(refunds.map((r) => r.amountMinorUnits)).toEqual([b.chargeTotalMinorUnits]);

    // أخوه: الحالة والتاريخ والمخزون والمبالغ كما كانت
    const aAfter = await prisma.subOrder.findUniqueOrThrow({ where: { id: a.id }, include: { statusHistory: true } });
    expect(aAfter.status).toBe('accepted');
    expect(aAfter.statusHistory).toHaveLength(aBefore.statusHistory.length);
    expect(aAfter.totalMinorUnits).toBe(aBefore.totalMinorUnits);
    expect(await stock(vendors[0]!.variantId)).toBe(stockA);
    expect(await prisma.refund.count({ where: { subOrderId: a.id } })).toBe(0);

    // الأب مشتقّ: لم يُلغَ وأخوه قائم
    const parent = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payment: true } });
    expect(parent.status).toBe('partially_completed');
    expect(parent.payment!.status).toBe('partially_refunded');

    // والأخ يكمل مساره بعدها بلا عائق
    expect((await vendorMove(0, a.id, 'preparing')).statusCode).toBe(200);
  });

  it('تفاصيل الطلب في الإدارة بصلاحية orders.manage — لا بالدور وحده', async () => {
    if (!dbUp) return;
    const { order } = await placeOrder([1, 1]);
    const c = await user('content-admin', 'admin', ['content.manage']);
    const content = await login(c.email, generateSync({ strategy: 'totp', secret: adminTotpSecret, crypto: totpCrypto, base32: totpBase32 }));

    const denied = await call('GET', `/admin/orders/${order.orderNumber}`, content);
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain(ADDRESS.street);
    expect(denied.body).not.toContain(ADDRESS.phone);
    expect((await call('GET', `/admin/orders/${order.orderNumber}`, stranger.token)).statusCode).toBe(403);

    const ok = await call('GET', `/admin/orders/${order.orderNumber}`, admin.token);
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('الإدارة تلغي بصلاحية orders.cancel وحدها، وبسبب مكتوب', async () => {
    if (!dbUp) return;
    const { a, b } = await placeOrder([1, 1]);
    expect((await call('POST', `/admin/orders/stores/${a.id}/cancel`, stranger.token, { reason: 'احتيال مشتبه' })).statusCode).toBe(403);
    expect((await call('POST', `/admin/orders/stores/${a.id}/cancel`, admin.token, {})).statusCode).toBe(400);
    const ok = await call('POST', `/admin/orders/stores/${a.id}/cancel`, admin.token, { reason: 'احتيال مشتبه' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await statusOf(a.id)).toBe('refunded');
    expect(await statusOf(b.id)).toBe('awaiting_vendor');
  });

  it('المهمة الآلية تلغي ما لم يقبله البائع خلال 48 ساعة — وتترك المقبول', async () => {
    if (!dbUp) return;
    const { a, b } = await placeOrder([1, 1]);
    await vendorMove(1, b.id, 'accepted');
    // يُعمَّر طلب هذا الاختبار وحده (49 ساعة) بدل تقديم الساعة للجميع: المهمة بساعة
    // مقدَّمة كانت تلغي طلبات ملفات الاختبار الأخرى الجارية معاً في القاعدة نفسها.
    // وقاعدة التطوير تحمل طلبات قديمة من تشغيلات سابقة: المهمة تعالج الأقدم أولاً
    // مئةً مئة، فتُدار حتى يصل دور طلب هذا الاختبار — كما تفعل دوراتها المتتالية
    await prisma.subOrder.update({ where: { id: a.id }, data: { placedAt: new Date(Date.now() - 49 * 3_600_000) } });
    for (let i = 0; i < 50 && (await statusOf(a.id)) !== 'refunded'; i++) {
      if ((await scheduler.cancelUnaccepted(new Date())) === 0) break;
    }
    expect(await statusOf(a.id)).toBe('refunded');
    expect(await statusOf(b.id)).toBe('accepted');
  }, 120_000);
});

describe('بوابة 09 · البند 4 — كل تغيير حالة في سجل التدقيق', () => {
  it('سطر تدقيق لكل سطر تاريخ، بالفاعل والوقت', async () => {
    if (!dbUp) return;
    const { a, b, order } = await placeOrder([2, 1]);
    await deliver(0, a.id);
    await call('POST', `/me/orders/${order.orderNumber}/stores/${b.id}/cancel`, buyer.token, {});

    for (const sub of [a, b]) {
      // سطر التاريخ الأول (الإنشاء) كتبه الدفع لا آلة الحالات
      const history = await prisma.subOrderStatusHistory.findMany({
        where: { subOrderId: sub.id, fromStatus: { not: null } },
        orderBy: { createdAt: 'asc' },
      });
      const audit = await prisma.auditLog.findMany({
        where: { entityType: 'SubOrder', entityId: sub.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.length).toBeGreaterThan(0);
      expect(audit).toHaveLength(history.length);
      audit.forEach((row, i) => {
        expect(row.action).toBe(`sub_order.${history[i]!.toStatus}`);
        expect(row.createdAt).toBeInstanceOf(Date);
        const after = row.afterJson as { actor: string };
        expect(['vendor', 'customer', 'admin', 'carrier', 'system']).toContain(after.actor);
        // الفاعل البشري باسمه؛ الآلي بلا مستخدم لكن بنوعه
        if (after.actor === 'vendor') expect(row.actorUserId).toBe(vendors[0]!.userId);
        if (after.actor === 'customer') expect(row.actorUserId).toBe(buyer.userId);
      });
    }

    const actors = (await prisma.auditLog.findMany({ where: { entityId: a.id } })).map((r) => (r.afterJson as { actor: string }).actor);
    expect(actors).toContain('vendor');
    expect(actors).toContain('carrier');
  });

  it('فشل سطر التدقيق يُسقط الانتقال كله — لا تغيير صامت', async () => {
    if (!dbUp) return;
    const { a } = await placeOrder([1, 1]);
    // فاعل بمعرّف مستخدم غير موجود: مفتاح التدقيق الأجنبي يرفضه
    await expect(
      lifecycle.transition(a.id, 'accepted', { kind: 'vendor', userId: randomUUID(), vendorId: vendors[0]!.vendorId }),
    ).rejects.toThrow();
    expect(await statusOf(a.id)).toBe('awaiting_vendor');
    expect(await prisma.subOrderStatusHistory.count({ where: { subOrderId: a.id, toStatus: 'accepted' } })).toBe(0);
  });
});

describe('ما بعد البيع — التتبّع والنزاع والمراجعة الموثّقة', () => {
  it('التتبّع العام يعرض الأحداث بلا اسم ولا عنوان', async () => {
    if (!dbUp) return;
    const { a } = await placeOrder([1, 1]);
    const trk = await deliver(0, a.id);
    const res = await call('GET', `/track/${trk}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().events.map((e: { code: string }) => e.code)).toEqual(['delivered', 'out_for_delivery', 'in_transit', 'picked_up']);
    expect(res.body).not.toContain(ADDRESS.street);
    // حدث متأخر لا يعيد المسار للخلف
    expect(await tracking.record(trk, 'in_transit')).toBe(false);
  });

  it('رقم التتبّع لشحنته وحدها: لا يُنسخ لشركة الشحن، والتوصيل الذاتي لا يُظهر شحنة غيره', async () => {
    if (!dbUp) return;
    const { a, b } = await placeOrder([1, 1]);
    const trk = await deliver(0, a.id);
    for (const to of ['accepted', 'preparing', 'ready_to_ship']) expect((await vendorMove(1, b.id, to)).statusCode).toBe(200);

    // بائع آخر يكتب رقم شحنة غيره لشركة الشحن نفسها: فريد لكل شركة — 409 ولا يُشحن
    const hijack = await vendorMove(1, b.id, 'shipped', { tracking: trk, carrierCode: 'basta-express' });
    expect(hijack.statusCode, hijack.body).toBe(409);
    expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('ready_to_ship');

    // وللتوصيل الذاتي مرجعه يكتبه كما يشاء — ولو طابق رقماً لشركة
    expect((await vendorMove(1, b.id, 'shipped', { tracking: trk })).statusCode).toBe(200);

    // التتبّع العام يعرض شحنة الشركة لا الذاتية
    const res = await call('GET', `/track/${trk}`);
    expect(res.json().carrierCode).toBe('basta-express');
    expect(res.json().events).toHaveLength(4);

    // مرجع توصيل ذاتي ليس رقماً لشركة: لا يُتتبَّع علناً، وحدث «سُلّم» باسم الشركة لا يصيبه
    const { b: c } = await placeOrder([1, 1]);
    for (const to of ['accepted', 'preparing', 'ready_to_ship']) expect((await vendorMove(1, c.id, to)).statusCode).toBe(200);
    const ref = `SELF-${randomUUID().slice(0, 8)}`;
    expect((await vendorMove(1, c.id, 'shipped', { tracking: ref })).statusCode).toBe(200);
    expect((await call('GET', `/track/${ref}`)).statusCode).toBe(404);
    await expect(tracking.record(ref, 'delivered')).rejects.toThrow(/رقم تتبّع غير معروف/);
    expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('shipped');
  });

  it('نزاع مفتوح يجمّد الإكمال، والتصعيد يصل الإدارة، والحسم يفكّه', async () => {
    if (!dbUp) return;
    const { a, b } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    await deliver(1, b.id);

    const opened = await call('POST', '/me/disputes', buyer.token, { subOrderId: a.id, reasonCode: 'not_as_described', message: 'اللون مختلف عن الصورة تماماً' });
    expect(opened.statusCode, opened.body).toBe(201);
    const id = opened.json().id as string;
    expect((await call('POST', '/me/disputes', buyer.token, { subOrderId: a.id, reasonCode: 'other', message: 'نزاع ثانٍ على الطلب نفسه' })).statusCode).toBe(409);

    expect((await call('POST', `/vendor/disputes/${id}/messages`, vendors[0]!.token, { body: 'نعتذر، نرسل البديل' })).statusCode).toBe(204);
    expect((await call('GET', `/vendor/disputes/${id}`, vendors[1]!.token)).statusCode).toBe(404);
    expect((await call('POST', `/me/disputes/${id}/escalate`, buyer.token)).statusCode).toBe(204);

    const later = new Date(Date.now() + 15 * 86_400_000);
    await scheduler.completeDelivered(later);
    expect(await statusOf(a.id)).toBe('delivered');
    expect(await statusOf(b.id)).toBe('completed');

    const queue = await call('GET', '/admin/disputes', admin.token);
    expect(queue.json().map((d: { id: string }) => d.id)).toContain(id);
    expect((await call('POST', `/admin/disputes/${id}/resolve`, admin.token, { outcome: 'vendor', resolution: 'أُرسل البديل وقبله المشتري' })).statusCode).toBe(204);
    await scheduler.completeDelivered(later);
    expect(await statusOf(a.id)).toBe('completed');
  });

  it('المراجعة لصاحب الشراء بعد التسليم وحده، ومرة واحدة', async () => {
    if (!dbUp) return;
    const { a } = await placeOrder([1, 1]);
    const item = a.items[0]!;
    const early = await call('POST', '/me/reviews', buyer.token, { orderItemId: item.id, rating: 5 });
    expect(early.statusCode).toBe(409);
    await deliver(0, a.id);
    expect((await call('POST', '/me/reviews', stranger.token, { orderItemId: item.id, rating: 1 })).statusCode).toBe(404);
    const ok = await call('POST', '/me/reviews', buyer.token, { orderItemId: item.id, rating: 4, body: 'جيد جداً' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await call('POST', '/me/reviews', buyer.token, { orderItemId: item.id, rating: 5 })).statusCode).toBe(409);

    const list = await call('GET', `/products/${item.productId}/reviews`);
    expect(list.json().count).toBeGreaterThanOrEqual(1);
    expect(list.json().items[0].verified).toBe(true);
  });
});

describe('الاسترداد يُعاد بلا دفع مرتين', () => {
  it('نجحت البوابة ثم سقطت معاملتنا: الإعادة تكمل التسجيل ولا تردّ المال ثانيةً', async () => {
    if (!dbUp) return;
    const { a, order } = await placeOrder([1, 1]);
    const notifications = app.get(NotificationsService);
    const original = notifications.enqueue.bind(notifications);
    let broken = true;
    // سقوط بعد البوابة وقبل الالتزام — إشعار «رُدّ مالك» داخل معاملة التسجيل
    notifications.enqueue = (async (input, db) => {
      if (broken && input.code === 'refund_issued') {
        broken = false;
        throw new Error('انقطع الاتصال بالقاعدة');
      }
      return original(input, db);
    }) as typeof notifications.enqueue;
    try {
      const cancel = await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/cancel`, buyer.token, {});
      expect(cancel.statusCode, cancel.body).toBe(200);
    } finally {
      notifications.enqueue = original;
    }

    const refund = await prisma.refund.findFirstOrThrow({ where: { subOrderId: a.id } });
    // عاد معلّقاً لتعيده المهمة — لكن أثر المال الخارج مسجَّل
    expect(refund.status).toBe('pending');
    expect(refund.providerRefundId).toBeTruthy();
    const intent = order.payment!.providerIntentId!;
    expect(fake.refundsOf(intent)).toEqual([refund.amountMinorUnits]);

    expect(await lifecycle.executeRefund(refund.id)).toBe(true);
    const done = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(done.status).toBe('succeeded');
    expect(done.providerRefundId).toBe(refund.providerRefundId);
    // البوابة ردّت مرة واحدة — الإعادة سمعت الردّ الأول بالمفتاح نفسه
    expect(fake.refundsOf(intent)).toEqual([refund.amountMinorUnits]);
    expect(await statusOf(a.id)).toBe('refunded');
  });
});

describe('استرداد عالق في processing — سقط منفّذه فيُعاد', () => {
  /** إلغاء يسجّل استرداداً بلا تنفيذه، ثم يُترك كما يتركه خادم سقط بعد حجزه */
  async function stuckRefund(claimedMsAgo: number) {
    const { a, order } = await placeOrder([1, 1]);
    const original = lifecycle.executeRefund.bind(lifecycle);
    lifecycle.executeRefund = async () => false;
    try {
      expect((await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/cancel`, buyer.token, {})).statusCode).toBe(200);
    } finally {
      lifecycle.executeRefund = original;
    }
    const refund = await prisma.refund.findFirstOrThrow({ where: { subOrderId: a.id } });
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: 'processing', claimedAt: new Date(Date.now() - claimedMsAgo) },
    });
    return { a, refund, intent: order.payment!.providerIntentId! };
  }
  const isDue = async (id: string, now = new Date()) =>
    (await prisma.refund.count({ where: { id, ...stalledRefund(now) } })) === 1;

  it('سقط قبل البوابة: بعد المهلة تلتقطه المهمة وتردّ المال مرة', async () => {
    if (!dbUp) return;
    const { a, refund, intent } = await stuckRefund(REFUND_STALE_MS + 60_000);
    expect(await isDue(refund.id)).toBe(true);
    expect(await lifecycle.executeRefund(refund.id)).toBe(true);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('succeeded');
    expect(fake.refundsOf(intent)).toEqual([refund.amountMinorUnits]);
    expect(await statusOf(a.id)).toBe('refunded');
  });

  it('سقط بعد البوابة وقبل التسجيل: الإعادة تسمع الردّ الأول ولا تردّ ثانيةً', async () => {
    if (!dbUp) return;
    const { refund, intent } = await stuckRefund(REFUND_STALE_MS + 60_000);
    // ما فعله المنفّذ الساقط قبل سقوطه: البوابة ردّت بمفتاح الاسترداد
    const first = await fake.refund(intent, refund.amountMinorUnits, `refund:${refund.id}`);
    expect(await lifecycle.executeRefund(refund.id)).toBe(true);
    const done = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(done.status).toBe('succeeded');
    expect(done.providerRefundId).toBe(first.refundId);
    expect(fake.refundsOf(intent)).toEqual([refund.amountMinorUnits]);
  });

  it('تنفيذ حيّ قبل انقضاء المهلة لا يُنتزع', async () => {
    if (!dbUp) return;
    const { refund, intent } = await stuckRefund(30_000);
    expect(await isDue(refund.id)).toBe(false);
    expect(await lifecycle.executeRefund(refund.id)).toBe(false);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('processing');
    expect(fake.refundsOf(intent)).toEqual([]);
  });

  it('مُعيدان معاً على العالق نفسه: ردّ واحد وإشعار واحد', async () => {
    if (!dbUp) return;
    const { refund, intent } = await stuckRefund(REFUND_STALE_MS + 60_000);
    const results = await Promise.all([lifecycle.executeRefund(refund.id), lifecycle.executeRefund(refund.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fake.refundsOf(intent)).toEqual([refund.amountMinorUnits]);
    const order = await prisma.subOrder.findUniqueOrThrow({ where: { id: refund.subOrderId }, select: { order: { select: { customerUserId: true, orderNumber: true } } } });
    const notes = await prisma.notification.findMany({
      where: { userId: order.order.customerUserId!, templateCode: 'refund_issued', channel: 'in_app' },
      select: { payloadJson: true },
    });
    expect(notes.filter((n) => (n.payloadJson as Record<string, string>)['order_number'] === order.order.orderNumber)).toHaveLength(1);
  });
});

describe('حسم النزاع لصالح المشتري يردّ ماله — ولا يُحرَّر للبائع', () => {
  const pendingNet = async (subId: string) =>
    (await prisma.ledgerEntry.findMany({ where: { refType: 'sub_order', refId: subId, bucket: 'pending' } })).reduce(
      (a, r) => a + (r.direction === 'credit' ? r.amountMinorUnits : -r.amountMinorUnits),
      0n,
    );
  async function disputed() {
    const { a, order } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    const opened = await call('POST', '/me/disputes', buyer.token, { subOrderId: a.id, reasonCode: 'not_as_described', message: 'وصلت القطعة مكسورة تماماً' });
    expect(opened.statusCode, opened.body).toBe(201);
    return { a, order, id: opened.json().id as string };
  }
  const resolveForCustomer = (id: string) =>
    call('POST', `/admin/disputes/${id}/resolve`, admin.token, { outcome: 'customer', resolution: 'القطعة مكسورة بالصور — يُردّ المبلغ كاملاً' });

  it('يُردّ ما دفعه المشتري للمتجر كله، ويصير الفرعي مسترَداً، ولا يبقى للبائع معلّق', async () => {
    if (!dbUp) return;
    const { a, order, id } = await disputed();
    expect(await pendingNet(a.id)).toBeGreaterThan(0n);

    const r = await resolveForCustomer(id);
    expect(r.statusCode, r.body).toBe(204);

    expect((await prisma.dispute.findUniqueOrThrow({ where: { id } })).status).toBe('resolved_customer');
    expect(await statusOf(a.id)).toBe('refunded');
    const refund = await prisma.refund.findFirstOrThrow({ where: { subOrderId: a.id } });
    expect(refund.status).toBe('succeeded');
    expect(refund.amountMinorUnits).toBe(a.chargeTotalMinorUnits);
    expect(fake.refundsOf(order.payment!.providerIntentId!)).toContain(a.chargeTotalMinorUnits);
    // مال البائع عن هذا الفرعي عُكس — لا شيء يحرّره الإغلاق
    expect(await pendingNet(a.id)).toBe(0n);
  });

  it('فشل تسجيل الاسترداد يُبقي النزاع مفتوحاً والمال مجمّداً', async () => {
    if (!dbUp) return;
    const { a, id } = await disputed();
    const ledger = app.get(LedgerService);
    const original = ledger.postFullRefund.bind(ledger);
    ledger.postFullRefund = async () => {
      throw new Error('انقطع الاتصال بالقاعدة');
    };
    try {
      expect((await resolveForCustomer(id)).statusCode).toBe(500);
    } finally {
      ledger.postFullRefund = original;
    }
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id } })).status).toBe('open');
    expect(await statusOf(a.id)).toBe('delivered');
    expect(await prisma.refund.count({ where: { subOrderId: a.id } })).toBe(0);

    // وتصحّ الإعادة بعدها
    expect((await resolveForCustomer(id)).statusCode).toBe(204);
    expect(await statusOf(a.id)).toBe('refunded');
  });

  it('مسار الانتقال العام لا يجعل الفرعي «مسترَداً» بلا ردّ — ولو بصلاحية orders.manage', async () => {
    if (!dbUp) return;
    const { a } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    const r = await call('POST', `/admin/orders/stores/${a.id}/transition`, admin.token, { to: 'refunded' });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(await statusOf(a.id)).toBe('delivered');
  });
});
