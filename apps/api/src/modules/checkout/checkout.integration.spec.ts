/**
 * بوابة المرحلة 08 — البنود الخمسة، عبر الواجهة البرمجية الحيّة.
 *
 *   1. سلة من 3 بائعين تنتج طلباً أباً و3 فرعية بشحن وحالات مستقلة
 *   2. فشل الدفع لا يستهلك مخزوناً ولا ينشئ طلباً معلّقاً بلا صاحب
 *   3. دفع ناجح تكرّر إشعاره مرتين لا ينشئ طلبين
 *   4. انقطاع الاتصال أثناء الدفع ينتهي بحالة معروفة
 *   5. مجموع الفرعية = الأب بالقرش الواحد
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { FakePaymentProvider } from '../payments/public';
import { CheckoutService } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let fake: FakePaymentProvider;
let checkout: CheckoutService;
let dbUp = false;

const SUFFIX = `co${Date.now()}`;
const vendorIds: string[] = [];
const variantIds: string[] = [];

const ADDRESS = {
  recipientName: 'مشترٍ تجريبي',
  phone: '+962790000000',
  country: 'JO',
  region: 'العاصمة',
  city: 'عمّان',
  street: 'شارع الجامعة 12',
};

type Inject = Awaited<ReturnType<NestFastifyApplication['inject']>>;

async function call(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Inject> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.headers ?? {},
    ...(opts.body !== undefined ? { payload: opts.body as Record<string, unknown> } : {}),
  });
}

/** سلة ضيف بسطر من كل متغيّر مطلوب */
async function cartWith(items: { variantId: string; qty: number }[], currency = 'JOD'): Promise<string> {
  const created = await call('POST', '/cart', { body: { currency } });
  expect(created.statusCode, created.body).toBe(201);
  const token = created.json().token as string;
  for (const item of items) {
    const res = await call('POST', '/cart/items', { body: item, headers: { 'x-cart-token': token } });
    expect(res.statusCode, res.body).toBe(201);
  }
  return token;
}

async function pay(token: string, paymentToken: string, key = randomUUID()) {
  return call('POST', '/checkout', {
    body: { address: ADDRESS, paymentToken, guestEmail: `buyer.${SUFFIX}@basta.test` },
    headers: { 'x-cart-token': token, 'idempotency-key': key },
  });
}

const stockOf = async (variantId: string) =>
  prisma.inventory.findUniqueOrThrow({ where: { variantId }, select: { onHand: true, reserved: true } });

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات إتمام الشراء الحيّة متخطّاة.\n');
    return;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  fake = app.get(FakePaymentProvider);
  checkout = app.get(CheckoutService);

  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'home' } });

  // ثلاثة بائعين بثلاث عملات: الريال والدينار والدولار — ADR-013
  const specs = [
    ['sar', 'SAR', 19_900n, 2_500n],
    ['jod', 'JOD', 12_500n, 1_500n],
    ['usd', 'USD', 4_750n, 800n],
  ] as const;

  for (const [tag, currency, price, shipping] of specs) {
    const user = await prisma.user.create({
      data: {
        email: `${tag}.${SUFFIX}@basta.test`,
        fullName: `بائع ${tag}`,
        passwordHash: await hashPassword('كلمة-مرور-اختبار-طويلة'),
        roles: { create: { role: 'vendor_owner' } },
      },
    });
    const vendor = await prisma.vendor.create({
      data: {
        ownerUserId: user.id,
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
            rates: { create: { method: 'flat', priceMinorUnits: shipping, minDays: 1, maxDays: 3 } },
          },
        },
      },
    });
    vendorIds.push(vendor.id);

    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        slug: `p-${tag}-${SUFFIX}`,
        nameAr: `منتج ${tag}`,
        status: 'active',
        publishedAt: new Date(),
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        vendorId: vendor.id,
        sku: `SKU-${tag}-${SUFFIX}`.toUpperCase(),
        priceMinorUnits: price,
        optionsKey: '',
        isActive: true,
      },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 20, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 20, reason: 'import' } });
    variantIds.push(variant.id);
  }
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('بوابة 08 · البند 1 و 5 — ثلاثة بائعين، طلب واحد، وتطابق بالقرش', () => {
  it('ينتج أباً وثلاثة فرعية بشحن وحالات مستقلة، ومجموعها = الأب بالضبط', async () => {
    if (!dbUp) return;
    const token = await cartWith(variantIds.map((variantId) => ({ variantId, qty: 2 })));
    const before = await Promise.all(variantIds.map(stockOf));

    const res = await pay(token, 'tok_success');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().outcome).toBe('paid');
    expect(res.json().subOrderCount).toBe(3);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.json().orderId },
      include: { subOrders: { include: { items: true } } },
    });
    expect(order.status).toBe('processing');
    expect(order.currency).toBe('JOD');

    // كل فرعي بعملة بائعه، وبشحنه هو، وبحالته هو
    const currencies = order.subOrders.map((s) => s.settlementCurrency).sort();
    expect(currencies).toEqual(['JOD', 'SAR', 'USD']);
    const shipping = new Map(order.subOrders.map((s) => [s.settlementCurrency, s.shippingMinorUnits]));
    expect(shipping.get('SAR')).toBe(2_500n);
    expect(shipping.get('JOD')).toBe(1_500n);
    expect(shipping.get('USD')).toBe(800n);
    expect(order.subOrders.every((s) => s.status === 'awaiting_vendor')).toBe(true);

    // البند 5: مجموع حصص الفرعية بعملة الدفع = الأب، بلا سماحية
    const children = order.subOrders.reduce((a, s) => a + (s.chargeTotalMinorUnits ?? 0n), 0n);
    expect(children).toBe(order.grandTotalMinorUnits);

    // والمنظران في القاعدة لا يريان انحرافاً — الحارس في المخطط لا في الاختبار وحده
    const drift = await prisma.$queryRaw<unknown[]>`SELECT * FROM audit_order_split_drift WHERE order_id = ${order.id}::uuid`;
    expect(drift).toHaveLength(0);
    const orphan = await prisma.$queryRaw<unknown[]>`SELECT * FROM audit_paid_without_split WHERE order_id = ${order.id}::uuid`;
    expect(orphan).toHaveLength(0);

    // المخزون استُهلك فعلاً: كل متغيّر نقص قطعتين، والمحجوز عاد صفراً
    const after = await Promise.all(variantIds.map(stockOf));
    after.forEach((s, i) => {
      expect(s.onHand).toBe(before[i]!.onHand - 2);
      expect(s.reserved).toBe(before[i]!.reserved);
    });

    // والسلة فُرّغت بعد النجاح
    const cart = await call('GET', '/cart', { headers: { 'x-cart-token': token } });
    expect(cart.json().itemCount).toBe(0);
  });
});

