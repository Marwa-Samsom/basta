/**
 * بوابة المرحلة 10 — البنود الخمسة، عبر الواجهة البرمجية الحيّة.
 *
 *   1. عمولة المنصة + مستحقات البائعين + الاستردادات = المقبوض، بالقرش
 *   2. تغيير نسبة العمولة اليوم لا يغيّر عمولة أي طلب سابق
 *   3. مرتجع بعد تحرير الرصيد يُعالَج بقيد عكسي، والسالب موثّق بسببه
 *   4. سحبان متزامنان من محفظة واحدة لا يسحبان الرصيد مرتين
 *   5. كشف حساب البائع يطابق الدفتر بالكامل
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
import { TrackingService } from '../shipping/public';
import { FinanceService, LedgerService, ReleaseScheduler } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let tracking: TrackingService;
let release: ReleaseScheduler;
let finance: FinanceService;
let ledger: LedgerService;
let dbUp = false;

const SUFFIX = `fn${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();
const adminSecret = generateSecret();

interface VendorSeat {
  userId: string;
  vendorId: string;
  variantId: string;
  productId: string;
  currency: string;
  token: string;
}
const vendors: VendorSeat[] = [];
let buyer = { userId: '', token: '' };
let admin = { userId: '', token: '' };
/** حدّ السحب الأدنى كما كان قبل الاختبارات — يعود إليه بعدها */
const minimums = new Map<string, bigint>();

/** عنوان سعودي: الضريبة مضافة 15% — فللمنصة نصيب ضريبي يجب أن يُحفظ */
const ADDRESS = { recipientName: 'مشترٍ', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 1' };

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

async function login(email: string, totp?: string): Promise<string> {
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD, ...(totp ? { totp } : {}) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tokens.accessToken as string;
}

async function placeOrder(qty: number[], currency = 'JOD') {
  const cart = await call('POST', '/cart', undefined, { currency });
  const token = cart.json().token as string;
  for (const [i, q] of qty.entries()) {
    if (!q) continue;
    const r = await call('POST', '/cart/items', undefined, { variantId: vendors[i]!.variantId, qty: q }, { 'x-cart-token': token });
    expect(r.statusCode, r.body).toBe(201);
  }
  // الإجمالي كما يراه المشتري تحت «ادفع» — يُرسل مع الطلب ولا يُخصم غيره
  const shown = (await call('POST', '/checkout/quote', undefined, { country: ADDRESS.country, region: ADDRESS.region, city: ADDRESS.city }, { 'x-cart-token': token })).json();
  const res = await call('POST', '/checkout', buyer.token, { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: shown.totals.total.minorUnits, expectedCurrency: shown.currency }, {
    'x-cart-token': token,
    'idempotency-key': randomUUID(),
  });
  expect(res.statusCode, res.body).toBe(200);
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: res.json().orderId },
    include: { subOrders: { include: { items: true } } },
  });
  return { order, sub: (i: number) => order.subOrders.find((s) => s.vendorId === vendors[i]!.vendorId)! };
}

async function move(i: number, id: string, to: string, extra: Record<string, unknown> = {}) {
  const r = await call('POST', `/vendor/orders/${id}/transition`, vendors[i]!.token, { to, ...extra });
  expect(r.statusCode, r.body).toBe(200);
}

async function deliver(i: number, id: string) {
  for (const to of ['accepted', 'preparing', 'ready_to_ship']) await move(i, id, to);
  const wb = await call('POST', `/vendor/shipping/waybill/${id}`, vendors[i]!.token);
  await move(i, id, 'shipped', { tracking: wb.json().trackingNumber, carrierCode: wb.json().carrierCode });
  await tracking.record(wb.json().trackingNumber, 'delivered');
}

async function returnOne(i: number, orderNumber: string, subId: string, itemId: string, qty = 1) {
  const req = await call('POST', `/me/orders/${orderNumber}/stores/${subId}/return`, buyer.token, {
    items: [{ orderItemId: itemId, qty }],
    reasonCode: 'damaged',
  });
  expect(req.statusCode, req.body).toBe(201);
  await move(i, subId, 'returned', { returnRequestId: req.json().returnRequestId });
}

const wallet = (i: number) =>
  prisma.wallet.findUniqueOrThrow({ where: { vendorId_currency: { vendorId: vendors[i]!.vendorId, currency: vendors[i]!.currency } } });

/** الأطراف الثلاثة لفرعي، كلٌّ من جدوله */
async function parties(subOrderId: string) {
  const sign = (d: string, a: bigint) => (d === 'credit' ? a : -a);
  const v = await prisma.ledgerEntry.findMany({ where: { refType: 'sub_order', refId: subOrderId } });
  const p = await prisma.platformLedgerEntry.findMany({ where: { subOrderId } });
  const r = await prisma.refund.findMany({ where: { subOrderId, status: { not: 'failed' } } });
  const s = await prisma.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
  return {
    collected: s.totalMinorUnits,
    vendor: v.reduce((a, e) => a + sign(e.direction, e.amountMinorUnits), 0n),
    commission: p.filter((e) => e.entryType === 'commission').reduce((a, e) => a + sign(e.direction, e.amountMinorUnits), 0n),
    platform: p.reduce((a, e) => a + sign(e.direction, e.amountMinorUnits), 0n),
    refunded: r.reduce((a, e) => a + (e.vendorAmountMinorUnits ?? 0n), 0n),
  };
}

