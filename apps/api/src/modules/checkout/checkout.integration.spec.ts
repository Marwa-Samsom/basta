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
import { InventoryService } from '../inventory/public';
import { FakePaymentProvider } from '../payments/public';
import { orderNumber } from './domain/snapshot';
import { CheckoutService } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let fake: FakePaymentProvider;
let checkout: CheckoutService;
let dbUp = false;

const SUFFIX = `co${Date.now()}`;
const vendorIds: string[] = [];
const variantIds: string[] = [];
/** الشراء بحساب: مشترٍ يدفع، وآخر لا يرى طلبه */
let buyerToken = '';
let buyerId = '';
let strangerToken = '';

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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
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

/**
 * الإجمالي كما يراه المشتري تحت «ادفع»: تسعير السلة بعنوان الطلب. يُرسل مع
 * الطلب كما ترسله الواجهة. سلة لا تُسعَّر (فارغة، رمز خاطئ) تأخذ صفراً — الطلب
 * يُرفض قبل المقارنة بسببه الحقيقي.
 */
async function seen(cart: string): Promise<{ expectedTotal: string; expectedCurrency: string }> {
  const q = await call('POST', '/checkout/quote', {
    body: { country: ADDRESS.country, region: ADDRESS.region, city: ADDRESS.city },
    headers: { 'x-cart-token': cart },
  });
  return q.statusCode === 200
    ? { expectedTotal: q.json().totals.total.minorUnits, expectedCurrency: q.json().currency }
    : { expectedTotal: '0', expectedCurrency: 'JOD' };
}

async function pay(token: string, paymentToken: string, key = randomUUID()) {
  return call('POST', '/checkout', {
    body: { address: ADDRESS, paymentToken, ...(await seen(token)) },
    headers: { 'x-cart-token': token, 'idempotency-key': key, authorization: `Bearer ${buyerToken}` },
  });
}

/** سطور السلة برمزها كما في القاعدة */
const cartLines = (token: string) =>
  prisma.cartItem.findMany({ where: { cart: { sessionToken: token } }, select: { variantId: true, qty: true } });