describe('بوابة 08 · البند 2 — الفشل لا يستهلك مخزوناً ولا يترك معلّقاً', () => {
  it('بطاقة مرفوضة: المخزون كما كان، والطلب مختوم payment_failed بصاحبه', async () => {
    if (!dbUp) return;
    const token = await cartWith([{ variantId: variantIds[0]!, qty: 3 }]);
    const before = await stockOf(variantIds[0]!);

    const res = await pay(token, 'tok_decline');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().outcome).toBe('failed');
    expect(res.json().failure.code).toBe('card_declined');

    const after = await stockOf(variantIds[0]!);
    expect(after).toEqual(before);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.json().orderId },
      include: { subOrders: true },
    });
    expect(order.status).toBe('payment_failed');
    expect(order.subOrders).toHaveLength(0);
    expect(order.guestEmail).toBe(`buyer.${SUFFIX}@basta.test`);

    // السلة باقية: المشتري يعيد المحاولة ببطاقة أخرى بلا إعادة تعبئة
    const cart = await call('GET', '/cart', { headers: { 'x-cart-token': token } });
    expect(cart.json().itemCount).toBe(3);
  });

  it('نقص المخزون يُكتشف قبل أي مال — لا طلب يُنشأ أصلاً', async () => {
    if (!dbUp) return;
    const count = await prisma.order.count();
    const token = await cartWith([{ variantId: variantIds[1]!, qty: 50 }]);
    const res = await pay(token, 'tok_success');
    expect(res.statusCode).toBe(409);
    expect(await prisma.order.count()).toBe(count);
  });
});