const viewCount = async (v: string) =>
  Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${v}"`))[0]!.n);

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات المال الحيّة متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  tracking = app.get(TrackingService);
  release = app.get(ReleaseScheduler);
  finance = app.get(FinanceService);
  ledger = app.get(LedgerService);

  for (const [tag, currency, price] of [['sar', 'SAR', 23_300n], ['jod', 'JOD', 12_345n]] as const) {
    const email = `v${tag}.${SUFFIX}@basta.test`;
    const u = await prisma.user.create({
      data: { email, fullName: `بائع ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
    });
    const vendor = await prisma.vendor.create({
      data: {
        ownerUserId: u.id, slug: `v-${tag}-${SUFFIX}`, nameAr: `متجر ${tag}`, status: 'approved', approvedAt: new Date(),
        settlementCurrency: currency, country: 'SA',
        shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 1_700n } } } },
        bankAccounts: { create: { holderName: `بائع ${tag}`, iban: 'SA0380000000608010167519', bankName: 'بنك تجريبي', isDefault: true, verifiedAt: new Date() } },
      },
    });
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, slug: `p-${tag}-${SUFFIX}`, nameAr: `منتج ${tag}`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendor.id, sku: `SKU-${tag}-${SUFFIX}`.toUpperCase(), priceMinorUnits: price, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 100, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 100, reason: 'import' } });
    vendors.push({ userId: u.id, vendorId: vendor.id, variantId: variant.id, productId: product.id, currency, token: await login(email) });
  }

  const b = await prisma.user.create({
    data: { email: `buyer.${SUFFIX}@basta.test`, fullName: 'مشترٍ', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  buyer = { userId: b.id, token: await login(`buyer.${SUFFIX}@basta.test`) };
  const a = await prisma.user.create({
    data: {
      email: `admin.${SUFFIX}@basta.test`, fullName: 'مدير مال', passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'admin' } },
      permissions: { create: ['payouts.approve', 'commissions.edit', 'orders.manage'].map((permission) => ({ permission })) },
      totpSecretEnc: adminSecret, totpEnabledAt: new Date(),
    },
  });
  admin = { userId: a.id, token: await login(`admin.${SUFFIX}@basta.test`, generateSync({ strategy: 'totp', secret: adminSecret, crypto: totpCrypto, base32: totpBase32 })) };
  // حدّ السحب الأدنى يُفرض منذ VOPS-081: اختبارات الدفتر والتزامن تسحب أرصدة طلباتها الصغيرة،
  // فيُخفض الحدّ لها ويعود كما كان بعدها — وحالة الحدّ نفسها تضبطه بنفسها
  for (const c of await prisma.currency.findMany({ where: { code: { in: ['SAR', 'JOD'] } } })) minimums.set(c.code, c.minPayoutMinorUnits);
  await prisma.currency.updateMany({ where: { code: { in: ['SAR', 'JOD'] } }, data: { minPayoutMinorUnits: 1n } });
}, 120_000);

afterAll(async () => {
  for (const [code, minPayoutMinorUnits] of minimums) await prisma.currency.update({ where: { code }, data: { minPayoutMinorUnits } });
  await app?.close();
  await prisma.$disconnect();
});

describe('بوابة 10 · البند 1 — حفظ المال بالقرش', () => {
  it('بيع ثم إرجاع جزئي ثم إلغاء: لكل فرعي، العمولة + البائع + المُسترد = المقبوض', async () => {
    if (!dbUp) return;
    const { order, sub } = await placeOrder([3, 2]);
    const a = sub(0);
    const b = sub(1);

    // لحظة البيع: لا استرداد، والضريبة المضافة في نصيب المنصة
    for (const s of [a, b]) {
      const p = await parties(s.id);
      expect(p.vendor).toBe(s.vendorNetMinorUnits);
      expect(p.commission).toBe(s.commissionMinorUnits);
      expect(p.platform).toBe(s.commissionMinorUnits + s.taxMinorUnits);
      expect(p.vendor + p.platform + p.refunded).toBe(p.collected);
    }

    await deliver(0, a.id);
    await returnOne(0, order.orderNumber, a.id, a.items[0]!.id);
    await call('POST', `/me/orders/${order.orderNumber}/stores/${b.id}/cancel`, buyer.token, {});

    const pa = await parties(a.id);
    expect(pa.refunded).toBeGreaterThan(0n);
    expect(pa.vendor + pa.platform + pa.refunded).toBe(pa.collected);
    // ثلث العمولة عاد: نصيب قطعة من ثلاث، بالتقريب لأسفل
    expect(pa.commission).toBe(a.commissionMinorUnits - a.items[0]!.commissionMinorUnits / 3n);

    const pb = await parties(b.id);
    expect(pb).toMatchObject({ vendor: 0n, platform: 0n, commission: 0n, refunded: b.totalMinorUnits });

    expect(await viewCount('audit_money_conservation')).toBe(0);
    expect(await viewCount('audit_sub_order_without_ledger')).toBe(0);
    expect(await viewCount('audit_wallet_drift')).toBe(0);
  });

  it('المنظر يكشف قيداً ناقصاً — الحارس يحرس', async () => {
    if (!dbUp) return;
    const { sub } = await placeOrder([1, 0]);
    // استرداد مسجَّل للمشتري بلا قيد يقابله عند البائع ولا المنصة
    const payment = await prisma.payment.findFirstOrThrow({ where: { order: { subOrders: { some: { id: sub(0).id } } } } });
    const ghost = await prisma.refund.create({
      data: { subOrderId: sub(0).id, paymentId: payment.id, amountMinorUnits: 1n, vendorAmountMinorUnits: 1n, reason: 'اختبار الحارس', status: 'failed' },
    });
    expect(await viewCount('audit_money_conservation')).toBe(0); // الفاشل لا يُحسب
    await prisma.refund.update({ where: { id: ghost.id }, data: { status: 'succeeded' } });
    const drift = await prisma.$queryRaw<{ sub_order_id: string }[]>`SELECT sub_order_id FROM audit_money_conservation`;
    expect(drift.map((d) => d.sub_order_id)).toContain(sub(0).id);
    await prisma.refund.update({ where: { id: ghost.id }, data: { status: 'failed' } });
    expect(await viewCount('audit_money_conservation')).toBe(0);
  });

  it('الدفتر لا يُعدَّل ولا يُحذف — في القاعدة لا في التطبيق', async () => {
    if (!dbUp) return;
    const e = await prisma.ledgerEntry.findFirstOrThrow({ where: { vendorId: vendors[0]!.vendorId } });
    await expect(prisma.ledgerEntry.update({ where: { id: e.id }, data: { memo: 'تلاعب' } })).rejects.toThrow();
    await expect(prisma.ledgerEntry.delete({ where: { id: e.id } })).rejects.toThrow();
    const p = await prisma.platformLedgerEntry.findFirstOrThrow({});
    await expect(prisma.platformLedgerEntry.delete({ where: { id: p.id } })).rejects.toThrow();
  });
});

describe('بوابة 10 · البند 2 — لقطة العمولة', () => {
  it('رفع العمولة اليوم لا يمسّ طلب الأمس — ولا إرجاعه بعد التغيير', async () => {
    if (!dbUp) return;
    const { order, sub } = await placeOrder([2, 0]);
    const before = sub(0);
    const before$ = await parties(before.id);

    const set = await call('POST', '/admin/finance/commissions', admin.token, { scope: 'vendor', vendorId: vendors[0]!.vendorId, rateBps: 2500 });
    expect(set.statusCode, set.body).toBe(201);

    // الطلب السابق: الفرعي والسطر والدفتر كما كانت
    const again = await prisma.subOrder.findUniqueOrThrow({ where: { id: before.id }, include: { items: true } });
    expect(again.commissionMinorUnits).toBe(before.commissionMinorUnits);
    expect(again.items[0]!.commissionBpsSnapshot).toBe(before.items[0]!.commissionBpsSnapshot);
    expect((await parties(before.id)).commission).toBe(before$.commission);

    // وإرجاعه بعد التغيير يعكس نصيب العمولة **الملقوطة** لا الجديدة
    await deliver(0, before.id);
    await returnOne(0, order.orderNumber, before.id, before.items[0]!.id);
    expect((await parties(before.id)).commission).toBe(before.commissionMinorUnits - before.items[0]!.commissionMinorUnits / 2n);

    // الطلب الجديد وحده بالنسبة الجديدة
    const next = (await placeOrder([2, 0])).sub(0);
    expect(next.items[0]!.commissionBpsSnapshot).toBe(2500);
    expect(before.items[0]!.commissionBpsSnapshot).not.toBe(2500);

    // القاعدة القديمة أُنهيت ولم تُحذف
    const rules = await prisma.commissionRule.findMany({ where: { scope: 'vendor', vendorId: vendors[0]!.vendorId } });
    expect(rules.some((r) => r.rateBps === 2500 && r.effectiveTo === null)).toBe(true);
    expect(await viewCount('audit_money_conservation')).toBe(0);
  });

  it('نسبة على كل منتج يُباع: المتجر المخصَّص بنسبته وغيره بالعامة، والإلغاء يعيده إلى العامة', async () => {
    if (!dbUp) return;
    const jod = vendors[1]!.vendorId;
    const globalBps = (await prisma.commissionRule.findFirstOrThrow({ where: { scope: 'global', effectiveTo: null } })).rateBps;

    // بلا نسبة خاصة: العامة، أيّاً كان المنتج
    expect((await placeOrder([0, 1])).sub(1).items[0]!.commissionBpsSnapshot).toBe(globalBps);

    const custom = await call('POST', '/admin/finance/commissions', admin.token, { scope: 'vendor', vendorId: jod, rateBps: 300 });
    expect(custom.statusCode, custom.body).toBe(201);
    expect((await placeOrder([0, 1])).sub(1).items[0]!.commissionBpsSnapshot).toBe(300);
    const listed = (await call('GET', '/admin/finance/commissions', admin.token)).json() as { scope: string; vendorId: string | null; rateBps: number }[];
    expect(listed.filter((r) => r.scope === 'vendor' && r.vendorId === jod).map((r) => r.rateBps)).toEqual([300]);

    // الإلغاء يُنهي النسبة الخاصة ولا يحذفها، فيعود المتجر إلى العامة من الآن
    const ended = await call('DELETE', `/admin/finance/commissions/vendor/${jod}`, admin.token);
    expect(ended.statusCode, ended.body).toBe(200);
    expect((await placeOrder([0, 1])).sub(1).items[0]!.commissionBpsSnapshot).toBe(globalBps);
    expect((await call('DELETE', `/admin/finance/commissions/vendor/${jod}`, admin.token)).statusCode).toBe(404);
    const history = await prisma.commissionRule.findMany({ where: { scope: 'vendor', vendorId: jod } });
    expect(history.some((r) => r.rateBps === 300 && r.effectiveTo !== null)).toBe(true);

    // مستوى الفئة أُلغي (14 أكتوبر 2026)
    const byCategory = await call('POST', '/admin/finance/commissions', admin.token, { scope: 'category', rateBps: 500 });
    expect(byCategory.statusCode).toBe(400);
    expect(await viewCount('audit_money_conservation')).toBe(0);
  });

  /**
   * بنطاق متجر الاختبار لا بالعامة: العامة في قاعدة التطوير نسبة صاحبة المشروع، والسباق نفسه
   * على أي نطاق — والقفل لكل نطاق، فنسبة متجر لا تنتظر العامة.
   */
  it('خمسة اعتمادات معاً لنطاق واحد، ثلاث جولات: قاعدة سارية واحدة، والباقي منتهٍ (ACFG-015)', async () => {
    if (!dbUp) return;
    const jod = vendors[1]!.vendorId;
    const live = async () => prisma.commissionRule.findMany({ where: { scope: 'vendor', vendorId: jod, effectiveTo: null } });
    try {
      // جولة واحدة بلا قفل تمرّ أحياناً بالصدفة (جُرّب: مرّت واحدة من ثلاث) — ثلاث جولات لا تمرّ
      for (const [round, rates] of [
        [1, [1200, 1210, 1220, 1230, 1240]],
        [2, [1300, 1310, 1320, 1330, 1340]],
        [3, [1400, 1410, 1420, 1430, 1440]],
      ] as const) {
        const results = await Promise.all(
          rates.map((rateBps) => call('POST', '/admin/finance/commissions', admin.token, { scope: 'vendor', vendorId: jod, rateBps })),
        );
        expect(results.map((r) => r.statusCode)).toEqual(rates.map(() => 201));
        expect(await live(), `الجولة ${round}`).toHaveLength(1);
      }
      const [current] = await live();
      // القائمة والتسعير يقولان الشيء نفسه
      const listed = (await call('GET', '/admin/finance/commissions', admin.token)).json() as { scope: string; vendorId: string | null; rateBps: number }[];
      expect(listed.filter((r) => r.scope === 'vendor' && r.vendorId === jod).map((r) => r.rateBps)).toEqual([current!.rateBps]);
      expect((await placeOrder([0, 1])).sub(1).items[0]!.commissionBpsSnapshot).toBe(current!.rateBps);

      expect((await call('DELETE', `/admin/finance/commissions/vendor/${jod}`, admin.token)).statusCode).toBe(200);
      expect(await live()).toHaveLength(0);
    } finally {
      // فشلٌ في منتصفه لا يترك متجر الاختبار بقواعد مفتوحة
      await prisma.commissionRule.updateMany({ where: { scope: 'vendor', vendorId: jod, effectiveTo: null }, data: { effectiveTo: new Date() } });
    }
  });
});

describe('بوابة 10 · البند 3 — الإرجاع بعد التحرير', () => {
  it('يُخصم من المتاح بقيد موثّق؛ السالب مشروح في القيد، والسحب موقوف حتى يُغطّى', async () => {
    if (!dbUp) return;
    const i = 1; // بائع الدينار
    const { order, sub } = await placeOrder([0, 3]);
    const s = sub(i);
    await deliver(i, s.id);

    // انقضت فترة التعليق (نقدّم الموعد بدل انتظار 14 يوماً) — المشتري ما زال في مهلة الإرجاع
    await prisma.subOrder.update({ where: { id: s.id }, data: { holdReleaseAt: new Date(Date.now() - 60_000) } });
    expect(await release.tick()).toBeGreaterThanOrEqual(1);
    const releasedOut = await prisma.ledgerEntry.findFirstOrThrow({ where: { refId: s.id, entryType: 'hold_release_out' } });
    expect(releasedOut.amountMinorUnits).toBe(s.vendorNetMinorUnits);
    // تحرير ثانٍ لا يقع
    await release.tick();
    expect(await prisma.ledgerEntry.count({ where: { refId: s.id, entryType: 'hold_release_out' } })).toBe(1);

    // البائع يسحب متاحه كله
    const w0 = await wallet(i);
    const asked = new Date();
    const out = await call('POST', '/vendor/finance/payouts', vendors[i]!.token, { currency: 'JOD', amountMinorUnits: w0.balanceAvailableMinorUnits.toString() });
    expect(out.statusCode, out.body).toBe(201);
    // ومن يقرّ السحوبات يعرف أن طلباً ينتظره (19 أكتوبر 2026)
    const told = await prisma.notification.findFirst({
      where: { userId: admin.userId, templateCode: 'admin_payout_requested', channel: 'in_app', createdAt: { gte: asked } },
    });
    expect(told?.payloadJson).toMatchObject({ link: '/admin/payouts' });
    expect((await wallet(i)).balanceAvailableMinorUnits).toBe(0n);

    // ثم يُرجع المشتري قطعة: الخصم من المتاح (مال هذا الطلب حُرِّر)، فيصير سالباً
    await returnOne(i, order.orderNumber, s.id, s.items[0]!.id);
    const debit = await prisma.ledgerEntry.findFirstOrThrow({ where: { refId: s.id, entryType: 'refund_debit' } });
    expect(debit.bucket).toBe('available');
    expect(debit.memo).toMatch(/بعد تحرير الرصيد/);
    expect(debit.memo).toMatch(/سالب/);
    const reversal = await prisma.ledgerEntry.findFirstOrThrow({ where: { refId: s.id, entryType: 'commission_debit', direction: 'credit' } });
    expect(reversal.reversesEntryId).not.toBeNull();

    const w1 = await wallet(i);
    expect(w1.balanceAvailableMinorUnits).toBeLessThan(0n);
    // السالب = الخصم ناقص العمولة المعكوسة بالضبط، لا رقم بلا مصدر
    expect(w1.balanceAvailableMinorUnits).toBe(-(debit.amountMinorUnits - reversal.amountMinorUnits));

    // والسحب ممنوع وهو سالب
    const blocked = await call('POST', '/vendor/finance/payouts', vendors[i]!.token, { currency: 'JOD', amountMinorUnits: '1' });
    expect(blocked.statusCode).toBe(409);
    expect(await viewCount('audit_money_conservation')).toBe(0);
    expect(await viewCount('audit_wallet_drift')).toBe(0);
  });
});

describe('بوابة 10 · البند 4 — السحب المتزامن', () => {
  it('خمسة طلبات سحب للرصيد كله في اللحظة نفسها: واحد يمرّ، والرصيد لا يصير سالباً', async () => {
    if (!dbUp) return;
    const i = 0;
    const { sub } = await placeOrder([2, 0]);
    await deliver(i, sub(i).id);
    await prisma.subOrder.update({ where: { id: sub(i).id }, data: { holdReleaseAt: new Date(Date.now() - 60_000) } });
    await release.tick();

    const available = (await wallet(i)).balanceAvailableMinorUnits;
    expect(available).toBeGreaterThan(0n);
    const payoutsBefore = await prisma.payoutRequest.count({ where: { vendorId: vendors[i]!.vendorId } });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        finance.requestPayout(vendors[i]!.vendorId, vendors[i]!.userId, { currency: 'SAR', amountMinorUnits: available }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const w = await wallet(i);
    expect(w.balanceAvailableMinorUnits).toBe(0n);
    expect(w.balanceWithdrawnMinorUnits).toBeGreaterThanOrEqual(available);
    expect(await prisma.payoutRequest.count({ where: { vendorId: vendors[i]!.vendorId } })).toBe(payoutsBefore + 1);
    expect(await viewCount('audit_withdrawn_drift')).toBe(0);
  });

  it('رفض السحب قيد معاكس يعيد المال — والتحويل بمرجع', async () => {
    if (!dbUp) return;
    const i = 0;
    // بالبحث باسم المتجر — القائمة خمسين خمسين، وطلبات متاجر الاختبار السابقة تملأ أولها
    const list = await call('GET', `/admin/finance/payouts?status=requested&search=${encodeURIComponent('متجر sar')}`, admin.token);
    expect(list.json().items.every((p: { vendor: string; status: string }) => p.vendor.includes('متجر sar') && p.status === 'requested')).toBe(true);
    const mine = list.json().items.filter((p: { vendor: string }) => p.vendor === 'متجر sar');
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const [first] = mine;
    expect(first.bank.ibanLast4).toBe('7519');
    expect(JSON.stringify(first)).not.toContain('SA0380000000608010167519');

    const before = await wallet(i);
    expect((await call('POST', `/admin/finance/payouts/${first.id}/reject`, admin.token, { reason: 'اسم الحساب لا يطابق' })).statusCode).toBe(204);
    const after = await wallet(i);
    expect(after.balanceAvailableMinorUnits).toBe(before.balanceAvailableMinorUnits + BigInt(first.amountMinorUnits));
    const payout = await prisma.payoutRequest.findUniqueOrThrow({ where: { id: first.id } });
    const rev = await prisma.ledgerEntry.findFirstOrThrow({ where: { reversesEntryId: payout.ledgerEntryId! } });
    expect(rev).toMatchObject({ entryType: 'payout_debit', direction: 'credit' });
    // ورفضٌ ثانٍ لا يعيد المال مرتين
    expect((await call('POST', `/admin/finance/payouts/${first.id}/reject`, admin.token, { reason: 'مرة ثانية للتأكد' })).statusCode).toBe(409);

    // دورة كاملة: طلب ← موافقة ← تحويل بمرجع
    const req = await call('POST', '/vendor/finance/payouts', vendors[i]!.token, { currency: 'SAR', amountMinorUnits: '100' });
    expect(req.statusCode, req.body).toBe(201);
    const id = req.json().id as string;
    expect((await call('POST', `/admin/finance/payouts/${id}/paid`, admin.token, { transferReference: 'TRX-1' })).statusCode).toBe(409);
    expect((await call('POST', `/admin/finance/payouts/${id}/approve`, admin.token)).statusCode).toBe(204);
    expect((await call('POST', `/admin/finance/payouts/${id}/paid`, admin.token, { transferReference: 'TRX-2026-0001' })).statusCode).toBe(204);
    expect((await prisma.payoutRequest.findUniqueOrThrow({ where: { id } })).status).toBe('paid');
    expect(await viewCount('audit_withdrawn_drift')).toBe(0);
  });
});

describe('VOPS-081 · حدّ السحب الأدنى بعملة المحفظة (25 أكتوبر 2026)', () => {
  it('يُعرض مع المحفظة، وما تحته يُرفض بلا خصم، وما بلغه يُقبل', async () => {
    if (!dbUp) return;
    const i = 0;
    const { sub } = await placeOrder([2, 0]);
    await deliver(i, sub(i).id);
    await prisma.subOrder.update({ where: { id: sub(i).id }, data: { holdReleaseAt: new Date(Date.now() - 60_000) } });
    await release.tick();
    const available = (await wallet(i)).balanceAvailableMinorUnits;
    // الحدّ دون المتاح بقليل: المتاح كله يبلغه، وما ينقص عنه بوحدة لا يبلغه
    const minimum = available - 1n;
    expect(minimum).toBeGreaterThan(1n);
    await prisma.currency.update({ where: { code: 'SAR' }, data: { minPayoutMinorUnits: minimum } });
    try {
      const shown = await call('GET', '/vendor/finance/wallets', vendors[i]!.token);
      expect(shown.json().find((w: { currency: string }) => w.currency === 'SAR').minPayoutMinorUnits).toBe(minimum.toString());

      const payoutsBefore = await prisma.payoutRequest.count({ where: { vendorId: vendors[i]!.vendorId } });
      const below = await call('POST', '/vendor/finance/payouts', vendors[i]!.token, { currency: 'SAR', amountMinorUnits: (minimum - 1n).toString() });
      expect(below.statusCode).toBe(409);
      expect(below.json()).toMatchObject({ code: 'BELOW_MINIMUM_PAYOUT', message: expect.stringMatching(/^الحد الأدنى للسحب .* — رصيدك يتراكم حتى يتجاوزه، ولا يضيع منه شيء\.$/) });
      expect((await wallet(i)).balanceAvailableMinorUnits).toBe(available);
      expect(await prisma.payoutRequest.count({ where: { vendorId: vendors[i]!.vendorId } })).toBe(payoutsBefore);

      const atMinimum = await call('POST', '/vendor/finance/payouts', vendors[i]!.token, { currency: 'SAR', amountMinorUnits: minimum.toString() });
      expect(atMinimum.statusCode, atMinimum.body).toBe(201);
      expect((await wallet(i)).balanceAvailableMinorUnits).toBe(1n);
    } finally {
      await prisma.currency.update({ where: { code: 'SAR' }, data: { minPayoutMinorUnits: 1n } });
    }
  });
});

describe('بوابة 10 · البند 5 — كشف الحساب يطابق الدفتر', () => {
  it('كل قيد سطر، والرصيد الختامي = المحفظة = مجموع الدفتر، والتصدير بعدد الأسطر نفسه', async () => {
    if (!dbUp) return;
    for (const [i, v] of vendors.entries()) {
      const res = await call('GET', `/vendor/finance/statement?currency=${v.currency}`, v.token);
      expect(res.statusCode, res.body).toBe(200);
      const st = res.json();
      const entries = await prisma.ledgerEntry.findMany({ where: { vendorId: v.vendorId, currency: v.currency } });
      expect(st.rows).toHaveLength(entries.length);
      expect(new Set(st.rows.map((r: { id: string }) => r.id))).toEqual(new Set(entries.map((e) => e.id)));

      const sum = (bucket: string) =>
        entries.filter((e) => e.bucket === bucket).reduce((a, e) => a + (e.direction === 'credit' ? e.amountMinorUnits : -e.amountMinorUnits), 0n);
      const w = await wallet(i);
      expect(BigInt(st.closing.pendingMinorUnits)).toBe(sum('pending'));
      expect(BigInt(st.closing.availableMinorUnits)).toBe(sum('available'));
      expect(BigInt(st.closing.pendingMinorUnits)).toBe(w.balancePendingMinorUnits);
      expect(BigInt(st.closing.availableMinorUnits)).toBe(w.balanceAvailableMinorUnits);

      // كل سطر: الرصيد بعده = قبله ± مبلغه
      let p = 0n;
      let a = 0n;
      for (const r of st.rows) {
        const s = r.direction === 'credit' ? BigInt(r.amountMinorUnits) : -BigInt(r.amountMinorUnits);
        if (r.bucket === 'pending') p += s;
        else a += s;
        expect(BigInt(r.pendingAfter)).toBe(p);
        expect(BigInt(r.availableAfter)).toBe(a);
      }

      const csv = await call('GET', `/vendor/finance/statement.csv?currency=${v.currency}`, v.token);
      expect(csv.statusCode).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.body.trim().split('\r\n')).toHaveLength(entries.length + 1);
    }
  });

  it('الكشف صفحات بالمؤشّر: الصفحات معاً = الكشف كله بأرصدته، والمدة لا تحمّل ما قبلها', async () => {
    if (!dbUp) return;
    const v = vendors[0]!;
    const whole = await finance.statement(v.vendorId, v.currency);
    expect(whole.rows.length).toBeGreaterThan(2);
    expect(whole.nextCursor).toBeNull();

    // صفحتان سطران سطران حتى النهاية — المؤشّر يمرّ بكل قيد مرة، والرصيد يكمل من الصفحة السابقة
    const paged: typeof whole.rows = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await finance.statement(v.vendorId, v.currency, {}, cursor, 2);
      expect(page.rows.length).toBeLessThanOrEqual(2);
      expect(page.closing).toEqual(whole.closing);
      paged.push(...page.rows);
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 1000);
    expect(pages).toBe(Math.ceil(whole.rows.length / 2));
    expect(paged).toEqual(whole.rows);

    // مدة بعد آخر قيد: لا أسطر، والافتتاحي مجموع ما قبلها في القاعدة
    const tomorrow = new Date(Date.now() + 86_400_000);
    const later = await finance.statement(v.vendorId, v.currency, { from: tomorrow });
    expect(later.rows).toHaveLength(0);
    expect(later.opening).toEqual(whole.closing);
    expect(later.closing).toEqual(whole.closing);

    // مدة أطول من سنة تُرفض، ومؤشّر بائع آخر لا يُقبل
    expect((await call('GET', `/vendor/finance/statement?currency=${v.currency}&from=2024-01-01&to=2026-01-01`, v.token)).statusCode).toBe(400);
    // والتصدير كذلك — رسالة JSON لا 500 مع أن المسار يعلن CSV
    const longCsv = await call('GET', `/vendor/finance/statement.csv?currency=${v.currency}&from=2024-01-01&to=2026-01-01`, v.token);
    expect(longCsv.statusCode, longCsv.body).toBe(400);
    expect(longCsv.headers['content-type']).toContain('application/json');
    const foreign = await prisma.ledgerEntry.findFirstOrThrow({ where: { vendorId: { not: v.vendorId } }, select: { id: true } });
    expect((await call('GET', `/vendor/finance/statement?currency=${v.currency}&cursor=${foreign.id}`, v.token)).statusCode).toBe(400);
  });

  it('بائع لا يرى كشف غيره، ولا يطلب سحباً من محفظة غيره', async () => {
    if (!dbUp) return;
    const other = await call('GET', `/vendor/finance/statement?currency=JOD`, vendors[0]!.token);
    expect(other.json().rows ?? []).toHaveLength(0);
    expect((await call('GET', '/vendor/finance/wallets', buyer.token)).statusCode).toBe(403);
  });
});

describe('تحرير الأرصدة لا يتجوّع بالمسترَدّ كله', () => {
  /** بائع شحنه مجاني: إرجاع كل قطعة يترك معلّقه صفراً — الحالة التي كانت تسدّ الطابور */
  async function freeShippingVendor(): Promise<number> {
    const tag = `free${Date.now()}`;
    const email = `v${tag}.${SUFFIX}@basta.test`;
    const u = await prisma.user.create({
      data: { email, fullName: 'بائع شحن مجاني', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
    });
    const v = await prisma.vendor.create({
      data: {
        ownerUserId: u.id, slug: `v-${tag}-${SUFFIX}`, nameAr: 'متجر الشحن المجاني', status: 'approved', approvedAt: new Date(),
        settlementCurrency: 'JOD', country: 'SA',
        shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 0n } } } },
        bankAccounts: { create: { holderName: 'بائع', iban: 'SA0380000000608010167519', bankName: 'بنك', isDefault: true, verifiedAt: new Date() } },
      },
    });
    const product = await prisma.product.create({
      data: { vendorId: v.id, slug: `p-${tag}-${SUFFIX}`, nameAr: 'منتج بشحن مجاني', status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: v.id, sku: `SKU-${tag}`.toUpperCase(), priceMinorUnits: 5_000n, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 20, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 20, reason: 'import' } });
    vendors.push({ userId: u.id, vendorId: v.id, variantId: variant.id, productId: product.id, currency: 'JOD', token: await login(email) });
    return vendors.length - 1;
  }
  const pendingNet = async (subId: string) =>
    (await prisma.ledgerEntry.findMany({ where: { refType: 'sub_order', refId: subId, bucket: 'pending' } })).reduce(
      (a, r) => a + (r.direction === 'credit' ? r.amountMinorUnits : -r.amountMinorUnits),
      0n,
    );

  it('مسترَدّان كلياً أقدم من فرعي عادي، والدفعة بحجمهما: يُحسمان مرة ثم يُحرَّر العادي', async () => {
    if (!dbUp) return;
    const f = await freeShippingVendor();
    const zeros: string[] = [];
    for (let k = 0; k < 2; k++) {
      const qty = vendors.map((_, idx) => (idx === f ? 1 : 0));
      const { order, sub } = await placeOrder(qty);
      const s = sub(f);
      await deliver(f, s.id);
      await returnOne(f, order.orderNumber, s.id, s.items[0]!.id, 1);
      expect(await pendingNet(s.id)).toBe(0n);
      zeros.push(s.id);
    }
    const { sub } = await placeOrder([1, 0]);
    const normal = sub(0);
    await deliver(0, normal.id);

    // المسترَدّان أقدم موعداً — كانا يتصدّران كل دفعة إلى الأبد
    const day = 86_400_000;
    for (const [k, id] of zeros.entries()) {
      await prisma.subOrder.update({ where: { id }, data: { holdReleaseAt: new Date(Date.now() - (10 - k) * day) } });
    }
    await prisma.subOrder.update({ where: { id: normal.id }, data: { holdReleaseAt: new Date(Date.now() - 5 * day) } });

    await release.tick(new Date(), 2);
    for (const id of zeros) {
      expect((await prisma.subOrder.findUniqueOrThrow({ where: { id } })).holdSettledAt).not.toBeNull();
    }
    await release.tick(new Date(), 2);
    expect(await prisma.ledgerEntry.count({ where: { refId: normal.id, entryType: 'hold_release_out' } })).toBe(1);
    expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: normal.id } })).holdSettledAt).not.toBeNull();
    // المسترَدّ كله لا يُكتب له قيد تحرير بصفر، ولا يعود إلى الطابور
    for (const id of zeros) expect(await prisma.ledgerEntry.count({ where: { refId: id, entryType: 'hold_release_out' } })).toBe(0);
    expect(await viewCount('audit_wallet_drift')).toBe(0);
  });
});

/**
 * موجة «يُؤتمت» · الدفعة 2 — ما لا تقدر عليه يد في المتصفّح: مديران يضغطان في اللحظة نفسها، وإجراء
 * على طلب سحب ليس في حالته، ونسختان من مهمة التحرير على فرعي واحد. كل محفظة هنا لمتجر الاختبار:
 * يُحرَّر فرعيّه وحده (لا دورة المهمة على القاعدة كلها، فأرصدة التجربة اليدوية لا تُمسّ).
 */
describe('السحب والتحرير تحت التزامن (موجة «يُؤتمت» · الدفعة 2، 2 نوفمبر 2026)', () => {
  const STATE = 'حالة الطلب لا تسمح بهذا الإجراء.';
  const PAID = 'لا يُرفض إلا طلب لم يُحوَّل بعد.';

  /** فرعي مسلَّم انقضى تعليقه — للبائع 0 */
  async function due(qty = 2) {
    const { sub } = await placeOrder([qty, 0]);
    await deliver(0, sub(0).id);
    await prisma.subOrder.update({ where: { id: sub(0).id }, data: { holdReleaseAt: new Date(Date.now() - 60_000) } });
    return sub(0).id;
  }
  const releaseOne = (subOrderId: string) => prisma.$transaction((tx) => ledger.release(tx as never, subOrderId));
  const request = async () => {
    const r = await call('POST', '/vendor/finance/payouts', vendors[0]!.token, { currency: 'SAR', amountMinorUnits: '100' });
    expect(r.statusCode, r.body).toBe(201);
    return r.json().id as string;
  };
  const act = (id: string, what: 'approve' | 'paid' | 'reject', token = admin.token) =>
    call('POST', `/admin/finance/payouts/${id}/${what}`, token, what === 'paid' ? { transferReference: `TRX-${id.slice(0, 8)}` } : what === 'reject' ? { reason: 'اسم الحساب لا يطابق' } : undefined);
  const reversals = async (id: string) => {
    const p = await prisma.payoutRequest.findUniqueOrThrow({ where: { id } });
    return prisma.ledgerEntry.count({ where: { reversesEntryId: p.ledgerEntryId! } });
  };
  const balances = async () => {
    const w = await wallet(0);
    return [w.balancePendingMinorUnits, w.balanceAvailableMinorUnits, w.balanceWithdrawnMinorUnits];
  };

  it('انتقالات السحب غير المسموحة: 409 أو 404 برسالتها، ولا قيد ولا تغيّر في المحفظة (ADM-084)', async () => {
    if (!dbUp) return;
    await releaseOne(await due());
    const requested = await request();
    const approved = await request();
    expect((await act(approved, 'approve')).statusCode).toBe(204);
    const paid = await request();
    expect((await act(paid, 'approve')).statusCode).toBe(204);
    expect((await act(paid, 'paid')).statusCode).toBe(204);

    const before = await balances();
    const entries = await prisma.ledgerEntry.count({ where: { vendorId: vendors[0]!.vendorId } });

    const early = await act(requested, 'paid');
    expect(early.statusCode).toBe(409);
    expect(early.json().message).toBe(STATE);
    const twice = await act(approved, 'approve');
    expect(twice.statusCode).toBe(409);
    expect(twice.json().message).toBe(STATE);
    const late = await act(paid, 'reject');
    expect(late.statusCode).toBe(409);
    expect(late.json().message).toBe(PAID);
    expect(await reversals(paid)).toBe(0);

    const ghost = await act(randomUUID(), 'approve');
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().message).toBe('طلب السحب غير موجود.');
    expect((await act(randomUUID(), 'reject')).json().message).toBe('طلب السحب غير موجود.');
    const junk = await call('POST', '/admin/finance/payouts/abc/approve', admin.token);
    expect(junk.statusCode).toBe(404);
    expect(junk.json().message).toBe('المورد غير موجود.');

    expect(await balances()).toEqual(before);
    expect(await prisma.ledgerEntry.count({ where: { vendorId: vendors[0]!.vendorId } })).toBe(entries);
    const statuses = await prisma.payoutRequest.findMany({ where: { id: { in: [requested, approved, paid] } }, select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map((p) => [p.id, p.status]))).toEqual({ [requested]: 'requested', [approved]: 'approved', [paid]: 'paid' });

    // لا يبقى طلب اختبار في طابور سحوبات الإدارة
    for (const id of [requested, approved]) expect((await act(id, 'reject')).statusCode).toBe(204);
  });

  it('موافقتان من مديرين معاً، وتحويل ورفض معاً: أثر واحد ودفتر سليم (ADM-085)', async () => {
    if (!dbUp) return;
    const email = `admin2.${SUFFIX}@basta.test`;
    const second = await prisma.user.create({
      data: {
        email, fullName: 'مدير مال ثانٍ', passwordHash: await hashPassword(PASSWORD),
        roles: { create: { role: 'admin' } },
        permissions: { create: [{ permission: 'payouts.approve' }] },
        totpSecretEnc: adminSecret, totpEnabledAt: new Date(),
      },
    });
    try {
      const other = await login(email, generateSync({ strategy: 'totp', secret: adminSecret, crypto: totpCrypto, base32: totpBase32 }));
      await releaseOne(await due());

      const p = await request();
      const approvals = await Promise.all([act(p, 'approve'), act(p, 'approve', other)]);
      expect(approvals.map((r) => r.statusCode).sort()).toEqual([204, 409]);
      expect(approvals.find((r) => r.statusCode === 409)!.json().message).toBe(STATE);
      expect(await prisma.auditLog.count({ where: { entityId: p, action: 'payout.approve' } })).toBe(1);
      expect(await prisma.payoutRequest.findUniqueOrThrow({ where: { id: p } })).toMatchObject({ status: 'approved' });
      expect((await act(p, 'reject')).statusCode).toBe(204); // تنظيف

      // ثلاث جولات: الفائز يتبدّل، وكل جولة تُفحص على من فاز فيها
      for (let round = 0; round < 3; round++) {
        const id = await request();
        expect((await act(id, 'approve')).statusCode).toBe(204);
        const [available] = (await balances()).slice(1);
        const [paid, rejected] = await Promise.all([act(id, 'paid'), act(id, 'reject', other)]);
        expect([paid.statusCode, rejected.statusCode].sort()).toEqual([204, 409]);
        const row = await prisma.payoutRequest.findUniqueOrThrow({ where: { id } });
        if (paid.statusCode === 204) {
          expect(rejected.json().message).toBe(PAID);
          expect(row.status).toBe('paid');
          expect(await reversals(id)).toBe(0);
          expect((await wallet(0)).balanceAvailableMinorUnits).toBe(available);
        } else {
          expect(paid.json().message).toBe(STATE);
          expect(row.status).toBe('rejected');
          expect(await reversals(id)).toBe(1);
          expect((await wallet(0)).balanceAvailableMinorUnits).toBe(available! + row.amountMinorUnits);
        }
      }
      const w = await wallet(0);
      expect(w.balanceAvailableMinorUnits).toBeGreaterThanOrEqual(0n);
      expect(await viewCount('audit_wallet_drift')).toBe(0);
      expect(await viewCount('audit_withdrawn_drift')).toBe(0);
    } finally {
      await prisma.user.update({ where: { id: second.id }, data: { status: 'suspended' } });
    }
  });

  it('تحرير الفرعي من نسختين معاً: زوج قيود واحد — والقاعدة ترفض قيد تحرير أو بيع ثانياً (SYS-021)', async () => {
    if (!dbUp) return;
    const id = await due(1);
    const pending = (await prisma.ledgerEntry.findMany({ where: { refId: id, bucket: 'pending' } })).reduce(
      (s, e) => s + (e.direction === 'credit' ? e.amountMinorUnits : -e.amountMinorUnits),
      0n,
    );
    expect(pending).toBeGreaterThan(0n);
    const before = (await wallet(0)).balanceAvailableMinorUnits;

    // ما تفعله دورة كل نسخة لهذا الفرعي، خمس مرات في اللحظة نفسها
    const raced = await Promise.allSettled(Array.from({ length: 5 }, () => releaseOne(id)));
    const moved = raced.filter((r): r is PromiseFulfilledResult<bigint> => r.status === 'fulfilled' && r.value > 0n);
    expect(moved).toHaveLength(1);
    expect(await prisma.ledgerEntry.count({ where: { refId: id, entryType: 'hold_release_out' } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { refId: id, entryType: 'hold_release_in' } })).toBe(1);
    expect((await wallet(0)).balanceAvailableMinorUnits).toBe(before + pending);
    expect(await viewCount('audit_wallet_drift')).toBe(0);

    /**
     * قيد ثانٍ يُكتب في القاعدة مباشرة (كما لو سها عنه التطبيق): الفهرس الفريد يرفضه. داخل معاملة
     * تُتراجع دائماً — الدفتر لا يُحذف منه، فلو قُبل الإدراج لما بقي منه أثر على قاعدة التطوير.
     */
    const ROLLBACK = new Error('تراجع');
    const duplicate = async (entryType: 'hold_release_out' | 'sale_credit', refId: string) => {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO "ledger_entries" ("id", "walletId", "vendorId", "currency", "entryType", "direction", "amountMinorUnits", "bucket", "refType", "refId", "memo")
             SELECT gen_random_uuid(), "walletId", "vendorId", "currency", "entryType", "direction", "amountMinorUnits", "bucket", "refType", "refId", 'قيد مكرّر — اختبار'
             FROM "ledger_entries" WHERE "refId" = $1::uuid AND "entryType" = '${entryType}' AND "reversesEntryId" IS NULL LIMIT 1`,
            refId,
          );
          throw ROLLBACK;
        });
      } catch (err) {
        return err === ROLLBACK ? 'قُبل' : (err as Error).message;
      }
      return 'قُبل';
    };
    // 23505 تفرّد على refId: الفهرسان الجزئيان ledger_one_release_per_sub_order و ledger_one_sale_per_sub_order
    // وحدهما على هذا العمود (المعرّف الجديد عشوائي) — كلٌّ لنوع قيده
    const UNIQUE_REF = /23505[\s\S]*Key \(\\?"refId\\?"\)/;
    expect(await duplicate('hold_release_out', id)).toMatch(UNIQUE_REF);
    const { sub } = await placeOrder([1, 0]);
    expect(await prisma.ledgerEntry.count({ where: { refId: sub(0).id, entryType: 'sale_credit' } })).toBe(1);
    expect(await duplicate('sale_credit', sub(0).id)).toMatch(UNIQUE_REF);
    expect(await prisma.ledgerEntry.count({ where: { refId: { in: [id, sub(0).id] }, memo: 'قيد مكرّر — اختبار' } })).toBe(0);
  });

  /**
   * عيب كشفه CHK-029: قيد البيع = القطع ناقص خصم يموّله البائع، فكوبونه الثابت بقيمة القطعة كلها
   * يجعله صفراً فلا يُكتب، ويبقى قيد الشحن وحده. المهمة كانت تشترط قيد البيع فلا تحرّر الشحن أبداً،
   * والمنظر يسمّيه «طلب مدفوع بلا قيد بيع» فتُنبَّه الإدارة كل يوم عن طلب سليم.
   */
  it('كوبون يموّله البائع بقيمة القطعة كلها: يُحرَّر شحنه، ولا يُعدّ «بلا قيد بيع» (CHK-029)', async () => {
    if (!dbUp) return;
    const i = 1; // متجر الدينار — القطعة 12.345 والشحن 1.700
    const coupon = await prisma.coupon.create({
      data: { code: `ALL-${SUFFIX}`.toUpperCase(), scope: 'vendor', vendorId: vendors[i]!.vendorId, type: 'fixed', valueMinorUnits: 20_000n, currency: 'JOD', fundedBy: 'vendor' },
    });
    try {
      const cart = (await call('POST', '/cart', undefined, { currency: 'JOD' })).json().token as string;
      const headers = { 'x-cart-token': cart };
      expect((await call('POST', '/cart/items', undefined, { variantId: vendors[i]!.variantId, qty: 1 }, headers)).statusCode).toBe(201);
      expect((await call('PUT', '/cart/coupon', undefined, { code: coupon.code }, headers)).statusCode).toBe(200);
      const shown = (await call('POST', '/checkout/quote', undefined, { country: ADDRESS.country, region: ADDRESS.region, city: ADDRESS.city }, headers)).json();
      const res = await call('POST', '/checkout', buyer.token, { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: shown.totals.total.minorUnits, expectedCurrency: shown.currency }, {
        ...headers,
        'idempotency-key': randomUUID(),
      });
      expect(res.statusCode, res.body).toBe(200);
      const sub = await prisma.subOrder.findFirstOrThrow({ where: { orderId: res.json().orderId } });
      expect(sub).toMatchObject({ discountMinorUnits: 12_345n, totalMinorUnits: 1_700n, vendorNetMinorUnits: 1_700n });

      // البيع صفر فلا قيد له، والشحن قيده — ولا يراه المنظر «مدفوعاً بلا قيد بيع»
      const kinds = (await prisma.ledgerEntry.findMany({ where: { refId: sub.id }, select: { entryType: true } })).map((e) => e.entryType);
      expect(kinds).toEqual(['shipping_credit']);
      expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM audit_sub_order_without_ledger WHERE sub_order_id = ${sub.id}::uuid`).toEqual([]);

      await deliver(i, sub.id);
      await prisma.subOrder.update({ where: { id: sub.id }, data: { holdReleaseAt: new Date(Date.now() - 60_000) } });
      const before = (await wallet(i)).balanceAvailableMinorUnits;
      // دورة المهمة نفسها — شرط اختيارها هو موضع العيب
      await release.tick();
      const out = await prisma.ledgerEntry.findMany({ where: { refId: sub.id, entryType: 'hold_release_out' } });
      expect(out.map((e) => e.amountMinorUnits)).toEqual([1_700n]);
      expect((await wallet(i)).balanceAvailableMinorUnits).toBe(before + 1_700n);
      expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM audit_money_conservation WHERE sub_order_id = ${sub.id}::uuid`).toEqual([]);
      expect(await viewCount('audit_wallet_drift')).toBe(0);
    } finally {
      await prisma.coupon.update({ where: { id: coupon.id }, data: { isActive: false } });
    }
  });
});

