/**
 * الدفع بتحويل يدوي — UX-OPS-AUDIT البند 8، عبر الواجهة البرمجية الحيّة.
 *
 * ما يُثبته:
 *   1. «أكّد الطلب» يحجز الطلب بانتظار التحويل: لا تقسيم، ولا قيد للبائع، ولا مال
 *   2. الإدارة تؤكّد الوصول بمرجعه ومبلغه — وعندها فقط يُقسَّم ويُقيَّد للبائعين
 *   3. انقضاء المهلة يلغي الطلب ويعيد القطع، والمشتري يلغي قبلها
 *   4. الردّ لا يقول «رُدّ المبلغ» قبل أن تسجّل الإدارة مرجع التحويل الصادر
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { OrderScheduler } from '../orders/public';
import { BANK_TRANSFER_TOKEN, ManualTransferProvider, PAYMENT_PROVIDER } from '../payments/public';
import { pendingToReconcile } from './application/checkout.service';
import { CheckoutService } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let checkout: CheckoutService;
let scheduler: OrderScheduler;
let dbUp = false;

const SUFFIX = `mt${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const vendorIds: string[] = [];
const variantIds: string[] = [];
let buyer = { token: '', id: '' };
let stranger = { token: '', id: '' };
let financeToken = '';
let contentToken = '';
let financeId = '';

const TRANSFER_SETTINGS = {
  transfer_beneficiary: 'شركة بسطة للتجارة',
  transfer_cliq_alias: 'BASTA',
  transfer_iban: 'JO94CBJO0010000000000131000302',
  transfer_bank: 'بنك القاهرة عمّان',
  transfer_window_hours: 48,
} as const;
/** ما كان في الإعدادات قبل الاختبار — يُعاد كما كان، فقاعدة التطوير لا ترث بيانات حساب وهمية */
let savedSettings: { key: string; valueJson: unknown }[] = [];

const ADDRESS = {
  recipientName: 'مشترٍ تحويل',
  phone: '+962790000123',
  country: 'JO',
  region: 'العاصمة',
  city: 'عمّان',
  street: 'شارع الجامعة 12',
};

const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();
const adminTotpSecret = generateSecret();

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;

async function call(method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { payload: opts.body as Record<string, unknown> } : {}),
  });
}

async function account(tag: string): Promise<{ token: string; id: string }> {
  const email = `${tag}.${SUFFIX}@basta.test`;
  expect((await call('POST', '/auth/register', { body: { email, password: PASSWORD, fullName: `مشترٍ ${tag}` } })).statusCode).toBe(201);
  const token = (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).json().tokens.accessToken as string;
  const { id } = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { token, id };
}

async function admin(tag: string, permissions: string[]): Promise<{ token: string; id: string }> {
  const email = `${tag}.${SUFFIX}@basta.test`;
  const u = await prisma.user.create({
    data: {
      email,
      fullName: `مدير ${tag}`,
      passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'admin' } },
      permissions: { create: permissions.map((permission) => ({ permission })) },
      totpSecretEnc: adminTotpSecret,
      totpEnabledAt: new Date(),
    },
  });
  const totp = generateSync({ strategy: 'totp', secret: adminTotpSecret, crypto: totpCrypto, base32: totpBase32 });
  const res = await call('POST', '/auth/login', { body: { email, password: PASSWORD, totp } });
  expect(res.statusCode, res.body).toBe(200);
  return { token: res.json().tokens.accessToken as string, id: u.id };
}

async function cartWith(items: { variantId: string; qty: number }[]): Promise<string> {
  const created = await call('POST', '/cart', { body: { currency: 'JOD' } });
  const token = created.json().token as string;
  for (const item of items) {
    const res = await call('POST', '/cart/items', { body: item, headers: { 'x-cart-token': token } });
    expect(res.statusCode, res.body).toBe(201);
  }
  return token;
}