/** حساب مشترٍ حقيقي عبر التسجيل والدخول — كما يمرّ به من يشتري */
async function account(tag: string): Promise<{ token: string; userId: string }> {
  const email = `${tag}.${SUFFIX}@basta.test`;
  const password = 'كلمة-مرور-اختبار-طويلة';
  expect((await call('POST', '/auth/register', { body: { email, password, fullName: `مشترٍ ${tag}` } })).statusCode).toBe(201);
  const token = (await call('POST', '/auth/login', { body: { email, password } })).json().tokens.accessToken as string;
  const { id } = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { token, userId: id };
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
  const buyer = await account('buyer');
  buyerToken = buyer.token;
  buyerId = buyer.userId;
  strangerToken = (await account('stranger')).token;


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
    expect(order.customerUserId).toBe(buyerId);

    // السلة باقية: المشتري يعيد المحاولة ببطاقة أخرى بلا إعادة تعبئة
    const cart = await call('GET', '/cart', { headers: { 'x-cart-token': token } });
    expect(cart.json().itemCount).toBe(3);
  });

  it('نقص المخزون يُكتشف قبل أي مال — لا طلب يُنشأ أصلاً', async () => {
    if (!dbUp) return;
    // طلبات هذا المشتري وحده: ملفات الاختبار الأخرى تنشئ طلباتها في اللحظة نفسها
    const mine = () => prisma.order.count({ where: { customerUserId: buyerId } });
    const count = await mine();
    const token = await cartWith([{ variantId: variantIds[1]!, qty: 50 }]);
    const res = await pay(token, 'tok_success');
    expect(res.statusCode).toBe(409);
    expect(await mine()).toBe(count);
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
    // لا نعرف بعد إن خُصم: السلة باقية كما هي
    expect(await cartLines(token)).toHaveLength(1);

    // رقم الطلب وحده لا يفتحه ولا يطلق مصالحته — بلا دخول، أو بحساب آخر، أو بمفتاح
    // ضيف مخمَّن: 404 كأنه غير موجود، والطلب باقٍ معلّقاً
    for (const headers of [{}, { 'x-order-key': 'guessed-key' }, { authorization: `Bearer ${strangerToken}` }]) {
      const peek = await call('GET', `/checkout/orders/${pending.orderNumber}`, { headers });
      expect(peek.statusCode).toBe(404);
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('pending_payment');

    // صاحبه يعود لصفحة الطلب بجلسته — السؤال عن الحالة يطلق المصالحة. طلب الحساب بلا مفتاح ضيف
    expect(res.json().accessKey).toBeUndefined();
    const status = await call('GET', `/checkout/orders/${pending.orderNumber}`, { headers: { authorization: `Bearer ${buyerToken}` } });
    expect(status.json().outcome).toBe('paid');
    expect(status.json().subOrderCount).toBe(1);
    // دُفع: السلة لا تبقى بما دُفع ثمنه فيُدفع ثانية (CHK-069 — حدث في J-08)
    expect(await cartLines(token)).toEqual([]);
  });

  it('نجاح متأخر يطرح من السلة ما دُفع وحده — ما أُضيف بعد الطلب يبقى (CHK-069)', async () => {
    if (!dbUp) return;
    const token = await cartWith([{ variantId: variantIds[0]!, qty: 2 }]);
    const res = await pay(token, 'tok_timeout');
    expect(res.json().outcome).toBe('pending');
    // المشتري أضاف إلى السلة نفسها وهو ينتظر
    expect((await call('POST', '/cart/items', { body: { variantId: variantIds[1]!, qty: 1 }, headers: { 'x-cart-token': token } })).statusCode).toBe(201);
    expect((await call('POST', '/cart/items', { body: { variantId: variantIds[0]!, qty: 1 }, headers: { 'x-cart-token': token } })).statusCode).toBe(201);

    await app.get(CheckoutService).reconcile(res.json().orderId as string);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: res.json().orderId as string } })).status).toBe('processing');
    expect((await cartLines(token)).sort((a, b) => a.variantId.localeCompare(b.variantId))).toEqual(
      [
        { variantId: variantIds[0]!, qty: 1 },
        { variantId: variantIds[1]!, qty: 1 },
      ].sort((a, b) => a.variantId.localeCompare(b.variantId)),
    );
  });

  it('رقم الطلب من مولّد معمّى بثمانية محارف، وإعادة «ادفع» بالمفتاح نفسه تعيد الطلب نفسه', async () => {
    if (!dbUp) return;
    const numbers = new Set(Array.from({ length: 2000 }, () => orderNumber(new Date('2026-09-29T10:00:00Z'))));
    expect(numbers.size).toBe(2000);
    for (const n of numbers) expect(n).toMatch(/^BST-260929-[2-9A-HJ-NP-Z]{8}$/);

    // إعادة «ادفع» بمفتاح عدم التكرار نفسه تعيد الطلب نفسه
    const cart = await cartWith([{ variantId: variantIds[0]!, qty: 1 }]);
    const idem = randomUUID();
    const first = await pay(cart, 'tok_success', idem);
    const again = await pay(cart, 'tok_success', idem);
    expect(again.json().orderId).toBe(first.json().orderId);
    // والطلب لصاحبه: حساب آخر لا يفتحه
    const cross = await call('GET', `/checkout/orders/${first.json().orderNumber}`, { headers: { authorization: `Bearer ${strangerToken}` } });
    expect(cross.statusCode).toBe(404);
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

describe('دفع يصل بعد إغلاق الطلب — يُردّ ولا يُرمى', () => {
  /** طلب بانتظار التحقق (3-D Secure) ثم يُغلق فاشلاً — كما تفعل المصالحة عند انتهاء المهلة */
  async function closedThenCaptured() {
    const token = await cartWith([{ variantId: variantIds[0]!, qty: 1 }]);
    const res = await pay(token, 'tok_3ds');
    expect(res.json().outcome).toBe('requires_action');
    const orderId = res.json().orderId as string;
    expect(await checkout.markFailed(orderId, 'action_timeout', 'انتهت مهلة التحقق.')).toBe(true);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    // البوابة أكملت التحقق والخصم بعد الإغلاق — tok_3ds حقيقته captured
    const webhook = () => {
      const body = fake.eventFor(payment.providerIntentId!, orderId, payment.amountMinorUnits, payment.currency);
      return app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook/fake',
        headers: { 'x-signature': FakePaymentProvider.sign(body), 'content-type': 'application/json' },
        payload: body,
      });
    };
    return { orderId, payment, webhook };
  }

  it('النجاح المتأخر يُردّ كله مرة واحدة، ولا يُحيي الطلب ولا يقسّمه', async () => {
    if (!dbUp) return;
    const { orderId, payment, webhook } = await closedThenCaptured();
    const stock = await stockOf(variantIds[0]!);

    const r = await webhook();
    expect(r.statusCode, r.body).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    expect(order.status).toBe('payment_failed');
    expect(order.paidAt).toBeNull();
    expect(order.payment!.status).toBe('refunded');
    expect(order.payment!.lateRefundId).toBeTruthy();
    expect(await prisma.subOrder.count({ where: { orderId } })).toBe(0);
    expect(fake.refundsOf(payment.providerIntentId!)).toEqual([payment.amountMinorUnits]);
    // المخزون المحرَّر بالفشل لا يُستهلك بالنجاح المتأخر
    expect(await stockOf(variantIds[0]!)).toEqual(stock);
    const audits = await prisma.auditLog.findMany({ where: { entityId: orderId, action: { startsWith: 'payment.late_capture' } } });
    expect(audits.map((a) => a.action).sort()).toEqual(['payment.late_capture', 'payment.late_capture_refunded']);
  });

  it('الإشعار والمصالحة والإشعار المكرّر معاً يردّون مرة واحدة', async () => {
    if (!dbUp) return;
    const { orderId, payment, webhook } = await closedThenCaptured();
    await Promise.all([
      webhook(),
      webhook(), // حدث بمعرّف آخر — البوابة ترسل أكثر من حدث للخصم نفسه
      checkout.apply(orderId, { status: 'captured', intentId: payment.providerIntentId! }),
    ]);
    expect(fake.refundsOf(payment.providerIntentId!)).toEqual([payment.amountMinorUnits]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId } })).status).toBe('refunded');
  });

  it('إشعار نجاح مكرّر لطلب مدفوع فعلاً لا يردّ شيئاً', async () => {
    if (!dbUp) return;
    const token = await cartWith([{ variantId: variantIds[1]!, qty: 1 }]);
    const res = await pay(token, 'tok_success');
    expect(res.json().outcome).toBe('paid');
    const orderId = res.json().orderId as string;
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    await checkout.apply(orderId, { status: 'captured', intentId: payment.providerIntentId! });
    expect(fake.refundsOf(payment.providerIntentId!)).toEqual([]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId } })).lateCaptureAt).toBeNull();
  });

  it('سقوط البوابة بين الحجز والردّ: المصالحة تكمل الردّ مرة واحدة', async () => {
    if (!dbUp) return;
    const { orderId, payment, webhook } = await closedThenCaptured();
    const original = fake.refund.bind(fake);
    fake.refund = async () => {
      throw new Error('انقطع الاتصال بالبوابة');
    };
    try {
      const r = await webhook();
      // الإشعار يفشل فتعيده البوابة — لكن الحجز قائم والمصالحة لا تنتظرها
      expect(r.statusCode).toBe(500);
    } finally {
      fake.refund = original;
    }
    const pending = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    expect(pending.lateCaptureAt).not.toBeNull();
    expect(pending.lateRefundId).toBeNull();
    expect(fake.refundsOf(payment.providerIntentId!)).toEqual([]);

    const later = new Date(Date.now() + 5 * 60_000);
    await checkout.settleLateRefunds(later);
    await checkout.settleLateRefunds(later);
    expect(fake.refundsOf(payment.providerIntentId!)).toEqual([payment.amountMinorUnits]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId } })).status).toBe('refunded');
  });
});

