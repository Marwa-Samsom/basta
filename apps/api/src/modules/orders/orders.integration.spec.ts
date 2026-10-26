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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { AdminAlertsScheduler, ReportsService } from '../admin/public';
import { hashPassword } from '../identity/public';
import { LedgerService } from '../finance/public';
import { NotificationsService } from '../notifications/public';
import { FakePaymentProvider } from '../payments/public';
import { TrackingService } from '../shipping/public';
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

async function call(method: 'GET' | 'POST' | 'PUT', url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
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
async function placeOrder(qty: [number, number], coupon?: string) {
  const cart = await call('POST', '/cart', undefined, { currency: 'JOD' });
  const token = cart.json().token as string;
  for (const [i, v] of vendors.entries()) {
    const r = await call('POST', '/cart/items', undefined, { variantId: v.variantId, qty: qty[i] }, { 'x-cart-token': token });
    expect(r.statusCode, r.body).toBe(201);
  }
  if (coupon) {
    const r = await call('PUT', '/cart/coupon', undefined, { code: coupon }, { 'x-cart-token': token });
    expect(r.statusCode, r.body).toBe(200);
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
      data: { vendorId: vendor.id, slug: `p-${tag}-${SUFFIX}`, nameAr: `منتج ${tag}`, status: 'active', publishedAt: new Date() },
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

describe('تفاصيل طلب المشتري — أسطر القطع بعملة الدفع (18 أكتوبر 2026)', () => {
  it('أسطر القطع تجمع «قيمة المنتجات» بالضبط، ومع قطعة الريال سعرها بعملة المتجر', async () => {
    if (!dbUp) return;
    const { order } = await placeOrder([2, 1]);
    const res = await call('GET', `/me/orders/${order.orderNumber}`, buyer.token);
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json() as {
      currency: string;
      itemsSubtotalMinorUnits: string;
      stores: { currency: string; items: { qty: number; lineSubtotalMinorUnits: string; chargeSubtotalMinorUnits: string }[] }[];
    };
    expect(view.currency).toBe('JOD');
    const lines = view.stores.flatMap((s) => s.items);
    // كان السطر بعملة المتجر شاملاً الضريبة والملخّص بعملة الدفع بلاها، فلا يُقارَنان
    expect(String(lines.reduce((a, l) => a + BigInt(l.chargeSubtotalMinorUnits), 0n))).toBe(view.itemsSubtotalMinorUnits);

    const sar = view.stores.find((s) => s.currency === 'SAR')!.items[0]!;
    expect(sar.lineSubtotalMinorUnits).toBe('39800');
    expect(sar.chargeSubtotalMinorUnits).not.toBe('39800');
    const jod = view.stores.find((s) => s.currency === 'JOD')!.items[0]!;
    expect(jod.chargeSubtotalMinorUnits).toBe(jod.lineSubtotalMinorUnits);
    expect(jod.chargeSubtotalMinorUnits).toBe('12500');
  });
});

describe('تفصيل مبالغ البائع يجمع إلى صافيه (VOPS-012، 22 أكتوبر 2026)', () => {
  /** المنتجات − حصّته من الخصم − العمولة + الشحن = «صافي أرباحك» — كما تعرضها صفحته */
  async function breakdown(subOrderId: string) {
    const res = await call('GET', `/vendor/orders/${subOrderId}`, vendors[0]!.token);
    expect(res.statusCode, res.body).toBe(200);
    const f = res.json().financials as Record<string, string>;
    const sum =
      BigInt(f['itemsSubtotalMinorUnits']!) -
      BigInt(f['vendorDiscountMinorUnits']!) -
      BigInt(f['commissionMinorUnits']!) +
      BigInt(f['shippingMinorUnits']!);
    expect(sum).toBe(BigInt(f['netMinorUnits']!));
    return f;
  }

  it('كوبون المنصّة: خصمه كله على المنصّة، لا يُطرح من البائع والسطور تجمع إلى الصافي', async () => {
    if (!dbUp) return;
    const coupon = await prisma.coupon.create({
      data: { code: `PLT${SUFFIX}`.toUpperCase(), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform' },
    });
    const { a } = await placeOrder([2, 1], coupon.code);
    expect(a.discountMinorUnits).toBeGreaterThan(0n);
    const f = await breakdown(a.id);
    expect(f['vendorDiscountMinorUnits']).toBe('0');
    expect(f['platformDiscountMinorUnits']).toBe(a.discountMinorUnits.toString());
  });

  it('كوبون البائع: خصمه كله عليه، يُطرح من صافيه والسطور تجمع إليه', async () => {
    if (!dbUp) return;
    const coupon = await prisma.coupon.create({
      data: {
        code: `VND${SUFFIX}`.toUpperCase(),
        scope: 'vendor',
        vendorId: vendors[0]!.vendorId,
        type: 'percent',
        valueBps: 1000,
        fundedBy: 'vendor',
      },
    });
    const { a } = await placeOrder([2, 1], coupon.code);
    expect(a.discountMinorUnits).toBeGreaterThan(0n);
    const f = await breakdown(a.id);
    expect(f['vendorDiscountMinorUnits']).toBe(a.discountMinorUnits.toString());
    expect(f['platformDiscountMinorUnits']).toBe('0');
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

    // المبلغ: ثلث ما دفعه المشتري لقطع المتجر بعملة الدفع — مدفوع الفرعي في اللقطة ناقص
    // شحنه، لأسفل. لا تحويل نصيب البائع قطعةً قطعة: ذاك كان يقرّب لأقرب (J-05)
    type Snap = { subOrders: { vendorId: string; charge: { total: string; shipping: string } }[] };
    const paid = (order.pricingSnapshot as unknown as Snap).subOrders.find((x) => x.vendorId === vendors[0]!.vendorId)!.charge;
    const expected = (BigInt(paid.total) - BigInt(paid.shipping)) / 3n;
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
    // بقيت قطعتان عند المشتري: «تم التسليم» لا «مُسترَد» نهائياً (J-05، 19 أكتوبر 2026)
    expect(await statusOf(a.id)).toBe('delivered');

    // «على البائع» في المبالغ المعادة: ما قُيّد عليه فعلاً (الخصم ناقص عمولته المعكوسة)،
    // لا كل ما رُدّ للمشتري — ذاك يشمل ما ردّته المنصة من عمولتها وضريبتها (ADM-076)
    const tag = `استرداد ${refunds[0]!.id.slice(0, 8)}`;
    const vendorRows = await prisma.ledgerEntry.findMany({ where: { refType: 'sub_order', refId: a.id, memo: { contains: tag } } });
    const charged = vendorRows.reduce((s, e) => s + (e.direction === 'debit' ? e.amountMinorUnits : -e.amountMinorUnits), 0n);
    expect(vendorRows.some((e) => e.entryType === 'commission_debit' && e.direction === 'credit')).toBe(true);
    const list = await call('GET', `/admin/returns/refunds?search=${a.subOrderNumber}`, admin.token);
    expect(list.statusCode, list.body).toBe(200);
    const row = list.json().items.find((x: { id: string }) => x.id === refunds[0]!.id);
    expect(row.vendorChargeMinorUnits).toBe(charged.toString());
    expect(BigInt(row.vendorChargeMinorUnits)).toBeLessThan(BigInt(row.vendorAmountMinorUnits));
  });

  it('طلب إرجاع حُفظ بسطر مكرّر قبل التصليح: استلامه يُرفض ولا يُردّ نصيب أكثر من السطر (BUY-044)', async () => {
    if (!dbUp) return;
    const { a, order } = await placeOrder([3, 1]);
    await deliver(0, a.id);
    const line = a.items[0]!;
    const asked = await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/return`, buyer.token, {
      items: [{ orderItemId: line.id, qty: 1 }],
      reasonCode: 'damaged',
    });
    expect(asked.statusCode, asked.body).toBe(201);
    // كما حُفظ طلب صاحبة المشروع قبل التصليح: 2 + 2 من سطر فيه 3
    await prisma.returnRequest.update({
      where: { id: asked.json().returnRequestId },
      data: { itemsJson: [{ orderItemId: line.id, qty: 2 }, { orderItemId: line.id, qty: 2 }] },
    });

    const received = await vendorMove(0, a.id, 'returned');
    expect(received.statusCode).toBe(400);
    expect(received.json().message).toMatch(/لا يمكن إرجاع 4 من سطر بقي منه 3/);
    expect(await prisma.refund.count({ where: { subOrderId: a.id } })).toBe(0);
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ refundedQty: 0 });
    expect(await statusOf(a.id)).toBe('return_requested');
  });

  it('بعد إرجاع جزئي: يُرجَع الباقي في مهلته، و«مُسترَد» حين لا يبقى شيء — بلا إشعار تسليم ثانٍ', async () => {
    if (!dbUp) return;
    const { a, order } = await placeOrder([2, 1]);
    await deliver(0, a.id);
    const line = a.items[0]!;
    const returnOf = (qty: number) =>
      call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/return`, buyer.token, {
        items: [{ orderItemId: line.id, qty }],
        reasonCode: 'size_issue',
      });
    const deliveredNotices = () =>
      prisma.notification.count({
        where: { userId: buyer.userId, templateCode: 'order_status_changed', payloadJson: { path: ['order_number'], equals: order.orderNumber } },
      });

    const first = await returnOf(1);
    expect(first.statusCode, first.body).toBe(201);
    const notices = await deliveredNotices();
    expect((await vendorMove(0, a.id, 'returned')).statusCode).toBe(200);
    expect(await statusOf(a.id)).toBe('delivered');
    const back = await prisma.subOrderStatusHistory.findFirst({
      where: { subOrderId: a.id, fromStatus: 'returned', toStatus: 'delivered' },
    });
    expect(back?.actorRole).toBeNull();
    // ما وصله لم يتغيّر: لا «تم التسليم» ثانية في بريده
    expect(await deliveredNotices()).toBe(notices);

    // المتبقّي وحده يُرجَع — والزائد عليه يُرفض برقمه
    const tooMany = await returnOf(2);
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().message).toBe('الكمية المتاحة للإرجاع 1.');
    // ولو كُرّر السطر لتمرّ كل نسخة وحدها (BUY-044): المجموع 2 من قطعة باقية
    const duplicated = await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/return`, buyer.token, {
      items: [{ orderItemId: line.id, qty: 1 }, { orderItemId: line.id, qty: 1 }],
      reasonCode: 'size_issue',
    });
    expect(duplicated.statusCode).toBe(400);
    expect(duplicated.json().message).toBe('الكمية المتاحة للإرجاع 1.');
    expect(await statusOf(a.id)).toBe('delivered');
    const second = await returnOf(1);
    expect(second.statusCode, second.body).toBe(201);
    expect((await vendorMove(0, a.id, 'returned')).statusCode).toBe(200);

    // لا قطعة باقية: «مُسترَد»، واستردادان بمجموع السطر كله
    expect(await statusOf(a.id)).toBe('refunded');
    const refunds = await prisma.refund.findMany({ where: { subOrderId: a.id } });
    expect(refunds).toHaveLength(2);
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ refundedQty: 2 });
  });

  it('طلبا إرجاع متزامنان: واحد يُسجَّل بصفّ واحد، والآخر يُرفض بلا أثر', async () => {
    if (!dbUp) return;
    const { a, order } = await placeOrder([2, 1]);
    await deliver(0, a.id);
    const body = { items: [{ orderItemId: a.items[0]!.id, qty: 1 }], reasonCode: 'damaged' };
    const url = `/me/orders/${order.orderNumber}/stores/${a.id}/return`;
    const results = await Promise.all([call('POST', url, buyer.token, body), call('POST', url, buyer.token, body)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    // كان الخاسر يترك صفّاً «requested» يتيماً: مكرَّراً عند الإدارة ومانعاً تحرير الرصيد
    const rows = await prisma.returnRequest.findMany({ where: { subOrderId: a.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(results.find((r) => r.statusCode === 201)!.json().returnRequestId);

    // وطلب ثالث والأول قائم يسمع السبب الحقيقي، لا «بعد التسليم وحده»
    const third = await call('POST', url, buyer.token, body);
    expect(third.statusCode).toBe(409);
    expect(third.json().message).toMatch(/طلب إرجاع قائم/);
    expect(await prisma.returnRequest.count({ where: { subOrderId: a.id } })).toBe(1);

    // والقاعدة نفسها ترفض صفّاً قائماً ثانياً ولو كتبه غير هذا المسار
    await expect(
      prisma.returnRequest.create({ data: { subOrderId: a.id, itemsJson: body.items, reasonCode: 'damaged', mediaKeys: [] } }),
    ).rejects.toThrow(/return_requests_one_open_idx|Unique constraint/);
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
    // البائع يعرف أن المشتري ألغى، بالسبب الذي كتبه — فلا يجهّز طلباً مُلغى (J-03)
    const told = await prisma.notification.findMany({ where: { userId: vendors[1]!.userId, templateCode: 'vendor_order_canceled' } });
    expect(told.some((n) => JSON.stringify(n.payloadJson).includes(b.subOrderNumber) && JSON.stringify(n.payloadJson).includes('غيّرت رأيي'))).toBe(true);

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

    // J-03 (18 أكتوبر 2026): البائع يعرف بالإلغاء، ويراه «أُلغي آلياً» لا «ألغته الإدارة»،
    // والقطعة «أُلغي» لا «أُرجع»، وصافيه من دفتره صفر لا لقطة الطلب
    const told = await prisma.notification.findMany({ where: { userId: vendors[0]!.userId, templateCode: 'vendor_order_canceled' } });
    expect(told.some((n) => JSON.stringify(n.payloadJson).includes(a.subOrderNumber) && n.channel === 'in_app')).toBe(true);

    const seen = await call('GET', `/vendor/orders/${a.id}`, vendors[0]!.token);
    expect(seen.statusCode, seen.body).toBe(200);
    const v = seen.json() as {
      history: { toStatus: string; toLabel: string }[];
      items: { refundedQty: number; returnedQty: number }[];
      financials: { netMinorUnits: string; refundedMinorUnits: string; netAfterRefundsMinorUnits: string };
    };
    expect(v.history.find((h) => h.toStatus === 'canceled_by_admin')?.toLabel).toBe('أُلغي آلياً');
    expect(v.items[0]).toMatchObject({ refundedQty: 1, returnedQty: 0 });
    expect(v.financials.netAfterRefundsMinorUnits).toBe('0');
    expect(v.financials.refundedMinorUnits).toBe(v.financials.netMinorUnits);

    const row = (await call('GET', `/vendor/orders?search=${a.subOrderNumber}`, vendors[0]!.token)).json().items[0];
    expect(row.netMinorUnits).toBe('0');
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

    // إشعار الشحن يحمل رقم الشركة نفسه الذي يُبحث به هنا (BUY-086) — مرة واحدة
    const notices = await prisma.notification.findMany({
      where: { userId: buyer.userId, templateCode: 'order_shipped', channel: 'in_app', payloadJson: { path: ['tracking_number'], equals: trk } },
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]!.payloadJson).toMatchObject({ tracking_label: 'رقم التتبّع', store_name: expect.any(String) });
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

    // تسليم الاختبار يُرجَّع إلى ما قبل مدة التعليق، والمهمة بالوقت الحقيقي. كانت تُستدعى
    // «بعد 15 يوماً» فتُكمل كل طلب مُسلَّم في القاعدة — ومنها طلبات التجربة اليدوية الحيّة
    // على قاعدة التطوير، فيُغلق إرجاعها قبل مهلته (J-02، 18 أكتوبر 2026)
    // وموعده المحفوظ معه — الإكمال يقرؤه كما يقرؤه تحرير المال (ACFG-025)
    await prisma.subOrder.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { deliveredAt: new Date(Date.now() - 15 * 86_400_000), holdReleaseAt: new Date(Date.now() - 86_400_000) },
    });
    const now = new Date();
    await scheduler.completeDelivered(now);
    expect(await statusOf(a.id)).toBe('delivered');
    expect(await statusOf(b.id)).toBe('completed');

    // الطابور خمسين خمسين ببحث — النزاع يُوجد برقم طلب متجره بأي حالة أحرف، ولا يظهر بحالة غيره
    const { subOrderNumber } = await prisma.subOrder.findUniqueOrThrow({ where: { id: a.id }, select: { subOrderNumber: true } });
    const queue = await call('GET', `/admin/disputes?search=${subOrderNumber}`, admin.token);
    expect(queue.json()).toMatchObject({ total: 1 });
    expect(queue.json().items.map((d: { id: string }) => d.id)).toEqual([id]);
    const lower = (await call('GET', `/admin/disputes?search=${encodeURIComponent(subOrderNumber.toLowerCase())}`, admin.token)).json();
    expect(lower.items.map((d: { id: string }) => d.id)).toEqual([id]);
    expect((await call('GET', `/admin/disputes?status=open&search=${subOrderNumber}`, admin.token)).json()).toMatchObject({ items: [], total: 0 });
    expect((await call('GET', '/admin/disputes?search=لا-مطابق-هنا', admin.token)).json()).toMatchObject({ items: [], total: 0 });
    expect((await call('POST', `/admin/disputes/${id}/resolve`, admin.token, { outcome: 'vendor', resolution: 'أُرسل البديل وقبله المشتري' })).statusCode).toBe(204);
    await scheduler.completeDelivered(now);
    expect(await statusOf(a.id)).toBe('completed');
  });

  it('الإكمال على موعد التسليم المحفوظ لا على فترة التعليق اليوم (ACFG-025)', async () => {
    if (!dbUp) return;
    const { a, b } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    await deliver(1, b.id);
    const day = 86_400_000;
    // سُلّم قبل 15 يوماً على فترة 21 — موعده بعد ستة أيام: لا يُكمَل ولو تجاوز فترة اليوم،
    // وإلا انقضت نافذة نزاعه قبل أن يتحرّر ماله
    await prisma.subOrder.update({ where: { id: a.id }, data: { deliveredAt: new Date(Date.now() - 15 * day), holdReleaseAt: new Date(Date.now() + 6 * day) } });
    // سُلّم قبل عشرة أيام على فترة أقصر — بلغ موعده: يُكمَل ولو لم يتجاوز فترة اليوم،
    // وإلا بقي مفتوحاً للنزاع بعد أن تحرّر ماله
    await prisma.subOrder.update({ where: { id: b.id }, data: { deliveredAt: new Date(Date.now() - 10 * day), holdReleaseAt: new Date(Date.now() - day) } });
    await scheduler.completeDelivered(new Date());
    expect(await statusOf(a.id)).toBe('delivered');
    expect(await statusOf(b.id)).toBe('completed');
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

  it('النشر يحدّث تقييم المنتج والمتجر، والمنتج المسحوب بلا مراجعات (BUY-070، DISC-064)', async () => {
    if (!dbUp) return;
    const { a } = await placeOrder([2, 1]);
    const item = a.items[0]!;
    await deliver(0, a.id);
    const ok = await call('POST', '/me/reviews', buyer.token, { orderItemId: item.id, rating: 2, body: 'المقاس أصغر من المكتوب' });
    expect(ok.statusCode, ok.body).toBe(201);

    // كانت الأعمدة تبقى 0 مهما نُشر — «تقييم المتجر» مخفي في كل صفحة
    const published = { status: 'published' };
    const p = await prisma.review.aggregate({ where: { productId: item.productId, ...published }, _avg: { rating: true }, _count: true });
    const v = await prisma.review.aggregate({ where: { vendorId: vendors[0]!.vendorId, ...published }, _avg: { rating: true }, _count: true });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: item.productId }, select: { ratingAvg: true, ratingCount: true } });
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: vendors[0]!.vendorId }, select: { ratingAvg: true, ratingCount: true } });
    expect(product.ratingCount).toBe(p._count);
    expect(Number(product.ratingAvg)).toBeCloseTo(p._avg.rating!, 2);
    expect(vendor.ratingCount).toBe(v._count);
    expect(Number(vendor.ratingAvg)).toBeCloseTo(v._avg.rating!, 2);
    const page = (await call('GET', `/products/${item.productId}/reviews`)).json();
    expect(page).toMatchObject({ count: p._count });
    expect(page.items[0]).toMatchObject({ rating: 2, body: 'المقاس أصغر من المكتوب', verified: true });

    // مسحوب من المتجر: لا منتج ولا مراجعات — كانت تُعاد كأنه معروض
    await prisma.product.update({ where: { id: item.productId }, data: { status: 'archived' } });
    try {
      expect((await call('GET', `/products/${item.productId}/reviews`)).statusCode).toBe(404);
    } finally {
      await prisma.product.update({ where: { id: item.productId }, data: { status: 'active' } });
    }
  });

  it('صاحب المتجر يشتري منه ولا يقيّمه — والمتجر الآخر في الطلب نفسه يقيّمه', async () => {
    if (!dbUp) return;
    const { order, a, b } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    await deliver(1, b.id);
    // الطلب نفسه لصاحب المتجر الأول (الشراء من متجرك مسموح — 21 أكتوبر 2026)
    const owner = vendors[0]!;
    await prisma.order.update({ where: { id: order.id }, data: { customerUserId: owner.userId } });

    const view = (await call('GET', `/me/orders/${order.orderNumber}`, owner.token)).json();
    const store = (vendorId: string) => view.stores.find((s: { vendorId?: string; vendor: { id: string } }) => (s.vendorId ?? s.vendor.id) === vendorId);
    expect(store(owner.vendorId).reviewable).toBe(false);
    expect(store(vendors[1]!.vendorId).reviewable).toBe(true);

    const own = await call('POST', '/me/reviews', owner.token, { orderItemId: a.items[0]!.id, rating: 5 });
    expect(own.statusCode).toBe(409);
    expect(own.json().message).toBe('لا يقيّم صاحب المتجر منتجات متجره.');
    expect(await prisma.review.count({ where: { orderItemId: a.items[0]!.id } })).toBe(0);
    expect((await call('POST', '/me/reviews', owner.token, { orderItemId: b.items[0]!.id, rating: 5 })).statusCode).toBe(201);
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
    expect(first.status).toBe('succeeded');
    expect(await lifecycle.executeRefund(refund.id)).toBe(true);
    const done = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(done.status).toBe('succeeded');
    expect(done.providerRefundId).toBe(first.status === 'succeeded' ? first.refundId : null);
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

describe('إشعارات النزاع — التاجر بالفتح والتصعيد، والطرفان بالقرار (J-06، 19 أكتوبر 2026)', () => {
  // داخل الموقع وحده يكفي للعدّ: كل حدث له نسخة in_app مهما أُطفئ بريده
  const told = async (userId: string, since: Date) =>
    prisma.notification.findMany({
      where: { userId, channel: 'in_app', createdAt: { gte: since } },
      select: { templateCode: true, payloadJson: true },
    });
  const codes = async (userId: string, since: Date) => (await told(userId, since)).map((n) => n.templateCode);
  const payloadOf = async (userId: string, since: Date, code: string) =>
    (await told(userId, since)).find((n) => n.templateCode === code)?.payloadJson;

  it('المشتري يفتح ويصعّد: التاجر يعرف بكلٍّ — والحسم للمتجر يصل الطرفين بسببه، ولا يصل المتجر الآخر شيء', async () => {
    if (!dbUp) return;
    const { a, b } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    await deliver(1, b.id);
    // مدير لا يحمل disputes.resolve: لا يصله نزاع لا يملك حسمه
    const bystander = await user('admin-no-disputes', 'admin', ['orders.manage']);
    const since = new Date();

    const opened = await call('POST', '/me/disputes', buyer.token, { subOrderId: a.id, reasonCode: 'not_received', message: 'لم يصلني شيء' });
    expect(opened.statusCode, opened.body).toBe(201);
    const id = opened.json().id as string;
    // كان التاجر لا يعرف بنزاع جمّد ماله إلا إن فتح صفحته
    expect(await payloadOf(vendors[0]!.userId, since, 'vendor_dispute_opened')).toMatchObject({
      order_number: a.subOrderNumber,
      reason: 'لم يصلني الطلب',
      link: `/vendor/disputes/${id}`,
    });

    expect((await call('POST', `/me/disputes/${id}/escalate`, buyer.token)).statusCode).toBe(204);
    expect(await codes(vendors[0]!.userId, since)).toContain('vendor_dispute_escalated');
    // من صعّد لا يُبلَّغ بما فعله هو
    expect(await codes(buyer.userId, since)).not.toContain('dispute_escalated');
    // ومن يحسم من المديرين يعرف أن نزاعاً يجمّد مال متجر ينتظره — ومن لا يحسم لا
    expect(await payloadOf(admin.userId, since, 'admin_dispute_escalated')).toMatchObject({
      order_number: a.subOrderNumber,
      reason: 'لم يصلني الطلب',
      link: '/admin/disputes',
    });
    expect(await codes(bystander.id, since)).toEqual([]);
    // وما يضيفه طرف بعد التصعيد يقرؤه من يحسم
    expect((await call('POST', `/me/disputes/${id}/messages`, buyer.token, { body: 'صورة الطرد المفتوح مرفقة' })).statusCode).toBe(204);
    expect(await payloadOf(admin.userId, since, 'admin_dispute_message')).toMatchObject({ order_number: a.subOrderNumber, sender: 'المشتري' });

    const resolved = await call('POST', `/admin/disputes/${id}/resolve`, admin.token, { outcome: 'vendor', resolution: 'أثبت المتجر التسليم بتوقيع المستلم' });
    expect(resolved.statusCode, resolved.body).toBe(204);
    expect(await payloadOf(buyer.userId, since, 'dispute_resolved')).toMatchObject({
      outcome: 'حُسم لصالح المتجر',
      resolution: 'أثبت المتجر التسليم بتوقيع المستلم',
      link: `/account/disputes/${id}`,
    });
    expect(await payloadOf(vendors[0]!.userId, since, 'vendor_dispute_resolved')).toMatchObject({
      outcome: 'حُسم لصالحكم، ويُحرَّر مال الطلب بموعده',
      resolution: 'أثبت المتجر التسليم بتوقيع المستلم',
    });
    // المتجر الآخر في الطلب نفسه: لا شيء من نزاع غيره
    expect((await codes(vendors[1]!.userId, since)).filter((c) => c.includes('dispute'))).toEqual([]);
  });

  it('التاجر يصعّد: المشتري يُبلَّغ — والحسم للمشتري يقول لكلٍّ ما يعنيه لماله', async () => {
    if (!dbUp) return;
    const { a } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    const since = new Date();
    const opened = await call('POST', '/me/disputes', buyer.token, { subOrderId: a.id, reasonCode: 'damaged', message: 'وصلت مكسورة' });
    const id = opened.json().id as string;

    expect((await call('POST', `/vendor/disputes/${id}/escalate`, vendors[0]!.token)).statusCode).toBe(204);
    expect(await codes(buyer.userId, since)).toContain('dispute_escalated');
    expect(await codes(vendors[0]!.userId, since)).not.toContain('vendor_dispute_escalated');

    const resolved = await call('POST', `/admin/disputes/${id}/resolve`, admin.token, { outcome: 'customer', resolution: 'الكسر ظاهر في الصور' });
    expect(resolved.statusCode, resolved.body).toBe(204);
    expect(await payloadOf(buyer.userId, since, 'dispute_resolved')).toMatchObject({
      outcome: 'حُسم لصالحك، ويُردّ لك ما بقي من مبلغ هذا المتجر إلى وسيلة دفعك',
    });
    expect(await payloadOf(vendors[0]!.userId, since, 'vendor_dispute_resolved')).toMatchObject({
      outcome: 'حُسم لصالح المشتري، ورُدّ له ما بقي من مبلغ الطلب',
      resolution: 'الكسر ظاهر في الصور',
    });
    // والردّ نفسه ما زال يصل كما كان
    expect(await codes(buyer.userId, since)).toContain('refund_issued');
  });

  it('دُفع بتحويل: الحسم للمشتري لا يعده بردّ إلى «وسيلة دفعه» — الإدارة تحوّل ثم يصله المرجع (ADM-071)', async () => {
    if (!dbUp) return;
    const { a } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    // الطلب كأنه دُفع بتحويل أُكّد — المزوّد الموصول في هذه الاختبارات بطاقة
    const { orderId } = await prisma.subOrder.findUniqueOrThrow({ where: { id: a.id }, select: { orderId: true } });
    await prisma.payment.update({ where: { orderId }, data: { method: 'bank_transfer' } });
    const since = new Date();
    const opened = await call('POST', '/me/disputes', buyer.token, { subOrderId: a.id, reasonCode: 'not_as_described', message: 'اللون مختلف' });
    const id = opened.json().id as string;
    expect((await call('POST', `/me/disputes/${id}/escalate`, buyer.token)).statusCode).toBe(204);

    const resolved = await call('POST', `/admin/disputes/${id}/resolve`, admin.token, { outcome: 'customer', resolution: 'اللون مختلف عن الصورة' });
    expect(resolved.statusCode, resolved.body).toBe(204);
    expect(await payloadOf(buyer.userId, since, 'dispute_resolved')).toMatchObject({
      outcome: 'حُسم لصالحك، وستحوّل لك الإدارة ما بقي من مبلغ هذا المتجر، ونرسل لك مرجع التحويل حين يتمّ',
    });
    // لا «رددنا» قبل أن يخرج المال — الردّ ينتظر تحويل الإدارة ومرجعه
    expect(await codes(buyer.userId, since)).not.toContain('refund_issued');
    expect((await prisma.refund.findFirstOrThrow({ where: { subOrderId: a.id } })).status).toBe('awaiting_transfer');
  });
});

describe('تنبيهات الإدارة الدورية — مرة لكل حالة، لمن يحمل صلاحيتها (19 أكتوبر 2026)', () => {
  const toAdmin = (code: string) =>
    prisma.notification.findMany({ where: { userId: admin.userId, templateCode: code, channel: 'in_app' }, select: { payloadJson: true } });
  const about = async (code: string, orderNumber: string) =>
    (await toAdmin(code)).filter((n) => (n.payloadJson as Record<string, string>)['order_number'] === orderNumber);

  it('مرتجع لم يُستلم بعد 3 أيام: يُنبَّه من يدير الطلبات مرة واحدة', async () => {
    if (!dbUp) return;
    const alerts = app.get(AdminAlertsScheduler);
    const { a, order } = await placeOrder([1, 1]);
    await deliver(0, a.id);
    const req = await call('POST', `/me/orders/${order.orderNumber}/stores/${a.id}/return`, buyer.token, {
      items: [{ orderItemId: a.items[0]!.id, qty: 1 }],
      reasonCode: 'damaged',
    });
    expect(req.statusCode, req.body).toBe(201);
    // قبل العتبة: لا شيء
    await alerts.stalledReturns(new Date());
    expect(await about('admin_return_stalled', a.subOrderNumber)).toHaveLength(0);

    await prisma.returnRequest.update({ where: { id: req.json().returnRequestId }, data: { requestedAt: new Date(Date.now() - 4 * 86_400_000) } });
    await alerts.stalledReturns(new Date());
    await alerts.stalledReturns(new Date());
    const told = await about('admin_return_stalled', a.subOrderNumber);
    expect(told).toHaveLength(1);
    expect(told[0]!.payloadJson).toMatchObject({ days: '4', link: '/admin/returns' });
  });

  it('طلب لم يُقبل في آخر 12 ساعة قبل إلغائه الآلي: يُنبَّه مرة — وما فاتت مهلته لا', async () => {
    if (!dbUp) return;
    const alerts = app.get(AdminAlertsScheduler);
    const { a, b } = await placeOrder([1, 1]);
    // المهلة 48 ساعة: a بقيت له 8، و b فاتت مهلته (تلغيه مهمة الطلبات، لا تنبيه)
    await prisma.subOrder.update({ where: { id: a.id }, data: { placedAt: new Date(Date.now() - 40 * 3_600_000) } });
    await prisma.subOrder.update({ where: { id: b.id }, data: { placedAt: new Date(Date.now() - 50 * 3_600_000) } });
    await alerts.acceptanceDue(new Date());
    await alerts.acceptanceDue(new Date());
    const told = await about('admin_acceptance_due', a.subOrderNumber);
    expect(told).toHaveLength(1);
    expect(told[0]!.payloadJson).toMatchObject({ hours: '8', link: '/admin/orders?due=acceptance' });
    expect(await about('admin_acceptance_due', b.subOrderNumber)).toHaveLength(0);
  });

  // كانت الدورة تقرأ أقدم 200 وحدها، والمنبَّه عنه يبقى بينها حتى يُحسم — فما بعدها لا يُنبَّه أبداً.
  // ظهر على قاعدة التطوير وفيها 392 طلباً تقارب مهلتها (20 أكتوبر 2026). الدفعة هنا 1 بدل 200
  it('أكثر من دفعة: المنبَّه عنه لا يحجب ما بعده — طلبات تقارب مهلتها ومرتجعات عالقة', async () => {
    if (!dbUp) return;
    const alerts = app.get(AdminAlertsScheduler);
    const { a, b, order } = await placeOrder([1, 1]);
    for (const [i, s] of [a, b].entries()) await deliver(i, s.id);
    const returns = [];
    for (const s of [a, b]) {
      const req = await call('POST', `/me/orders/${order.orderNumber}/stores/${s.id}/return`, buyer.token, {
        items: [{ orderItemId: s.items[0]!.id, qty: 1 }],
        reasonCode: 'damaged',
      });
      expect(req.statusCode, req.body).toBe(201);
      returns.push(req.json().returnRequestId as string);
    }
    // a أقدم من b في الحالتين: الدورة القديمة تعيد a في كل دفعة
    await prisma.returnRequest.update({ where: { id: returns[0]! }, data: { requestedAt: new Date(Date.now() - 5 * 86_400_000) } });
    await prisma.returnRequest.update({ where: { id: returns[1]! }, data: { requestedAt: new Date(Date.now() - 4 * 86_400_000) } });
    await alerts.stalledReturns(new Date(), 1);
    await alerts.stalledReturns(new Date(), 1);
    for (const s of [a, b]) expect(await about('admin_return_stalled', s.subOrderNumber), s.subOrderNumber).toHaveLength(1);

    const { a: c, b: d } = await placeOrder([1, 1]);
    await prisma.subOrder.update({ where: { id: c.id }, data: { placedAt: new Date(Date.now() - 41 * 3_600_000) } });
    await prisma.subOrder.update({ where: { id: d.id }, data: { placedAt: new Date(Date.now() - 39 * 3_600_000) } });
    await alerts.acceptanceDue(new Date(), 1);
    await alerts.acceptanceDue(new Date(), 1);
    for (const s of [c, d]) expect(await about('admin_acceptance_due', s.subOrderNumber), s.subOrderNumber).toHaveLength(1);
  });

  it('انحراف في التدقيق: يُنبَّه من يرى التقارير مرة في اليوم لكل منظر — لا من لا يراها', async () => {
    if (!dbUp) return;
    const alerts = app.get(AdminAlertsScheduler);
    const auditor = await user('admin-reports', 'admin', ['reports.view']);
    const drift = vi.spyOn(app.get(ReportsService), 'drift').mockResolvedValue([
      { view: 'audit_wallet_drift', rows: 2 },
      { view: 'audit_inventory_drift', rows: 0 },
    ]);
    try {
      // يوم لم يمرّ على قاعدة الاختبار قبل هذا التشغيل: مفتاح التنبيه بيومه
      const day = new Date(Date.UTC(3000, 0, 1) + Math.floor(Math.random() * 100_000) * 86_400_000);
      expect(await alerts.auditDrift(day)).toBe(1);
      expect(await alerts.auditDrift(day)).toBe(0);
    } finally {
      drift.mockRestore();
    }
    const told = await prisma.notification.findMany({ where: { userId: auditor.id, templateCode: 'admin_audit_drift', channel: 'in_app' } });
    expect(told).toHaveLength(1);
    expect(told[0]!.payloadJson).toMatchObject({ check: 'رصيد محفظة لا يطابق دفترها', rows: '2' });
    // مدير الطلبات لا يرى التقارير: لا يصله
    expect(await toAdmin('admin_audit_drift')).toHaveLength(0);
  });
});

describe('قائمة طلبات المتجر — تصفية بحالة أو أكثر', () => {
  it('تبويب «ملغى أو مُسترَد» يجمع حالاته الأربع، وحالة مفردة لا تُظهر غيرها، والمجهولة تُرفض', async () => {
    if (!dbUp) return;
    const { a, b, order } = await placeOrder([1, 1]);
    expect((await call('POST', `/me/orders/${order.orderNumber}/stores/${b.id}/cancel`, buyer.token, { reason: 'غيّرت رأيي' })).statusCode).toBe(200);
    expect(await statusOf(b.id)).toBe('refunded');

    const closed = ['rejected_by_vendor', 'canceled_by_customer', 'canceled_by_admin', 'refunded'];
    const grouped = await call('GET', `/vendor/orders?status=${closed.join(',')}`, vendors[1]!.token);
    expect(grouped.statusCode, grouped.body).toBe(200);
    const items = grouped.json().items as { id: string; status: string }[];
    expect(items.map((i) => i.id)).toContain(b.id);
    for (const i of items) expect(closed).toContain(i.status);

    const waiting = (await call('GET', '/vendor/orders?status=awaiting_vendor', vendors[1]!.token)).json().items as { id: string; status: string }[];
    expect(waiting.map((i) => i.id)).not.toContain(b.id);
    for (const i of waiting) expect(i.status).toBe('awaiting_vendor');
    // أخوه عند المتجر الآخر لا يظهر هنا أصلاً
    expect(items.map((i) => i.id)).not.toContain(a.id);

    expect((await call('GET', '/vendor/orders?status=completed,bogus', vendors[1]!.token)).statusCode).toBe(400);
  });

  it('البحث برقم الطلب أو اسم المستلم أو المنتج أو SKU، والصفحة الثانية لا تكرّر الأولى (20 أكتوبر 2026)', async () => {
    if (!dbUp) return;
    const { b } = await placeOrder([1, 1]);
    const v = vendors[1]!;
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.variantId }, select: { sku: true, product: { select: { nameAr: true } } } });
    const search = async (term: string) => (await call('GET', `/vendor/orders?search=${encodeURIComponent(term)}`, v.token)).json() as { items: { id: string; buyer: string | null }[]; total: number };

    for (const term of [b.subOrderNumber.toLowerCase(), ADDRESS.recipientName, variant.product.nameAr, variant.sku.toLowerCase()]) {
      expect((await search(term)).items.map((i) => i.id), term).toContain(b.id);
    }
    const byName = await search(ADDRESS.recipientName);
    for (const i of byName.items) expect(i.buyer ?? '').toContain(ADDRESS.recipientName);
    expect(await search('لا-مطابق-هنا')).toMatchObject({ items: [], total: 0 });
    // متجر آخر لا يجد طلب هذا المتجر ولو بحث باسم مستلمه
    expect((await call('GET', `/vendor/orders?search=${encodeURIComponent(variant.sku)}`, vendors[0]!.token)).json().items.map((i: { id: string }) => i.id)).not.toContain(b.id);

    const p1 = (await call('GET', '/vendor/orders', v.token)).json() as { items: { id: string }[]; total: number };
    const p2 = (await call('GET', '/vendor/orders?page=2', v.token)).json() as { items: { id: string }[] };
    expect(p2.items.some((i) => p1.items.some((j) => j.id === i.id))).toBe(false);
    expect(p1.items.length + p2.items.length).toBeLessThanOrEqual(p1.total);

    // الترتيب: الأحدث أولاً افتراضياً، و«الأقدم أولاً» يبدأ بأقدم طلب للمتجر
    const placed = (r: { items: { placedAt: string }[] }) => r.items.map((i) => Date.parse(i.placedAt));
    const newest = placed((await call('GET', '/vendor/orders', v.token)).json());
    const oldest = placed((await call('GET', '/vendor/orders?sort=oldest', v.token)).json());
    expect(newest).toEqual([...newest].sort((x, y) => y - x));
    expect(oldest).toEqual([...oldest].sort((x, y) => x - y));
    expect(oldest[0]).toBeLessThan(newest[0]!);
    expect((await call('GET', '/vendor/orders?sort=bogus', v.token)).statusCode).toBe(400);
  });
});