describe('بوابة 08 · البند 3 — عدم التكرار', () => {
  it('إشعار النجاح مرتين لا ينشئ طلبين ولا يستهلك مخزوناً مرتين', async () => {
    if (!dbUp) return;
    const token = await cartWith([{ variantId: variantIds[2]!, qty: 1 }]);
    const before = await stockOf(variantIds[2]!);

    const res = await pay(token, 'tok_3ds');
    expect(res.json().outcome).toBe('requires_action');
    const orderId = res.json().orderId as string;

    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    const body = fake.eventFor(payment.providerIntentId!, orderId, payment.amountMinorUnits, payment.currency);
    const headers = { 'x-signature': FakePaymentProvider.sign(body), 'content-type': 'application/json' };

    // الإشعار نفسه مرتين، متزامنين — كما تعيد البوابة الإرسال حين يتأخّر ردّنا
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/payments/webhook/fake', headers, payload: body }),
      app.inject({ method: 'POST', url: '/api/v1/payments/webhook/fake', headers, payload: body }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect([first.json().duplicate, second.json().duplicate].filter(Boolean)).toHaveLength(1);

    const subOrders = await prisma.subOrder.count({ where: { orderId } });
    expect(subOrders).toBe(1);
    const after = await stockOf(variantIds[2]!);
    expect(after.onHand).toBe(before.onHand - 1);
  });

  it('النجاح من مسارين مختلفين (إشعار ومصالحة) لا يقسّم مرتين', async () => {
    if (!dbUp) return;
    const token = await cartWith([{ variantId: variantIds[0]!, qty: 1 }]);
    const res = await pay(token, 'tok_success');
    const orderId = res.json().orderId as string;
    const before = await stockOf(variantIds[0]!);

    // قيد الإشعار الفريد لا يحمي هنا: المساران لا يمرّان بجدول الإشعارات نفسه.
    // الحارس الوحيد شرط pending_payment في تحديث الطلب
    const [a, b] = await Promise.all([checkout.markPaid(orderId), checkout.markPaid(orderId)]);
    expect([a, b]).toEqual([false, false]);
    expect(await prisma.subOrder.count({ where: { orderId } })).toBe(1);
    expect(await stockOf(variantIds[0]!)).toEqual(before);
  });

  it('المفتاح نفسه مرتين يعيد الطلب نفسه — الضغط مرتين على «ادفع»', async () => {
    if (!dbUp) return;
    const token = await cartWith([{ variantId: variantIds[1]!, qty: 1 }]);
    const key = randomUUID();
    const [a, b] = await Promise.all([pay(token, 'tok_success', key), pay(token, 'tok_success', key)]);
    expect(a.json().orderId).toBe(b.json().orderId);
    expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('إشعار بتوقيع مزوّر يُرفض قبل أي أثر', async () => {
    if (!dbUp) return;
    const body = JSON.stringify({ id: 'evt_x', type: 'payment.captured', intentId: 'x', orderId: randomUUID(), amountMinor: '1', currency: 'JOD' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook/fake',
      headers: { 'x-signature': 'مزوّر', 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('بوابة 08 · البند 4 — انقطاع الاتصال ينتهي بحالة معروفة', () => {
  it('خُصم المال ولم يصل الردّ: «معلّق» ثم المصالحة تحسمه مدفوعاً', async () => {
    if (!dbUp) return;
    const token = await cartWith([{ variantId: variantIds[0]!, qty: 1 }]);
    const res = await pay(token, 'tok_timeout');
    expect(res.json().outcome).toBe('pending');

    const pending = await prisma.order.findUniqueOrThrow({ where: { id: res.json().orderId } });
    expect(pending.status).toBe('pending_payment');
    // الحجز باقٍ أثناء الانتظار: لا تُباع القطعة لغيره وماله ربما خُصم
    expect(pending.reservationIds.length).toBe(1);

    // المشتري يعود لصفحة الطلب — السؤال عن الحالة يطلق المصالحة
    const status = await call('GET', `/checkout/orders/${pending.orderNumber}`);
    expect(status.json().outcome).toBe('paid');
    expect(status.json().subOrderCount).toBe(1);
  });

  it('لم يُخصم المال وانقطع الاتصال: المصالحة تحسمه فاشلاً وتحرّر الحجز', async () => {
    if (!dbUp) return;
    const before = await stockOf(variantIds[1]!);
    const token = await cartWith([{ variantId: variantIds[1]!, qty: 2 }]);
    const res = await pay(token, 'tok_timeout_fail');
    expect(res.json().outcome).toBe('pending');

    const outcome = await checkout.reconcile(res.json().orderId);
    expect(outcome).toBe('failed');
    expect(await stockOf(variantIds[1]!)).toEqual(before);
  });

  it('سقط الخادم قبل إرسال الدفع: بعد مهلة الحجز يُختم فاشلاً لا يبقى معلّقاً للأبد', async () => {
    if (!dbUp) return;
    const token = await cartWith([{ variantId: variantIds[2]!, qty: 1 }]);
    // طلب بلا تفويض عند المزوّد — كأن العملية ماتت بعد الحجز وقبل charge
    const res = await pay(token, 'tok_timeout_fail');
    const orderId = res.json().orderId as string;
    await prisma.payment.update({ where: { orderId }, data: { providerIntentId: null } });

    const later = new Date(Date.now() + 16 * 60_000);
    expect(await checkout.reconcile(orderId, later)).toBe('failed');
  });
});