describe('دفع بعد انتهاء الحجز — إشعاران متزامنان لا يردّان مالاً عن طلب مدفوع', () => {
  let n = 0;
  /** منتج بقطعة واحدة لدى البائع الأول — القطعة الأخيرة هي ما يُتسابق عليه */
  async function oneUnit(): Promise<string> {
    n++;
    const product = await prisma.product.create({
      data: { vendorId: vendorIds[0]!, slug: `last-${n}-${SUFFIX}`, nameAr: `القطعة الأخيرة ${n}`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendorIds[0]!, sku: `LAST-${n}-${SUFFIX}`.toUpperCase(), priceMinorUnits: 9_900n, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 1, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 1, reason: 'import' } });
    return variant.id;
  }

  /** طلب بانتظار التحقق، ثم انقضى حجزه — البوابة ستؤكّد الخصم بعد المهلة */
  async function expiredPending(variantId: string) {
    const cart = await cartWith([{ variantId, qty: 1 }]);
    const res = await pay(cart, 'tok_3ds');
    expect(res.json().outcome).toBe('requires_action');
    const orderId = res.json().orderId as string;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    // الحجز لم يعد نشطاً — كما يتركه منظّف الحجوز المنتهية (بلا لمس حجوز الاختبارات الأخرى)
    await app.get(InventoryService).release(order.reservationIds);
    const webhook = () => {
      const body = fake.eventFor(order.payment!.providerIntentId!, orderId, order.payment!.amountMinorUnits, order.payment!.currency);
      return app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook/fake',
        headers: { 'x-signature': FakePaymentProvider.sign(body), 'content-type': 'application/json' },
        payload: body,
      });
    };
    return { orderId, payment: order.payment!, webhook, cart };
  }

  it('المخزون متاح: يُعاد الحجز ويُكمل الطلب — بلا ردّ', async () => {
    if (!dbUp) return;
    const variantId = await oneUnit();
    const { orderId, payment, webhook, cart } = await expiredPending(variantId);
    expect((await webhook()).statusCode).toBe(200);
    // الحجز أُعيد بسلة القديم: الإشعار يعرف ما يطرح منها
    expect(await cartLines(cart)).toEqual([]);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    expect(order.status).toBe('processing');
    expect(order.payment!.status).toBe('captured');
    expect(await prisma.subOrder.count({ where: { orderId } })).toBe(1);
    expect(fake.refundsOf(payment.providerIntentId!)).toEqual([]);
    expect(await stockOf(variantId)).toEqual({ onHand: 0, reserved: 0 });
  });

  it('إشعاران معاً على القطعة الأخيرة: يُكمل الطلب مرة، ولا يُردّ ماله ولا يُختم مردوداً', async () => {
    if (!dbUp) return;
    const variantId = await oneUnit();
    const { orderId, payment, webhook } = await expiredPending(variantId);
    const [a, b] = await Promise.all([webhook(), webhook()]);
    expect([a.statusCode, b.statusCode], `${a.body}\n${b.body}`).toEqual([200, 200]);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    expect(order.status).toBe('processing');
    expect(order.payment!.status).toBe('captured');
    expect(order.payment!.lateCaptureAt).toBeNull();
    expect(await prisma.subOrder.count({ where: { orderId } })).toBe(1);
    expect(fake.refundsOf(payment.providerIntentId!)).toEqual([]);
    expect(await stockOf(variantId)).toEqual({ onHand: 0, reserved: 0 });
  });

  it('نفد المخزون فعلاً: يُلغى الطلب ويُردّ المال مرة واحدة ولو وصل الإشعار مرتين', async () => {
    if (!dbUp) return;
    const variantId = await oneUnit();
    const { orderId, payment, webhook } = await expiredPending(variantId);
    // مشترٍ آخر اشترى القطعة الأخيرة بعد انقضاء الحجز
    expect((await pay(await cartWith([{ variantId, qty: 1 }]), 'tok_success')).json().outcome).toBe('paid');

    const [a, b] = await Promise.all([webhook(), webhook()]);
    expect([a.statusCode, b.statusCode], `${a.body}\n${b.body}`).toEqual([200, 200]);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    expect(order.status).toBe('canceled');
    expect(order.paidAt).toBeNull();
    expect(order.payment!.status).toBe('refunded');
    expect(order.payment!.lateRefundId).toBeTruthy();
    expect(await prisma.subOrder.count({ where: { orderId } })).toBe(0);
    expect(fake.refundsOf(payment.providerIntentId!)).toEqual([payment.amountMinorUnits]);
    // القطعة بيعت مرة واحدة — للمشتري الآخر
    expect(await stockOf(variantId)).toEqual({ onHand: 0, reserved: 0 });
  });
});

