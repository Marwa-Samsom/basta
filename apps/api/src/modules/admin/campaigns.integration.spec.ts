/**
 * AD-17 — الحملات عبر الواجهة البرمجية الحيّة: الصلاحية، والتحقق، والترتيب،
 * ونافذة الظهور في الرئيسية، والتدقيق.
 *
 * يعمل على قاعدة التطوير نفسها: كل حملة ينشئها تُوقف في afterAll، وكوبوناته
 * تُوقف، ومنتجاته تُؤرشف — لا يبقى منه شيء في رئيسية الزوّار.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `cmp${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();

let content = '';
let noContent = '';
let buyer = '';
let products: { id: string; nameAr: string }[] = [];
let vendorId = '';
let coupon = { id: '', code: '' };
let offCoupon = { id: '', code: '' };
const created: string[] = [];

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const uniquePhone = () => `+9665${randomBytes(4).readUInt32BE(0).toString().padStart(10, '0').slice(-8)}`;

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token?: string, body?: unknown): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

async function login(email: string, totpSecret?: string): Promise<string> {
  const totp = totpSecret ? generateSync({ strategy: 'totp', secret: totpSecret, crypto: totpCrypto, base32: totpBase32 }) : undefined;
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD, ...(totp ? { totp } : {}) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tokens.accessToken as string;
}

async function makeAdmin(tag: string, permissions: readonly string[]) {
  const secret = generateSecret();
  const email = `${tag}.${SUFFIX}@basta.test`;
  await prisma.user.create({
    data: {
      email, fullName: `مدير ${tag}`, phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'admin' } },
      permissions: { create: permissions.map((permission) => ({ permission })) },
      totpSecretEnc: secret, totpEnabledAt: new Date(),
    },
  });
  return login(email, secret);
}

async function createCampaign(body: Record<string, unknown>) {
  const res = await call('POST', '/admin/campaigns', content, body);
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  created.push(id);
  return id;
}

const publicOf = async () => (await call('GET', '/storefront/campaigns')).json() as {
  id: string; nameAr: string; placement: string; endsAt: string; couponCode: string | null; products: { id: string; price: { formatted: string } }[];
}[];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات الحملات الحيّة متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  content = await makeAdmin('content', ['content.manage']);
  noContent = await makeAdmin('reports', ['reports.view', 'coupons.manage']);

  const bEmail = `buyer.${SUFFIX}@basta.test`;
  await prisma.user.create({ data: { email: bEmail, fullName: 'مشترٍ', phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } } });
  buyer = await login(bEmail);

  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'home' } });
  const vu = await prisma.user.create({
    data: { email: `vendor.${SUFFIX}@basta.test`, fullName: 'بائع الحملات', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
  });
  const v = await prisma.vendor.create({
    data: { ownerUserId: vu.id, slug: `v-${SUFFIX}`, nameAr: `متجر ${SUFFIX}`, status: 'approved', approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA' },
  });
  vendorId = v.id;
  // أربعة: ثلاثة منشورة ومسوّدة
  for (const [i, status] of (['active', 'active', 'active', 'draft'] as const).entries()) {
    const p = await prisma.product.create({
      data: { vendorId: v.id, categoryId: category.id, slug: `p${i}-${SUFFIX}`, nameAr: `منتج حملة ${i} ${SUFFIX}`, status, publishedAt: status === 'active' ? new Date() : null },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: p.id, vendorId: v.id, sku: `CMP${i}-${SUFFIX}`.toUpperCase(), priceMinorUnits: BigInt(10_000 + i * 1_000), optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 10, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 10, reason: 'import' } });
    products.push({ id: p.id, nameAr: p.nameAr });
  }

  const c1 = await prisma.coupon.create({ data: { code: `CMP${SUFFIX}`.toUpperCase().slice(0, 30), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform' } });
  const c2 = await prisma.coupon.create({ data: { code: `OFF${SUFFIX}`.toUpperCase().slice(0, 30), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform', isActive: false } });
  coupon = { id: c1.id, code: c1.code };
  offCoupon = { id: c2.id, code: c2.code };
}, 120_000);

afterAll(async () => {
  if (dbUp) {
    // لا يبقى شيء في رئيسية قاعدة التطوير ولا في قائمة الحملات: حملات الاختبار
    // تُحذف (صفوف التدقيق باقية — entityId نصّ لا مفتاح أجنبي)، وما قبلها يُوقف احتياطاً
    await prisma.campaign.updateMany({ where: { id: { in: created } }, data: { isActive: false } });
    await prisma.campaign.deleteMany({ where: { id: { in: created } } });
    await prisma.coupon.updateMany({ where: { id: { in: [coupon.id, offCoupon.id].filter(Boolean) } }, data: { isActive: false } });
    if (vendorId) await prisma.product.updateMany({ where: { vendorId }, data: { status: 'archived' } });
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('AD-17 · الحملات — الصلاحية', () => {
  it('المشتري 403، والمدير بلا content.manage 403، والمجهول 401 — قراءةً وكتابة', async () => {
    if (!dbUp) return;
    const body = { nameAr: 'حملة ممنوعة', placement: 'home_top', startsAt: iso(-HOUR), endsAt: iso(HOUR) };
    expect((await call('GET', '/admin/campaigns', buyer)).statusCode).toBe(403);
    expect((await call('POST', '/admin/campaigns', buyer, body)).statusCode).toBe(403);
    expect((await call('GET', '/admin/campaigns', noContent)).statusCode).toBe(403);
    expect((await call('POST', '/admin/campaigns', noContent, body)).statusCode).toBe(403);
    expect((await call('GET', '/admin/campaigns/product-search', noContent)).statusCode).toBe(403);
    expect((await call('GET', '/admin/campaigns/coupon-options', noContent)).statusCode).toBe(403);
    const anyId = '00000000-0000-4000-8000-000000000000';
    expect((await call('GET', `/admin/campaigns/${anyId}`, noContent)).statusCode).toBe(403);
    expect((await call('PATCH', `/admin/campaigns/${anyId}`, noContent, { isActive: false })).statusCode).toBe(403);
    expect((await call('PUT', `/admin/campaigns/${anyId}/products`, noContent, { productIds: [] })).statusCode).toBe(403);
    expect((await call('PUT', `/admin/campaigns/${anyId}/products`, buyer, { productIds: [] })).statusCode).toBe(403);
    expect((await call('GET', '/admin/campaigns')).statusCode).toBe(401);
    expect((await call('GET', '/admin/campaigns', content)).statusCode).toBe(200);
    // لم يُكتب شيء من المحاولات الممنوعة
    expect(await prisma.campaign.count({ where: { nameAr: 'حملة ممنوعة', createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBe(0);
  });
});

describe('AD-17 · الحملات — التحقق', () => {
  it('الاسم والموضع والمدة والكوبون تُرفض بسببها', async () => {
    if (!dbUp) return;
    const ok = { nameAr: `حملة ${SUFFIX}`, placement: 'home_top', startsAt: iso(-HOUR), endsAt: iso(HOUR) };
    const bad = async (patch: Record<string, unknown>, msg: RegExp) => {
      const res = await call('POST', '/admin/campaigns', content, { ...ok, ...patch });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.body).toMatch(msg);
    };
    await bad({ nameAr: 'اب' }, /3/);
    await bad({ nameAr: 'ا'.repeat(81) }, /80/);
    await bad({ nameAr: '   اب   ' }, /3/); // المسافات لا تُحسب
    await bad({ placement: 'home_hero' }, /موضع/);
    await bad({ endsAt: ok.startsAt }, /بعد بدايتها/);
    await bad({ endsAt: iso(-2 * HOUR) }, /بعد بدايتها/);
    await bad({ couponId: '00000000-0000-4000-8000-000000000000' }, /غير موجود/);
    await bad({ couponId: offCoupon.id }, /موقوف/);
    // قائمة الاختيار في النموذج لا تعرض الموقوف أصلاً
    const codes = ((await call('GET', '/admin/campaigns/coupon-options', content)).json() as { code: string }[]).map((c) => c.code);
    expect(codes).toContain(coupon.code);
    expect(codes).not.toContain(offCoupon.code);

    // التعديل الجزئي يُتحقَّق منه بعد الدمج: نهاية قبل البداية المحفوظة
    const id = await createCampaign({ ...ok, isActive: false });
    const res = await call('PATCH', `/admin/campaigns/${id}`, content, { endsAt: iso(-3 * HOUR) });
    expect(res.statusCode, res.body).toBe(400);
  });

  it('منتجات الحملة: مكرّر، أو أكثر من 24، أو غير منشور، أو غير موجود — 400 يسمّيه، ولا يمسّ القائمة السابقة', async () => {
    if (!dbUp) return;
    const id = await createCampaign({ nameAr: `تحقق منتجات ${SUFFIX}`, placement: 'home_middle', startsAt: iso(-HOUR), endsAt: iso(HOUR), isActive: false });
    const [p0, p1, , draft] = products;
    expect((await call('PUT', `/admin/campaigns/${id}/products`, content, { productIds: [p0!.id, p1!.id] })).statusCode).toBe(204);

    const put = (productIds: string[]) => call('PUT', `/admin/campaigns/${id}/products`, content, { productIds });
    let res = await put([p0!.id, p0!.id]);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/مكرّر/);
    res = await put(Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/24/);
    res = await put([p0!.id, draft!.id]);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(draft!.nameAr);
    res = await put(['00000000-0000-4000-8000-000000000001']);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/غير موجود/);

    // الرفض لم يمسّ ما حُفظ
    const detail = (await call('GET', `/admin/campaigns/${id}`, content)).json();
    expect(detail.products.map((p: { id: string }) => p.id)).toEqual([p0!.id, p1!.id]);
  });
});

describe('AD-17 · الحملات — الترتيب والظهور في الرئيسية', () => {
  it('الترتيب محفوظ، والمخفي يسقط من الواجهة ويبقى في نظر الإدارة، والكوبون يُعلَن ما دام صالحاً', async () => {
    if (!dbUp) return;
    const [p0, p1, p2] = products;
    const id = await createCampaign({ nameAr: `جارية ${SUFFIX}`, placement: 'home_middle', startsAt: iso(-HOUR), endsAt: iso(2 * HOUR), couponId: coupon.id });
    const top = await createCampaign({ nameAr: `أعلى ${SUFFIX}`, placement: 'home_top', startsAt: iso(-30 * 60_000), endsAt: iso(HOUR) });
    const order = [p2!.id, p0!.id, p1!.id];
    expect((await call('PUT', `/admin/campaigns/${id}/products`, content, { productIds: order })).statusCode).toBe(204);
    expect((await call('PUT', `/admin/campaigns/${top}/products`, content, { productIds: [p1!.id] })).statusCode).toBe(204);

    let detail = (await call('GET', `/admin/campaigns/${id}`, content)).json();
    expect(detail.status).toBe('live');
    expect(detail.products.map((p: { id: string }) => p.id)).toEqual(order);

    let pub = await publicOf();
    const mine = pub.filter((c) => c.id === id || c.id === top);
    // home_top قبل home_middle أياً كانت البداية
    expect(mine.map((c) => c.id)).toEqual([top, id]);
    const live = mine.find((c) => c.id === id)!;
    expect(live.products.map((p) => p.id)).toEqual(order);
    expect(live.couponCode).toBe(coupon.code);
    // البطاقة بمخطّط المميّز نفسه — السعر منسّق بعملة البائع
    expect(live.products[0]!.price.formatted).toMatch(/120/);

    // منتج أُعيد مسوّدة، ومنتج بائعه صار مخفياً: يسقطان من الواجهة، ويبقيان في الإدارة
    await prisma.product.update({ where: { id: p0!.id }, data: { status: 'draft' } });
    pub = await publicOf();
    expect(pub.find((c) => c.id === id)!.products.map((p) => p.id)).toEqual([p2!.id, p1!.id]);
    detail = (await call('GET', `/admin/campaigns/${id}`, content)).json();
    expect(detail.products.map((p: { id: string }) => p.id)).toEqual(order);
    expect(detail.products.find((p: { id: string }) => p.id === p0!.id).visible).toBe(false);
    await prisma.product.update({ where: { id: p0!.id }, data: { status: 'active' } });

    // كوبون أُوقف: الحملة باقية والرمز لا يُعلَن
    await prisma.coupon.update({ where: { id: coupon.id }, data: { isActive: false } });
    expect((await publicOf()).find((c) => c.id === id)!.couponCode).toBeNull();
    await prisma.coupon.update({ where: { id: coupon.id }, data: { isActive: true } });

    // القائمة: العدد والنطاق والرمز
    const row = ((await call('GET', '/admin/campaigns', content)).json() as { id: string; productCount: number; couponCode: string; scope: { shops: number; categoryNameAr: string | null } }[]).find((c) => c.id === id)!;
    expect(row.productCount).toBe(3);
    expect(row.couponCode).toBe(coupon.code);
    expect(row.scope.shops).toBe(1);
    expect(row.scope.categoryNameAr).toBe((await prisma.category.findUniqueOrThrow({ where: { slug: 'home' } })).nameAr);
  });

  it('المجدولة والمنتهية والموقوفة لا تظهر في الرئيسية، والحالة تُحسب في الخادم', async () => {
    if (!dbUp) return;
    const [p0] = products;
    const scheduled = await createCampaign({ nameAr: `مجدولة ${SUFFIX}`, placement: 'home_top', startsAt: iso(HOUR), endsAt: iso(2 * HOUR) });
    const ended = await createCampaign({ nameAr: `منتهية ${SUFFIX}`, placement: 'home_top', startsAt: iso(-3 * HOUR), endsAt: iso(-HOUR) });
    const paused = await createCampaign({ nameAr: `موقوفة ${SUFFIX}`, placement: 'home_top', startsAt: iso(-HOUR), endsAt: iso(HOUR) });
    for (const id of [scheduled, ended, paused]) {
      expect((await call('PUT', `/admin/campaigns/${id}/products`, content, { productIds: [p0!.id] })).statusCode).toBe(204);
    }
    // قبل الإيقاف تظهر — فغيابها بعده بسبب الإيقاف لا غيره
    expect((await publicOf()).some((c) => c.id === paused)).toBe(true);
    expect((await call('PATCH', `/admin/campaigns/${paused}`, content, { isActive: false })).statusCode).toBe(204);

    const pub = await publicOf();
    for (const id of [scheduled, ended, paused]) expect(pub.some((c) => c.id === id)).toBe(false);

    const list = (await call('GET', '/admin/campaigns', content)).json() as { id: string; status: string }[];
    const st = (id: string) => list.find((c) => c.id === id)?.status;
    expect([st(scheduled), st(ended), st(paused)]).toEqual(['scheduled', 'ended', 'paused']);

    // الاستئناف يعيدها
    expect((await call('PATCH', `/admin/campaigns/${paused}`, content, { isActive: true })).statusCode).toBe(204);
    expect((await publicOf()).some((c) => c.id === paused)).toBe(true);
    await call('PATCH', `/admin/campaigns/${paused}`, content, { isActive: false });
  });
});

describe('AD-17 · الحملات — التدقيق', () => {
  it('الإنشاء والمنتجات والإيقاف تكتب صفوف تدقيق بفاعلها وما قبلها', async () => {
    if (!dbUp) return;
    const id = await createCampaign({ nameAr: `تدقيق ${SUFFIX}`, placement: 'home_top', startsAt: iso(HOUR), endsAt: iso(2 * HOUR) });
    await call('PUT', `/admin/campaigns/${id}/products`, content, { productIds: [products[1]!.id] });
    await call('PATCH', `/admin/campaigns/${id}`, content, { nameAr: `تدقيق معدّل ${SUFFIX}` });
    await call('PATCH', `/admin/campaigns/${id}`, content, { isActive: false });

    const rows = await prisma.auditLog.findMany({ where: { entityType: 'Campaign', entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['campaign.create', 'campaign.products', 'campaign.update', 'campaign.pause']);
    expect(rows.every((r) => r.actorUserId && r.actorRole === 'admin')).toBe(true);
    expect((rows[2]!.beforeJson as { nameAr: string }).nameAr).toBe(`تدقيق ${SUFFIX}`);
    expect((rows[1]!.afterJson as { productIds: string[] }).productIds).toEqual([products[1]!.id]);
  });
});
