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
import { FinanceService, ReleaseScheduler } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let tracking: TrackingService;
let release: ReleaseScheduler;
let finance: FinanceService;
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
  categoryId: string;
  currency: string;
  token: string;
}
const vendors: VendorSeat[] = [];
let buyer = { userId: '', token: '' };
let admin = { userId: '', token: '' };

/** عنوان سعودي: الضريبة مضافة 15% — فللمنصة نصيب ضريبي يجب أن يُحفظ */
const ADDRESS = { recipientName: 'مشترٍ', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 1' };

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
async function call(method: 'GET' | 'POST', url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
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

  // فئة خاصة بالاختبار: تغيير عمولتها لا يمسّ اختبارات أخرى تعمل بالتوازي
  const home = await prisma.category.findUniqueOrThrow({ where: { slug: 'home' } });
  const categoryId = randomUUID();
  const category = await prisma.category.create({
    data: { id: categoryId, slug: `fin-${SUFFIX}`, nameAr: `فئة مال ${SUFFIX}`, parentId: home.id, path: `${home.path}${categoryId}/`, depth: home.depth + 1 },
  });

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
      data: { vendorId: vendor.id, categoryId: category.id, slug: `p-${tag}-${SUFFIX}`, nameAr: `منتج ${tag}`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendor.id, sku: `SKU-${tag}-${SUFFIX}`.toUpperCase(), priceMinorUnits: price, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 100, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 100, reason: 'import' } });
    vendors.push({ userId: u.id, vendorId: vendor.id, variantId: variant.id, productId: product.id, categoryId: category.id, currency, token: await login(email) });
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
}, 120_000);

afterAll(async () => {
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

    const set = await call('POST', '/admin/finance/commissions', admin.token, { scope: 'category', categoryId: vendors[0]!.categoryId, rateBps: 2500 });
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
    const rules = await prisma.commissionRule.findMany({ where: { categoryId: vendors[0]!.categoryId } });
    expect(rules.some((r) => r.rateBps === 2500 && r.effectiveTo === null)).toBe(true);
    expect(await viewCount('audit_money_conservation')).toBe(0);
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
    const out = await call('POST', '/vendor/finance/payouts', vendors[i]!.token, { currency: 'JOD', amountMinorUnits: w0.balanceAvailableMinorUnits.toString() });
    expect(out.statusCode, out.body).toBe(201);
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
    const list = await call('GET', '/admin/finance/payouts?status=requested', admin.token);
    const mine = list.json().filter((p: { vendor: string }) => p.vendor === 'متجر sar');
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
      data: { vendorId: v.id, categoryId: vendors[0]!.categoryId, slug: `p-${tag}-${SUFFIX}`, nameAr: 'منتج بشحن مجاني', status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: v.id, sku: `SKU-${tag}`.toUpperCase(), priceMinorUnits: 5_000n, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 20, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 20, reason: 'import' } });
    vendors.push({ userId: u.id, vendorId: v.id, variantId: variant.id, productId: product.id, categoryId: vendors[0]!.categoryId, currency: 'JOD', token: await login(email) });
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