/**
 * موجة «يُؤتمت» الرابعة (3 نوفمبر 2026): صيغ المال على الخادم — طلب السحب (VOPS-082) ومرجع
 * التحويل (ADM-082)، بلا قيد ولا طلب عند أي رفض.
 */
describe('صيغ طلب السحب ومرجع التحويل — يُؤتمت 4', () => {
  const messages = (res: { json: () => { message?: string | string[] } }) => [res.json().message].flat();

  it('المبلغ عدد صحيح موجب بالوحدات الصغرى نصّاً، والعملة ثلاثة أحرف كبيرة — ولا قيد ولا طلب (VOPS-082)', async () => {
    if (!dbUp) return;
    const i = 0;
    const payouts = () => prisma.payoutRequest.count({ where: { vendorId: vendors[i]!.vendorId } });
    // المحفظة تُنشأ مع أول قيد — قد لا توجد حين يجري هذا الاختبار وحده
    const available = async () =>
      (await prisma.wallet.findUnique({ where: { vendorId_currency: { vendorId: vendors[i]!.vendorId, currency: vendors[i]!.currency } } }))?.balanceAvailableMinorUnits ?? 0n;
    const before = { payouts: await payouts(), available: await available() };
    for (const amount of ['0', '-100', '1.5', 100, '12345678901234567']) {
      const res = await call('POST', '/vendor/finance/payouts', vendors[i]!.token, { currency: 'SAR', amountMinorUnits: amount });
      expect(res.statusCode, `${JSON.stringify(amount)}: ${res.body}`).toBe(400);
      expect(messages(res), JSON.stringify(amount)).toContain('المبلغ عدد صحيح موجب بالوحدات الصغرى.');
    }
    const lower = await call('POST', '/vendor/finance/payouts', vendors[i]!.token, { currency: 'sar', amountMinorUnits: '100' });
    expect(lower.statusCode, lower.body).toBe(400);
    expect(messages(lower)).toContain('أحد الحقول: صيغة غير صحيحة.');
    expect(await payouts()).toBe(before.payouts);
    expect(await available()).toBe(before.available);
  });

  it('مرجع التحويل 3–120 حرفاً بعد القصّ: «ab» و«   ab» و121 تُرفض والطلب «معتمد»، و3 أحرف «حُوِّل» (ADM-082)', async () => {
    if (!dbUp) return;
    const i = 0;
    // رصيد يكفي سحباً واحداً من هذا الاختبار وحده
    const { sub } = await placeOrder([1, 0]);
    await deliver(i, sub(i).id);
    await prisma.subOrder.update({ where: { id: sub(i).id }, data: { holdReleaseAt: new Date(Date.now() - 60_000) } });
    await release.tick();
    const req = await call('POST', '/vendor/finance/payouts', vendors[i]!.token, { currency: 'SAR', amountMinorUnits: '100' });
    expect(req.statusCode, req.body).toBe(201);
    const id = req.json().id as string;
    expect((await call('POST', `/admin/finance/payouts/${id}/approve`, admin.token)).statusCode).toBe(204);
    const paid = (transferReference: string) => call('POST', `/admin/finance/payouts/${id}/paid`, admin.token, { transferReference });

    for (const [reference, message] of [
      ['ab', 'مرجع التحويل: 3 أحرف على الأقل.'],
      ['   ab', 'مرجع التحويل مطلوب.'],
      ['x'.repeat(121), 'مرجع التحويل: 120 حرفاً على الأكثر.'],
    ] as const) {
      const res = await paid(reference);
      expect(res.statusCode, `${JSON.stringify(reference)}: ${res.body}`).toBe(400);
      expect(messages(res), JSON.stringify(reference)).toContain(message);
      expect((await prisma.payoutRequest.findUniqueOrThrow({ where: { id } })).status).toBe('approved');
    }
    expect((await paid('abc')).statusCode).toBe(204);
    const done = await prisma.payoutRequest.findUniqueOrThrow({ where: { id } });
    expect(done.status).toBe('paid');
    expect(done.transferReference).toBe('abc');
  });
});