describe('الشراء بحساب — محسوم 13 أكتوبر 2026', () => {
  it('سلة الضيف: «ادفع» بلا دخول يُردّ 401 بلا طلب ولا حجز، والسلة نفسها تُدفع بعد الدخول', async () => {
    if (!dbUp) return;
    const cart = await cartWith([{ variantId: variantIds[1]!, qty: 1 }]);
    const before = await stockOf(variantIds[1]!);
    const key = randomUUID();

    const guest = await call('POST', '/checkout', {
      body: { address: ADDRESS, paymentToken: 'tok_success', guestEmail: `guest.${SUFFIX}@basta.test`, ...(await seen(cart)) },
      headers: { 'x-cart-token': cart, 'idempotency-key': key },
    });
    expect(guest.statusCode).toBe(401);
    expect(guest.json().message).toBe('سجّل دخولك أو أنشئ حساباً لتكمل الشراء — سلّتك محفوظة كما هي.');
    expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(await stockOf(variantIds[1]!)).toEqual(before);

    // السلة برمزها لا بالحساب: بعد الدخول تُدفع كما هي، والطلب باسم صاحبه
    expect((await call('GET', '/cart', { headers: { 'x-cart-token': cart } })).json().itemCount).toBe(1);
    const paid = await pay(cart, 'tok_success', key);
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().outcome).toBe('paid');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: paid.json().orderId } });
    expect(order.customerUserId).toBe(buyerId);
    expect(order.guestEmail).toBeNull();
  });
});