async function order(items: { variantId: string; qty: number }[], who = buyer): Promise<{ res: Res; cart: string }> {
  const cart = await cartWith(items);
  const q = await call('POST', '/checkout/quote', {
    body: { country: ADDRESS.country, region: ADDRESS.region, city: ADDRESS.city },
    headers: { 'x-cart-token': cart },
  });
  expect(q.statusCode, q.body).toBe(200);
  const res = await call('POST', '/checkout', {
    token: who.token,
    body: { address: ADDRESS, paymentToken: BANK_TRANSFER_TOKEN, expectedTotal: q.json().totals.total.minorUnits, expectedCurrency: q.json().currency },
    headers: { 'x-cart-token': cart, 'idempotency-key': randomUUID() },
  });
  return { res, cart };
}

const stockOf = (variantId: string) =>
  prisma.inventory.findUniqueOrThrow({ where: { variantId }, select: { onHand: true, reserved: true } });

const notices = (userId: string, templateCode: string) =>
  prisma.notification.findMany({ where: { userId, templateCode }, select: { channel: true, payloadJson: true } });

async function setTransferSettings(values: Partial<Record<keyof typeof TRANSFER_SETTINGS, string | number | null>>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null) await prisma.setting.deleteMany({ where: { key } });
    else await prisma.setting.upsert({ where: { key }, create: { key, valueJson: value }, update: { valueJson: value } });
  }
}

/** طلب ينتظر التحويل يُغلق قبل أن ينتهي الملف — لا يبقى في طابور إدارة التطوير */
const openOrders: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات التحويل اليدوي متخطّاة.\n');
    return;
  }

  savedSettings = await prisma.setting.findMany({
    where: { key: { in: Object.keys(TRANSFER_SETTINGS) } },
    select: { key: true, valueJson: true },
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(new ManualTransferProvider())
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  checkout = app.get(CheckoutService);
  scheduler = app.get(OrderScheduler);

  buyer = await account('buyer');
  stranger = await account('stranger');
  const finance = await admin('finance', ['payouts.approve']);
  financeToken = finance.token;
  financeId = finance.id;
  contentToken = (await admin('content', ['content.manage'])).token;

  // بائعان بعملتين: التقسيم عند التأكيد يُنتج فرعيين بحصّتين مجموعهما الأب
  for (const [tag, currency, price] of [['jod', 'JOD', 12_500n], ['usd', 'USD', 4_750n]] as const) {
    const user = await prisma.user.create({
      data: {
        email: `${tag}.${SUFFIX}@basta.test`,
        fullName: `بائع ${tag}`,
        passwordHash: await hashPassword(PASSWORD),
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
            rates: { create: { method: 'flat', priceMinorUnits: 1_000n, minDays: 1, maxDays: 3 } },
          },
        },
      },
    });
    vendorIds.push(vendor.id);
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, slug: `p-${tag}-${SUFFIX}`, nameAr: `منتج ${tag}`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendor.id, sku: `SKU-${tag}-${SUFFIX}`.toUpperCase(), priceMinorUnits: price, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 30, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 30, reason: 'import' } });
    variantIds.push(variant.id);
  }
}, 120_000);

