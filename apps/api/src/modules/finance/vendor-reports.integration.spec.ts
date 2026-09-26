/**
 * VD-19 — تقارير البائع عبر الواجهة البرمجية الحيّة.
 *
 * سيناريو معروف: طلب واحد فيه متجران؛ أ يبيع 3 قطع بـ 100.00 ر.س ويشحن بـ
 * 15.00، ثم يُسلَّم ويُرجَع منه قطعة؛ ب يبيع قطعتين ولا يُرجع شيئاً.
 *
 * ما يُثبَت: أرقام أ هي أرقام دفتره بالقرش (المبيعات، الشحن، العمولة بعد
 * عكس القطعة المرتجعة، المرتجعات، الصافي)، وعدّ الطلبات وحالاتها ونسبة
 * الإرجاع والأكثر مبيعاً — وأنّ أ لا يرى شيئاً من أرقام ب ولا العكس.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { TrackingService } from '../shipping/public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let tracking: TrackingService;
let dbUp = false;

const SUFFIX = `vrp${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const ADDRESS = { recipientName: 'مشترٍ', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 1' };

interface Seat {
  userId: string;
  vendorId: string;
  variantId: string;
  productId: string;
  token: string;
}
const seats: Seat[] = [];
let buyerToken = '';
let aSubId = '';
const today = new Date().toISOString().slice(0, 10);

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
async function call(method: 'GET' | 'POST', url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

async function login(email: string): Promise<string> {
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tokens.accessToken as string;
}

async function move(i: number, id: string, to: string, extra: Record<string, unknown> = {}) {
  const r = await call('POST', `/vendor/orders/${id}/transition`, seats[i]!.token, { to, ...extra });
  expect(r.statusCode, r.body).toBe(200);
}

const report = async (i: number, from = today, to = today) => {
  const res = await call('GET', `/vendor/reports?from=${from}&to=${to}`, seats[i]!.token);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

/** مجموع قيود نوعٍ لبائع من الدفتر مباشرة — المرجع المستقلّ للمقارنة */
async function ledgerNet(vendorId: string, types: string[]): Promise<bigint> {
  const rows = await prisma.ledgerEntry.findMany({ where: { vendorId, entryType: { in: types as never[] } } });
  return rows.reduce((a, e) => a + (e.direction === 'credit' ? e.amountMinorUnits : -e.amountMinorUnits), 0n);
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات تقارير البائع متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  tracking = app.get(TrackingService);

  const home = await prisma.category.findUniqueOrThrow({ where: { slug: 'home' } });
  for (const tag of ['a', 'b']) {
    const email = `rep${tag}.${SUFFIX}@basta.test`;
    const u = await prisma.user.create({
      data: { email, fullName: `بائع تقارير ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
    });
    const vendor = await prisma.vendor.create({
      data: {
        ownerUserId: u.id, slug: `rep-${tag}-${SUFFIX}`, nameAr: `متجر تقارير ${tag} ${SUFFIX}`, status: 'approved', approvedAt: new Date(),
        settlementCurrency: 'SAR', country: 'SA',
        shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 1_500n } } } },
      },
    });
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, categoryId: home.id, slug: `rep-${tag}-${SUFFIX}`, nameAr: `منتج تقارير ${tag}`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendor.id, sku: `VRP-${tag}-${SUFFIX}`.toUpperCase(), priceMinorUnits: 10_000n, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 50, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 50, reason: 'import' } });
    seats.push({ userId: u.id, vendorId: vendor.id, variantId: variant.id, productId: product.id, token: await login(email) });
  }
  await prisma.user.create({
    data: { email: `repc.${SUFFIX}@basta.test`, fullName: 'مشترٍ', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  buyerToken = await login(`repc.${SUFFIX}@basta.test`);

  // الطلب: 3 من أ و 2 من ب
  const cart = await call('POST', '/cart', undefined, { currency: 'SAR' });
  const token = cart.json().token as string;
  for (const [i, qty] of [[0, 3], [1, 2]] as const) {
    const r = await call('POST', '/cart/items', undefined, { variantId: seats[i]!.variantId, qty }, { 'x-cart-token': token });
    expect(r.statusCode, r.body).toBe(201);
  }
  const placed = await call('POST', '/checkout', buyerToken, { address: ADDRESS, paymentToken: 'tok_success' }, {
    'x-cart-token': token,
    'idempotency-key': randomUUID(),
  });
  expect(placed.statusCode, placed.body).toBe(200);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.json().orderId }, include: { subOrders: { include: { items: true } } } });
  const aSub = order.subOrders.find((s) => s.vendorId === seats[0]!.vendorId)!;
  aSubId = aSub.id;

  // أ: تسليم ثم إرجاع قطعة
  for (const to of ['accepted', 'preparing', 'ready_to_ship']) await move(0, aSub.id, to);
  const wb = await call('POST', `/vendor/shipping/waybill/${aSub.id}`, seats[0]!.token);
  await move(0, aSub.id, 'shipped', { tracking: wb.json().trackingNumber, carrierCode: wb.json().carrierCode });
  await tracking.record(wb.json().trackingNumber, 'delivered');
  const ret = await call('POST', `/me/orders/${order.orderNumber}/stores/${aSub.id}/return`, buyerToken, {
    items: [{ orderItemId: aSub.items[0]!.id, qty: 1 }],
    reasonCode: 'damaged',
  });
  expect(ret.statusCode, ret.body).toBe(201);
  await move(0, aSub.id, 'returned', { returnRequestId: ret.json().returnRequestId });
}, 180_000);

afterAll(async () => {
  if (dbUp && seats.length) {
    const now = new Date();
    await prisma.productVariant.updateMany({ where: { id: { in: seats.map((s) => s.variantId) } }, data: { archivedAt: now, isActive: false } });
    await prisma.product.updateMany({ where: { id: { in: seats.map((s) => s.productId) } }, data: { deletedAt: now, status: 'archived' } });
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('VD-19 · أرقام البائع من دفتره', () => {
  it('أ: المبيعات والشحن والعمولة والمرتجعات والصافي تطابق السيناريو والدفتر بالقرش', async () => {
    if (!dbUp) return;
    const rep = await report(0);
    expect(rep.range).toEqual({ from: today, to: today, days: 1 });
    expect(rep.currencies).toHaveLength(1);
    const c = rep.currencies[0];
    const a = seats[0]!.vendorId;

    const sub = await prisma.subOrder.findUniqueOrThrow({ where: { id: aSubId } });
    expect(c.currency).toBe('SAR');
    expect(c.salesMinorUnits).toBe('30000'); // 3 × 100.00
    expect(c.shippingMinorUnits).toBe('1500');
    expect(c.refundsMinorUnits).toBe('10000'); // قطعة واحدة
    // العمولة بعد عكس نصيب القطعة المرتجعة — ثلثا عمولة الفرعي المثبّتة
    const commission = -(await ledgerNet(a, ['commission_debit']));
    expect(c.commissionMinorUnits).toBe(commission.toString());
    expect(commission).toBe(sub.commissionMinorUnits - sub.commissionMinorUnits / 3n);
    expect(c.netMinorUnits).toBe((30_000n + 1_500n - commission - 10_000n).toString());
    expect(c.netMinorUnits).toBe(
      (await ledgerNet(a, ['sale_credit', 'shipping_credit', 'commission_debit', 'refund_debit', 'adjustment_credit', 'adjustment_debit', 'fx_rounding'])).toString(),
    );
    expect(c.paidOrders).toBe(1);
    expect(c.averageOrderMinorUnits).toBe('30000');
    expect(c.series).toEqual([{ day: today, salesMinorUnits: '30000', orders: 1 }]);
    expect(c.topProducts).toEqual([{ productId: seats[0]!.productId, nameAr: 'منتج تقارير a', units: 2, revenueMinorUnits: '20000' }]);

    expect(rep.orders.total).toBe(1);
    expect(rep.orders.byStatus).toEqual({ [sub.status]: 1 });
    expect(rep.orders.delivered).toBe(1);
    expect(rep.orders.withReturn).toBe(1);
    expect(rep.orders.returnRatePct).toBe(100);
    expect(rep.orders.rejectedByVendor).toBe(0);
  });

  it('ب: أرقامه وحده — لا شيء من أ فيها، ولا شيء منه في أرقام أ', async () => {
    if (!dbUp) return;
    const rep = await report(1);
    const c = rep.currencies[0];
    expect(c.salesMinorUnits).toBe('20000');
    expect(c.shippingMinorUnits).toBe('1500');
    expect(c.refundsMinorUnits).toBe('0');
    expect(c.topProducts.map((p: { productId: string }) => p.productId)).toEqual([seats[1]!.productId]);
    expect(rep.orders).toMatchObject({ total: 1, delivered: 0, withReturn: 0, returnRatePct: null });
    expect(rep.orders.byStatus).toEqual({ awaiting_vendor: 1 });

    const a = await report(0);
    expect(a.currencies[0].topProducts.map((p: { productId: string }) => p.productId)).not.toContain(seats[1]!.productId);
    expect(a.currencies[0].salesMinorUnits).toBe('30000');
  });

  it('مدى لا طلبات فيه: أصفار لا أرقام غيره', async () => {
    if (!dbUp) return;
    const rep = await report(0, '2020-01-01', '2020-01-07');
    expect(rep.range.days).toBe(7);
    expect(rep.currencies).toEqual([]);
    expect(rep.orders).toMatchObject({ total: 0, byStatus: {}, delivered: 0, returnRatePct: null });
  });

  it('التصدير CSV بأرقام البائع نفسه', async () => {
    if (!dbUp) return;
    const res = await call('GET', `/vendor/reports/export.csv?from=${today}&to=${today}`, seats[0]!.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('"30000"');
    expect(res.body).toContain('منتج تقارير a');
    expect(res.body).not.toContain('منتج تقارير b');
    const x = await call('GET', `/vendor/reports/export.xlsx?from=${today}&to=${today}`, seats[0]!.token);
    expect(x.statusCode).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
  });
});

describe('VD-19 · المدى والصلاحية', () => {
  it('مدى مقلوب أو أطول من سنة أو بصيغة خاطئة — 400', async () => {
    if (!dbUp) return;
    for (const q of ['from=2026-03-10&to=2026-03-01', 'from=2024-01-01&to=2026-01-01', 'from=10-03-2026', 'vendorId=' + seats[1]!.vendorId]) {
      const res = await call('GET', `/vendor/reports?${q}`, seats[0]!.token);
      expect(res.statusCode, `${q}: ${res.body}`).toBe(400);
    }
  });

  it('المشتري لا يصل إلى التقارير', async () => {
    if (!dbUp) return;
    expect((await call('GET', '/vendor/reports', buyerToken)).statusCode).toBe(403);
  });
});