describe('حدود الكوبون — تُحجز مع الطلب تحت قفل، ولا يتخطّاها ضيف', () => {
  let n = 0;
  /** منتج بمخزون وافر — لا يتنافس الاختبار على مخزون اختبار آخر */
  async function stocked(): Promise<string> {
    n++;
    const product = await prisma.product.create({
      data: { vendorId: vendorIds[1]!, slug: `cpn-${n}-${SUFFIX}`, nameAr: `منتج الكوبون ${n}`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendorIds[1]!, sku: `CPN-${n}-${SUFFIX}`.toUpperCase(), priceMinorUnits: 10_000n, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 50, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 50, reason: 'import' } });
    return variant.id;
  }
  const coupon = (code: string, limits: { total?: number; perUser?: number }) =>
    prisma.coupon.create({
      data: {
        code,
        scope: 'platform',
        type: 'percent',
        valueBps: 1000,
        usageLimitTotal: limits.total ?? null,
        usageLimitPerUser: limits.perUser ?? null,
      },
    });
  async function cartWithCoupon(variantId: string, code: string, token?: string): Promise<string> {
    const cart = await cartWith([{ variantId, qty: 1 }]);
    const r = await call('PUT', '/cart/coupon', { body: { code }, headers: { 'x-cart-token': cart, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    expect(r.statusCode, r.body).toBe(200);
    return cart;
  }
  /** `null` = ضيف بلا دخول */
  const checkoutAs = async (cart: string, paymentToken: string, token: string | null = buyerToken) =>
    call('POST', '/checkout', {
      body: { address: ADDRESS, paymentToken, ...(await seen(cart)) },
      headers: { 'x-cart-token': cart, 'idempotency-key': randomUUID(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  async function member(tag: string): Promise<string> {
    const email = `cpn.${tag}.${SUFFIX}@basta.test`;
    const password = 'كلمة-مرور-اختبار-طويلة';
    expect((await call('POST', '/auth/register', { body: { email, password, fullName: 'مشترٍ الكوبون' } })).statusCode).toBe(201);
    return (await call('POST', '/auth/login', { body: { email, password } })).json().tokens.accessToken as string;
  }

  it('كوبون المنصّة بمبلغ ثابت يُستعمل: خصم واحد بعملته تموّله المنصّة، ويُسجَّل استعماله (ACFG-035)', async () => {
    if (!dbUp) return;
    const variantId = await stocked();
    // كما تنشئه لوحة الكوبونات: منصّي، ثابت، بعملة — كان يُرفض «غير مدعوم على سلّة متعددة العملات»
    const c = await prisma.coupon.create({
      data: { code: `FIX-${SUFFIX}`.toUpperCase(), scope: 'platform', type: 'fixed', valueMinorUnits: 1_500n, currency: 'JOD', fundedBy: 'platform' },
    });
    const cart = await cartWithCoupon(variantId, c.code);
    const res = await checkoutAs(cart, 'tok_success');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().outcome).toBe('paid');

    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.json().orderNumber }, include: { subOrders: true } });
    const sub = order.subOrders[0]!;
    expect(sub.discountMinorUnits).toBe(1_500n);
    // المنصّة تموّله: صافي البائع لا ينقص بالخصم
    expect(sub.vendorNetMinorUnits).toBe(10_000n - sub.commissionMinorUnits + sub.shippingMinorUnits);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(1);
    expect(await prisma.$queryRaw<unknown[]>`SELECT * FROM audit_order_split_drift WHERE order_id = ${order.id}::uuid`).toEqual([]);
  });

  it('الحدّ الكلي تحت التزامن: كوبون لاستعمالين وخمسة طلبات معاً — يمرّ اثنان', async () => {
    if (!dbUp) return;
    const variantId = await stocked();
    const c = await coupon(`TOTAL2-${SUFFIX}`.toUpperCase(), { total: 2 });
    const carts = await Promise.all(Array.from({ length: 5 }, () => cartWithCoupon(variantId, c.code)));
    const results = await Promise.all(carts.map((cart) => checkoutAs(cart, 'tok_success')));

    const ok = results.filter((r) => r.statusCode === 200 && r.json().outcome === 'paid');
    // الرفض في موضعين كلاهما صحيح: التسعير (400) إن التزم اثنان قبل أن يُسعَّر هذا،
    // أو الحجز تحت القفل (409) إن تزامنوا فعلاً — التوقيت يختار، والحصيلة واحدة
    const rejected = results.filter((r) => r.statusCode === 400 || r.statusCode === 409);
    expect(ok, results.map((r) => `${r.statusCode} ${r.body}`).join('\n')).toHaveLength(2);
    expect(rejected, results.map((r) => `${r.statusCode} ${r.body}`).join('\n')).toHaveLength(3);
    for (const r of rejected) expect(r.json().message).toMatch(/استُنفد/);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).usedCount).toBe(2);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(2);
    // المرفوض لا يحبس مخزوناً
    expect(await stockOf(variantId)).toEqual({ onHand: 48, reserved: 0 });
  });

  it('الضيف لا يدفع أصلاً — يُطلب دخوله قبل أي حجز، والكوبون لا يُستعمل', async () => {
    if (!dbUp) return;
    const variantId = await stocked();
    const c = await coupon(`ONCE-G-${SUFFIX}`.toUpperCase(), { perUser: 1 });
    const r = await checkoutAs(await cartWithCoupon(variantId, c.code), 'tok_success', null);
    expect(r.statusCode).toBe(401);
    expect(r.json().message).toMatch(/سجّل دخولك/);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(0);
    expect(await stockOf(variantId)).toEqual({ onHand: 50, reserved: 0 });
  });

  it('الحدّ لكل مستخدم تحت التزامن: طلبان معاً من الحساب نفسه — يمرّ واحد', async () => {
    if (!dbUp) return;
    const variantId = await stocked();
    const c = await coupon(`ONCE-M-${SUFFIX}`.toUpperCase(), { perUser: 1 });
    const token = await member('once');
    const carts = await Promise.all([cartWithCoupon(variantId, c.code, token), cartWithCoupon(variantId, c.code, token)]);
    const results = await Promise.all(carts.map((cart) => checkoutAs(cart, 'tok_success', token)));
    expect(results.filter((r) => r.statusCode === 200).length, results.map((r) => r.body).join('\n')).toBe(1);
    // التسعير (400) أو الحجز تحت القفل (409) — بحسب أيّهما بلغه الطلب الثاني أولاً
    const rejected = results.filter((r) => r.statusCode === 400 || r.statusCode === 409);
    expect(rejected, results.map((r) => `${r.statusCode} ${r.body}`).join('\n')).toHaveLength(1);
    expect(rejected[0]!.json().message).toMatch(/استعملت هذا الكوبون/);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(1);
  });

  it('فشل الدفع يعيد الاستعمال: لا يُحسب على صاحبه ولا على الحدّ', async () => {
    if (!dbUp) return;
    const variantId = await stocked();
    const c = await coupon(`RETRY-${SUFFIX}`.toUpperCase(), { total: 1, perUser: 1 });
    const token = await member('retry');
    const declined = await checkoutAs(await cartWithCoupon(variantId, c.code, token), 'tok_decline', token);
    expect(declined.json().outcome).toBe('failed');
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).usedCount).toBe(0);
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(0);

    const paid = await checkoutAs(await cartWithCoupon(variantId, c.code, token), 'tok_success', token);
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().outcome).toBe('paid');
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).usedCount).toBe(1);
  });
});