afterAll(async () => {
  if (dbUp) {
    try {
      // ما بقي ينتظر تحويلاً يُختم — طابور الإدارة في قاعدة التطوير لا يرث طلبات اختبار
      for (const id of openOrders) await checkout.markFailed(id, 'test_cleanup', 'تنظيف الاختبار.');
    } finally {
      await prisma.setting.deleteMany({ where: { key: { in: Object.keys(TRANSFER_SETTINGS) } } });
      for (const s of savedSettings) await prisma.setting.create({ data: { key: s.key, valueJson: s.valueJson as never } });
    }
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('التحويل اليدوي · قبل الضبط', () => {
  it('بلا بيانات حساب يُرفض الطلب قبل أي حجز — لا يحجز المشتري طلباً لا يعرف أين يحوّل ثمنه', async () => {
    if (!dbUp) return;
    await setTransferSettings({ transfer_beneficiary: null, transfer_cliq_alias: null, transfer_iban: null });
    const before = await stockOf(variantIds[0]!);
    const { res } = await order([{ variantId: variantIds[0]!, qty: 1 }]);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().details.reason).toBe('TRANSFER_NOT_CONFIGURED');
    expect(await stockOf(variantIds[0]!)).toEqual(before);

    // وصفحة الدفع تعرف ذلك قبل «أكّد الطلب»
    const method = await call('GET', '/checkout/payment-method');
    expect(method.json()).toMatchObject({ method: 'bank_transfer', ready: false });
  });
});

describe('التحويل اليدوي · الحجز والتأكيد', () => {
  it('«أكّد الطلب» يحجز بانتظار التحويل: مهلة، وحجز ممدود، ورسالة — ولا تقسيم ولا قيد ولا مال', async () => {
    if (!dbUp) return;
    await setTransferSettings(TRANSFER_SETTINGS);
    const method = await call('GET', '/checkout/payment-method');
    expect(method.json()).toEqual({ method: 'bank_transfer', windowHours: 48, ready: true, cliq: true });

    const before = await Promise.all(variantIds.map(stockOf));
    const { res, cart } = await order(variantIds.map((variantId) => ({ variantId, qty: 2 })));
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    openOrders.push(body.orderId);
    expect(body.outcome).toBe('awaiting_transfer');
    expect(body.subOrderCount).toBe(0);
    expect(body.transfer).toMatchObject({
      reference: body.orderNumber,
      windowHours: 48,
      beneficiary: TRANSFER_SETTINGS.transfer_beneficiary,
      cliqAlias: 'BASTA',
      iban: TRANSFER_SETTINGS.transfer_iban,
    });

    const o = await prisma.order.findUniqueOrThrow({
      where: { id: body.orderId },
      include: { payment: true, subOrders: true },
    });
    expect(o.status).toBe('pending_payment');
    expect(o.subOrders).toHaveLength(0);
    expect(o.payment).toMatchObject({ provider: 'manual', method: 'bank_transfer', status: 'awaiting_transfer' });
    const expected = o.placedAt.getTime() + 48 * 3_600_000;
    expect(o.payment!.expiresAt!.getTime()).toBe(expected);

    // القطع محجوزة طوال المهلة، لا ربع ساعة
    const reservations = await prisma.stockReservation.findMany({ where: { id: { in: o.reservationIds } } });
    expect(reservations.every((r) => r.status === 'active' && r.expiresAt.getTime() === expected)).toBe(true);
    const held = await Promise.all(variantIds.map(stockOf));
    held.forEach((s, i) => {
      expect(s.onHand).toBe(before[i]!.onHand);
      expect(s.reserved).toBe(before[i]!.reserved + 2);
    });

    // لا قيد لأي بائع من مال لم يصل
    expect(await prisma.ledgerEntry.count({ where: { vendorId: { in: vendorIds } } })).toBe(0);

    // والسلة فُرّغت: الطلب محجوز باسمه، وسلة ممتلئة تدعوه ليطلب مرتين
    expect((await call('GET', '/cart', { headers: { 'x-cart-token': cart } })).json().itemCount).toBe(0);

    // والمشتري تصله كيف يحوّل وإلى متى
    const sent = await notices(buyer.id, 'order_awaiting_transfer');
    expect(sent.length).toBeGreaterThan(0);
    const vars = (sent[0]!.payloadJson as Record<string, string>);
    expect(vars['order_number']).toBe(body.orderNumber);
    expect(vars['pay_to']).toContain('كليك: BASTA');
    expect(vars['pay_to']).toContain('المستفيد: شركة بسطة للتجارة');
    // ومن يؤكّد التحويلات يعرف أن طلباً ينتظره (19 أكتوبر 2026) — لا مدير المحتوى
    const toFinance = (await notices(financeId, 'admin_transfer_awaiting')).map((n) => n.payloadJson as Record<string, string>);
    expect(toFinance.some((v) => v['order_number'] === body.orderNumber && v['link'] === '/admin/transfers')).toBe(true);
    const contentId = (await prisma.user.findUniqueOrThrow({ where: { email: `content.${SUFFIX}@basta.test` } })).id;
    expect(await notices(contentId, 'admin_transfer_awaiting')).toHaveLength(0);

    // سؤال الحالة يعيدها كما هي — المصالحة لا تحسمها فشلاً
    const status = await call('GET', `/checkout/orders/${body.orderNumber}`, { token: buyer.token });
    expect(status.json().outcome).toBe('awaiting_transfer');
    // بعد ساعة ما زال ينتظر — والمصالحة على هذا الطلب وحده: الدفعة كلها تمسّ طلبات ملفات أخرى
    expect(await checkout.reconcile(body.orderId, new Date(Date.now() + 3_600_000))).toBe('awaiting_transfer');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } })).status).toBe('pending_payment');

    // ويظهر في «طلباتي» وتفاصيله بكيف يحوّل وما حجزه
    const list = await call('GET', '/me/orders', { token: buyer.token });
    expect(list.json().items.some((i: { number: string }) => i.number === body.orderNumber)).toBe(true);
    const detail = await call('GET', `/me/orders/${body.orderNumber}`, { token: buyer.token });
    expect(detail.json().transfer.cliqAlias).toBe('BASTA');
    expect(detail.json().lines).toHaveLength(2);
  });

  it('الإدارة تؤكّد بمرجعه ومبلغه: يُقسَّم ويُقيَّد للبائعين ويصل المتاجر — مرة واحدة', async () => {
    if (!dbUp) return;
    const { res } = await order(variantIds.map((variantId) => ({ variantId, qty: 1 })));
    const { orderId, orderNumber: number, total } = res.json();
    openOrders.push(orderId);

    // الطابور يعرضه بمبلغه ومشتريه
    // بالبحث برقم الطلب — الطابور خمسين خمسين
    const queue = await call('GET', `/admin/payments/transfers?search=${number}`, { token: financeToken });
    expect(queue.statusCode, queue.body).toBe(200);
    expect(queue.json().total).toBe(1);
    const row = queue.json().items.find((w: { orderNumber: string }) => w.orderNumber === number);
    expect(row).toMatchObject({ amountMinorUnits: total.minorUnits, currency: 'JOD', storeCount: 2, buyer: { phone: ADDRESS.phone } });

    // من لا يملك صلاحية المال لا يؤكّد
    const denied = await call('POST', `/admin/payments/transfers/${number}/confirm`, {
      token: contentToken,
      body: { reference: 'CLQ-1', receivedMinorUnits: total.minorUnits },
    });
    expect(denied.statusCode).toBe(403);

    // مبلغ لا يطابق: تحويل طلب آخر أو ناقص — لا يُؤكَّد
    const wrong = await call('POST', `/admin/payments/transfers/${number}/confirm`, {
      token: financeToken,
      body: { reference: 'CLQ-1', receivedMinorUnits: String(BigInt(total.minorUnits) - 1n) },
    });
    expect(wrong.statusCode, wrong.body).toBe(400);
    expect(wrong.json().details.reason).toBe('AMOUNT_MISMATCH');

    const ok = await call('POST', `/admin/payments/transfers/${number}/confirm`, {
      token: financeToken,
      body: { reference: 'CLQ-88123', receivedMinorUnits: total.minorUnits, note: 'من حساب: أحمد محمد' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().outcome).toBe('paid');
    expect(ok.json().subOrderCount).toBe(2);
    openOrders.splice(openOrders.indexOf(orderId), 1);

    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true, subOrders: true } });
    expect(o.status).toBe('processing');
    expect(o.payment).toMatchObject({ status: 'captured', transferReference: 'CLQ-88123', transferNote: 'من حساب: أحمد محمد', confirmedBy: financeId });
    expect(o.subOrders.every((s) => s.status === 'awaiting_vendor')).toBe(true);
    // القيد للبائع الآن، لا قبل
    expect(await prisma.ledgerEntry.count({ where: { refId: { in: o.subOrders.map((s) => s.id) } } })).toBeGreaterThan(0);
    expect(await prisma.$queryRaw<unknown[]>`SELECT * FROM audit_order_split_drift WHERE order_id = ${orderId}::uuid`).toHaveLength(0);
    expect(await prisma.$queryRaw<unknown[]>`SELECT * FROM audit_paid_without_split WHERE order_id = ${orderId}::uuid`).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: 'payment.transfer_confirmed', entityId: orderId, actorUserId: financeId } })).toBe(1);
    expect((await notices(buyer.id, 'order_placed')).length).toBeGreaterThan(0);

    // وفي «آخر ما أُكّد» بمرجعه ومن أكّده
    const after = await call('GET', `/admin/payments/transfers?search=${number}`, { token: financeToken });
    expect(after.json()).toMatchObject({ items: [], total: 0 });
    // والمؤكَّد يُوجد بمرجع التحويل كما في كشف البنك
    const confirmed = await call('GET', '/admin/payments/transfers/confirmed?search=clq-88123', { token: financeToken });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().items.find((c: { orderNumber: string }) => c.orderNumber === number)).toMatchObject({
      reference: 'CLQ-88123',
      confirmedBy: 'مدير finance',
    });

    // التأكيد الثاني لا يقسّم مرتين
    const again = await call('POST', `/admin/payments/transfers/${number}/confirm`, {
      token: financeToken,
      body: { reference: 'CLQ-88124', receivedMinorUnits: total.minorUnits },
    });
    expect(again.statusCode).toBe(409);
    expect(await prisma.subOrder.count({ where: { orderId } })).toBe(2);
  });

  it('حدّ الطلبات المفتوحة: الرابع يُرفض حتى يحوّل أو يلغي — لا يحجز حسابٌ مخزوناً كاملاً', async () => {
    if (!dbUp) return;
    const who = await account('limit');
    for (let i = 0; i < 3; i++) {
      const { res } = await order([{ variantId: variantIds[0]!, qty: 1 }], who);
      expect(res.statusCode, res.body).toBe(200);
      openOrders.push(res.json().orderId);
    }
    const before = await stockOf(variantIds[0]!);
    const { res } = await order([{ variantId: variantIds[0]!, qty: 1 }], who);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().details.reason).toBe('TOO_MANY_OPEN_TRANSFERS');
    expect(await stockOf(variantIds[0]!)).toEqual(before);
  });
});

describe('التحويل اليدوي · الإلغاء وانقضاء المهلة', () => {
  it('المشتري يلغي قبل التحويل: القطع تعود فوراً، وغيره لا يلغي طلبه', async () => {
    if (!dbUp) return;
    const before = await stockOf(variantIds[1]!);
    const { res } = await order([{ variantId: variantIds[1]!, qty: 3 }]);
    const { orderId, orderNumber: number } = res.json();
    openOrders.push(orderId);
    expect((await stockOf(variantIds[1]!)).reserved).toBe(before.reserved + 3);

    expect((await call('POST', `/checkout/orders/${number}/cancel`, { token: stranger.token })).statusCode).toBe(404);

    const canceled = await call('POST', `/checkout/orders/${number}/cancel`, { token: buyer.token });
    expect(canceled.statusCode, canceled.body).toBe(200);
    expect(canceled.json()).toMatchObject({ outcome: 'failed', failure: { code: 'canceled_by_customer' } });
    openOrders.splice(openOrders.indexOf(orderId), 1);
    expect(await stockOf(variantIds[1]!)).toEqual(before);

    // ولا يُؤكَّد بعد إلغائه
    const late = await call('POST', `/admin/payments/transfers/${number}/confirm`, {
      token: financeToken,
      body: { reference: 'CLQ-2', receivedMinorUnits: res.json().total.minorUnits },
    });
    expect(late.statusCode).toBe(409);
  });

  it('انقضت المهلة: لا يُؤكَّد، والمصالحة تلغيه وتعيد القطع وتبلّغ المشتري مرة واحدة', async () => {
    if (!dbUp) return;
    const before = await stockOf(variantIds[0]!);
    const { res } = await order([{ variantId: variantIds[0]!, qty: 2 }]);
    const { orderId, orderNumber: number, total } = res.json();
    openOrders.push(orderId);
    await prisma.payment.update({ where: { orderId }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    // تحويل وصل بعد الموعد لا يُحيي الطلب: قطعه قد تكون بيعت لغيره
    const late = await call('POST', `/admin/payments/transfers/${number}/confirm`, {
      token: financeToken,
      body: { reference: 'CLQ-3', receivedMinorUnits: total.minorUnits },
    });
    expect(late.statusCode, late.body).toBe(409);
    expect(late.json().details.reason).toBe('TRANSFER_EXPIRED');

    // المهمة الدورية تلتقطه بعد دقيقة من وضعه (وما ينتظر ولم تنقضِ مهلته لا تلتقطه) — يُفحص
    // شرطها على هذا الطلب وحده: تشغيلها كاملةً يمسّ طلبات ملفات أخرى تجري معه
    await prisma.order.update({ where: { id: orderId }, data: { placedAt: new Date(Date.now() - 120_000) } });
    expect(await prisma.order.count({ where: { AND: [pendingToReconcile(new Date()), { id: orderId }] } })).toBe(1);
    const fresh = openOrders.find((id) => id !== orderId)!;
    expect(await prisma.order.count({ where: { AND: [pendingToReconcile(new Date(Date.now() + 120_000)), { id: fresh }] } })).toBe(0);

    expect(await checkout.reconcile(orderId)).toBe('failed');
    await checkout.reconcile(orderId); // الإعادة لا تبلّغ مرتين

    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    expect(o.status).toBe('payment_failed');
    openOrders.splice(openOrders.indexOf(orderId), 1);
    expect(o.payment).toMatchObject({ status: 'failed', failureCode: 'transfer_expired' });
    expect(await stockOf(variantIds[0]!)).toEqual(before);
    const sent = await notices(buyer.id, 'transfer_expired');
    expect(sent.filter((n) => (n.payloadJson as Record<string, string>)['order_number'] === number && n.channel === 'in_app')).toHaveLength(1);

    const status = await call('GET', `/checkout/orders/${number}`, { token: buyer.token });
    expect(status.json()).toMatchObject({ outcome: 'failed', failure: { code: 'transfer_expired' } });
  });
});

describe('التحويل اليدوي · الردّ', () => {
  it('الإلغاء بعد التأكيد: الردّ ينتظر تحويل الإدارة — لا «رُدّ المبلغ» ولا «مُسترَد» قبل مرجعه', async () => {
    if (!dbUp) return;
    const { res } = await order([{ variantId: variantIds[0]!, qty: 1 }]);
    const { orderId, orderNumber: number, total } = res.json();
    await checkout.confirmTransfer(number, financeId, { reference: 'CLQ-55', note: 'من حساب: سارة', receivedMinor: BigInt(total.minorUnits) });

    const sub = await prisma.subOrder.findFirstOrThrow({ where: { orderId } });
    const cancel = await call('POST', `/me/orders/${number}/stores/${sub.id}/cancel`, { token: buyer.token, body: { reason: 'غيّرت رأيي' } });
    expect(cancel.statusCode, cancel.body).toBe(200);

    const refund = await prisma.refund.findFirstOrThrow({ where: { subOrderId: sub.id } });
    expect(refund.status).toBe('awaiting_transfer');
    expect(refund.amountMinorUnits).toBe(BigInt(total.minorUnits));
    // ومن يحوّل الردود يعرف أن مشترياً ينتظر ماله
    const waiting = (await notices(financeId, 'admin_refund_awaiting_transfer')).map((n) => n.payloadJson as Record<string, string>);
    expect(waiting.some((v) => v['order_number'] === number && v['link'] === '/admin/transfers')).toBe(true);
    expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('canceled_by_customer');
    expect(await notices(buyer.id, 'refund_issued')).toHaveLength(0);

    // المهمة الدورية لا تعيده — ليس متعثّراً بل ينتظر إنساناً
    await scheduler.retryRefunds(new Date(Date.now() + 3_600_000));
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('awaiting_transfer');

    // والمشتري يرى أنه قيد التحويل، لا أنه رُدّ
    const detail = await call('GET', `/me/orders/${number}`, { token: buyer.token });
    expect(detail.json().stores[0].refunds[0]).toMatchObject({ status: 'awaiting_transfer', transferReference: null });

    // طابور الإدارة: المبلغ، والمشتري، ومن أين دفع — إليه يُردّ
    const queue = await call('GET', `/admin/refunds/awaiting-transfer?search=${number}`, { token: financeToken });
    expect(queue.statusCode, queue.body).toBe(200);
    expect(queue.json().total).toBe(1);
    expect(queue.json().items.find((i: { id: string }) => i.id === refund.id)).toMatchObject({
      orderNumber: number,
      amountMinorUnits: total.minorUnits,
      paidWith: { reference: 'CLQ-55', note: 'من حساب: سارة' },
      buyer: { phone: ADDRESS.phone },
    });
    expect((await call('GET', '/admin/refunds/awaiting-transfer', { token: contentToken })).statusCode).toBe(403);

    // سُجّل التحويل الصادر: الآن فقط «تمّ» ويصل المشتري المرجع
    const short = await call('POST', `/admin/refunds/${refund.id}/transfer`, { token: financeToken, body: { reference: 'x' } });
    expect(short.statusCode).toBe(400);
    const done = await call('POST', `/admin/refunds/${refund.id}/transfer`, { token: financeToken, body: { reference: 'OUT-7731' } });
    expect(done.statusCode, done.body).toBe(200);

    const settled = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(settled).toMatchObject({ status: 'succeeded', transferReference: 'OUT-7731', approvedBy: financeId });
    expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('refunded');
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId } })).status).toBe('refunded');
    const told = await notices(buyer.id, 'refund_transferred');
    expect(told.some((n) => (n.payloadJson as Record<string, string>)['reference'] === 'OUT-7731')).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'refund.transfer_recorded', entityId: refund.id } })).toBe(1);

    // ما رُدّ بتحويل لا يُعاد لأي مزوّد — حتى لو وُصلت بوابة بعده
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).providerRefundId).toBe('manual:OUT-7731');

    // والتسجيل الثاني لا يبلّغ مرتين
    expect((await call('POST', `/admin/refunds/${refund.id}/transfer`, { token: financeToken, body: { reference: 'OUT-7732' } })).statusCode).toBe(409);
    expect(await prisma.$queryRaw<unknown[]>`SELECT * FROM audit_money_conservation WHERE sub_order_id = ${sub.id}::uuid`).toHaveLength(0);
  });

  it('المال يعود من حيث جاء: دفعة بطاقة عند مزوّد آخر لا تصير «بانتظار التحويل» ولا يُسأل عنها الموصول', async () => {
    if (!dbUp) return;
    // دفعة بالبطاقة قبل تبديل المزوّد: تُصنع من طلب مؤكَّد ثم تُنسب لبوابة أخرى بتفويضها
    const { res } = await order([{ variantId: variantIds[1]!, qty: 1 }]);
    const { orderId, orderNumber: number, total } = res.json();
    await checkout.confirmTransfer(number, financeId, { reference: 'CLQ-77', receivedMinor: BigInt(total.minorUnits) });
    await prisma.payment.update({
      where: { orderId },
      data: { provider: 'fake', method: 'card', providerIntentId: `fake_pi_${randomUUID()}`, transferReference: null },
    });

    const sub = await prisma.subOrder.findFirstOrThrow({ where: { orderId } });
    const cancel = await call('POST', `/me/orders/${number}/stores/${sub.id}/cancel`, { token: buyer.token, body: { reason: 'تبديل مزوّد' } });
    expect(cancel.statusCode, cancel.body).toBe(200);
    // يبقى معلّقاً للبوابة التي قبضته (تعيده مهمتها حين تُوصل) — لا يدخل طابور التحويل
    const refund = await prisma.refund.findFirstOrThrow({ where: { subOrderId: sub.id } });
    expect(refund.status).toBe('pending');
    const queue = await call('GET', '/admin/refunds/awaiting-transfer', { token: financeToken });
    expect(queue.json().items.some((i: { id: string }) => i.id === refund.id)).toBe(false);

    // وطلب معلّق عند البوابة الأخرى لا يقلبه سؤال الموصول طلبَ تحويل
    const pending = await order([{ variantId: variantIds[1]!, qty: 1 }]);
    const pendingId = pending.res.json().orderId as string;
    openOrders.push(pendingId);
    await prisma.payment.update({
      where: { orderId: pendingId },
      data: { provider: 'fake', method: 'card', status: 'pending', expiresAt: null, providerIntentId: `fake_pi_${randomUUID()}` },
    });
    expect(await checkout.reconcile(pendingId)).toBe('pending');
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId: pendingId } })).status).toBe('pending');
  });
});