describe('الإجمالي الذي رآه المشتري هو ما يُخصم — لا غيره', () => {
  const SA_ADDRESS = { ...ADDRESS, phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض' };
  let variantId = '';

  // بائع يشحن إلى بلدين بسعرين: الأردن 5.000 د.أ والسعودية 25.000 د.أ
  beforeAll(async () => {
    if (!dbUp) return;
    const owner = await prisma.user.create({
      data: { email: `two-zones.${SUFFIX}@basta.test`, fullName: 'بائع بمنطقتين', passwordHash: await hashPassword('كلمة-مرور-اختبار-طويلة'), roles: { create: { role: 'vendor_owner' } } },
    });
    const vendor = await prisma.vendor.create({
      data: {
        ownerUserId: owner.id, slug: `v-zones-${SUFFIX}`, nameAr: 'متجر بمنطقتين', status: 'approved', approvedAt: new Date(), settlementCurrency: 'JOD', country: 'JO',
        shippingZones: {
          create: [
            { nameAr: 'الأردن', regions: { create: { country: 'JO' } }, rates: { create: { method: 'flat', priceMinorUnits: 5_000n, minDays: 1, maxDays: 3 } } },
            { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 25_000n, minDays: 3, maxDays: 7 } } },
          ],
        },
      },
    });
    vendorIds.push(vendor.id);
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, slug: `p-zones-${SUFFIX}`, nameAr: 'منتج بمنطقتين', status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendor.id, sku: `ZONES-${SUFFIX}`.toUpperCase(), priceMinorUnits: 10_000n, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 10, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 10, reason: 'import' } });
    variantId = variant.id;
  });

  const quoteFor = async (cart: string, a: typeof ADDRESS) =>
    (await call('POST', '/checkout/quote', { body: { country: a.country, region: a.region, city: a.city }, headers: { 'x-cart-token': cart } })).json();
  const place = (cart: string, a: typeof ADDRESS, expected: { expectedTotal?: string; expectedCurrency?: string }, key = randomUUID()) =>
    call('POST', '/checkout', {
      body: { address: a, paymentToken: 'tok_success', ...expected },
      headers: { 'x-cart-token': cart, 'idempotency-key': key, authorization: `Bearer ${buyerToken}` },
    });

  it('حسب الشحن للأردن ثم دفع بعنوان سعودي: 409 بالإجمالي الجديد، ولا طلب ولا حجز ولا مال', async () => {
    if (!dbUp) return;
    const cart = await cartWith([{ variantId, qty: 1 }]);
    const jo = await quoteFor(cart, ADDRESS);
    const sa = await quoteFor(cart, SA_ADDRESS);
    expect(jo.totals.total.minorUnits).not.toBe(sa.totals.total.minorUnits);
    const before = await stockOf(variantId);

    const key = randomUUID();
    const res = await place(cart, SA_ADDRESS, { expectedTotal: jo.totals.total.minorUnits, expectedCurrency: jo.currency }, key);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().details).toEqual({ reason: 'TOTAL_CHANGED', total: sa.totals.total.minorUnits, currency: 'JOD' });
    expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(await stockOf(variantId)).toEqual(before);

    // يراه ويؤكّده: الطلب بالعنوان السعودي يُخصم بإجماليه هو
    const ok = await place(cart, SA_ADDRESS, { expectedTotal: sa.totals.total.minorUnits, expectedCurrency: sa.currency });
    expect(ok.statusCode, ok.body).toBe(200);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: ok.json().orderId }, include: { payment: true } });
    expect(order.grandTotalMinorUnits.toString()).toBe(sa.totals.total.minorUnits);
    expect(order.payment!.amountMinorUnits.toString()).toBe(sa.totals.total.minorUnits);
  });

  it('بلا إجمالي أو بعملة أخرى لا دفع', async () => {
    if (!dbUp) return;
    const cart = await cartWith([{ variantId, qty: 1 }]);
    const jo = await quoteFor(cart, ADDRESS);
    expect((await place(cart, ADDRESS, {})).statusCode).toBe(400);
    const otherCurrency = await place(cart, ADDRESS, { expectedTotal: jo.totals.total.minorUnits, expectedCurrency: 'SAR' });
    expect(otherCurrency.statusCode).toBe(409);
    expect(otherCurrency.json().details.reason).toBe('TOTAL_CHANGED');
  });
});

describe('قطعة لم تعد تُباع لا تُسقط السلة — تُعرض لتُزال، والباقي يُسعَّر (CHK-021)', () => {
  const linesOf = (cart: { groups: { lines: { variantId: string }[] }[] }) => cart.groups.flatMap((g) => g.lines);
  const productOf = async (variantId: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).productId;

  it('منتج أوقفته الإدارة: السلة 200 بسطره «لم يعد متاحاً» ومانعه، والإجمالي بالباقي؛ الإزالة تفكّ المانع', async () => {
    if (!dbUp) return;
    const token = await cartWith([
      { variantId: variantIds[0]!, qty: 1 },
      { variantId: variantIds[1]!, qty: 1 },
    ]);
    const headers = { 'x-cart-token': token };
    const before = (await call('GET', '/cart', { headers })).json();
    const productId = await productOf(variantIds[0]!);
    await prisma.product.update({ where: { id: productId }, data: { status: 'rejected' } });
    try {
      // كان 404 «منتج في سلّتك لم يعد متاحاً…» فيمحو المتصفّح رمز السلة وتضيع القطعة الأخرى معها
      const res = await call('GET', '/cart', { headers });
      expect(res.statusCode, res.body).toBe(200);
      const cart = res.json();
      expect(linesOf(cart).find((l) => l.variantId === variantIds[0])).toMatchObject({ unavailable: true, available: 0, qty: 1 });
      expect(linesOf(cart).find((l) => l.variantId === variantIds[1])).toMatchObject({ qty: 1 });
      expect(cart.blockers.some((b: string) => b.includes('لم يعد متاحاً للبيع'))).toBe(true);
      expect(cart.itemCount).toBe(2);
      // الإجمالي بالقطعة الأخرى وحدها
      expect(BigInt(cart.totals.items.minorUnits)).toBeGreaterThan(0n);
      expect(BigInt(cart.totals.items.minorUnits)).toBeLessThan(BigInt(before.totals.items.minorUnits));

      const removed = await call('PATCH', `/cart/items/${variantIds[0]}`, { body: { qty: 0 }, headers });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(removed.json().blockers).toEqual([]);
      expect(linesOf(removed.json()).map((l) => l.variantId)).toEqual([variantIds[1]]);
    } finally {
      await prisma.product.update({ where: { id: productId }, data: { status: 'active' } });
    }
  });

  it('سلة كل قطعها لم تعد تُباع: 200 بإجمالي صفر وسطورها ومانعها — لا 404', async () => {
    if (!dbUp) return;
    const token = await cartWith([{ variantId: variantIds[0]!, qty: 2 }]);
    const productId = await productOf(variantIds[0]!);
    await prisma.product.update({ where: { id: productId }, data: { status: 'rejected' } });
    try {
      const res = await call('GET', '/cart', { headers: { 'x-cart-token': token } });
      expect(res.statusCode, res.body).toBe(200);
      expect(linesOf(res.json())).toMatchObject([{ variantId: variantIds[0], unavailable: true, qty: 2 }]);
      expect(res.json().totals.total.minorUnits).toBe('0');
      expect(res.json().blockers).toHaveLength(1);
    } finally {
      await prisma.product.update({ where: { id: productId }, data: { status: 'active' } });
    }
  });
});
