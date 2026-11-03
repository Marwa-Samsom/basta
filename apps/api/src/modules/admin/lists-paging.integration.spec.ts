/**
 * «المزيد» و«السابق» لكل قائمة تكبر مع الوقت — صفحات من الخادم، وتصفيتها وبحثها وعدّاداتها هناك
 * (3 نوفمبر 2026). كانت «صفحات المحتوى» تُجلب كلها — 263 صفحة بلا «السابق» ولا «التالي» (ACFG-056)،
 * ومثلها الكوبونات واللافتات والعمولة ومستخدمو الإدارة والخصائص والحملات، وفي لوحة البائع وحساب
 * المشتري سقوف صامتة: السحوبات (200)، والنزاعات (100)، والرسائل (200).
 *
 * كل قائمة هنا: الصفحة الأولى بحدّها والثانية بباقيها بلا تكرار، والإجمالي لنتيجة البحث، والتصفية
 * في الخادم، والعدّادات للقائمة كلها. البيانات بوسم هذا التشغيل، وما لا يمسّ غيره يُمحى بعده.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { PERMISSION_CODES } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `pg${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();
const uniquePhone = () => `+9665${randomBytes(4).readUInt32BE(0).toString().padStart(10, '0').slice(-8)}`;

let admin = { userId: '', token: '' };
let buyer = { userId: '', token: '' };
let vendor = { userId: '', vendorId: '', token: '', categoryId: '' };

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
async function call(method: 'GET' | 'POST', url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

async function get<T = { items: { id: string }[]; total: number }>(url: string, token: string): Promise<T> {
  const res = await call('GET', url, token);
  expect(res.statusCode, `${url} ${res.body}`).toBe(200);
  return res.json() as T;
}

async function login(email: string, totpSecret?: string): Promise<string> {
  const totp = totpSecret ? generateSync({ strategy: 'totp', secret: totpSecret, crypto: totpCrypto, base32: totpBase32 }) : undefined;
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD, ...(totp ? { totp } : {}) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tokens.accessToken as string;
}

/**
 * الصفحة الأولى بحدّها والثانية بالباقي، بلا صفّ مكرّر بينهما، والإجمالي نفسه في الاثنتين —
 * ما يبني عليه «المزيد» و«السابق» و«X من Y» في الواجهة.
 */
async function twoPages(url: string, token: string, total: number, size: number, key: (r: Record<string, unknown>) => string = (r) => r['id'] as string) {
  const sep = url.includes('?') ? '&' : '?';
  const one = await get<{ items: Record<string, unknown>[]; total: number }>(url, token);
  const two = await get<{ items: Record<string, unknown>[]; total: number }>(`${url}${sep}page=2`, token);
  expect(one.total, `${url} — الإجمالي`).toBe(total);
  expect(two.total, `${url} — الإجمالي في الثانية`).toBe(total);
  expect(one.items, `${url} — الصفحة الأولى`).toHaveLength(Math.min(size, total));
  expect(two.items, `${url} — الصفحة الثانية`).toHaveLength(Math.max(0, total - size));
  const first = new Set(one.items.map(key));
  expect(two.items.filter((r) => first.has(key(r))), `${url} — مكرّر بين الصفحتين`).toEqual([]);
  return { one, two };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات صفحات القوائم متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const secret = generateSecret();
  const aEmail = `root.${SUFFIX}@basta.test`;
  const a = await prisma.user.create({
    data: {
      email: aEmail, fullName: 'مدير الصفحات', phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'admin' } },
      permissions: { create: PERMISSION_CODES.map((permission) => ({ permission })) },
      totpSecretEnc: secret, totpEnabledAt: new Date(),
    },
  });
  admin = { userId: a.id, token: await login(aEmail, secret) };

  const bEmail = `buyer.${SUFFIX}@basta.test`;
  const b = await prisma.user.create({
    data: { email: bEmail, fullName: `مشترية ${SUFFIX}`, phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  buyer = { userId: b.id, token: await login(bEmail) };

  const vEmail = `vendor.${SUFFIX}@basta.test`;
  const vu = await prisma.user.create({
    data: { email: vEmail, fullName: 'بائع الصفحات', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
  });
  const v = await prisma.vendor.create({
    data: {
      ownerUserId: vu.id, slug: `v-${SUFFIX}`, nameAr: `متجر ${SUFFIX}`, status: 'approved', approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA',
      shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 1_500n } } } },
      bankAccounts: { create: { holderName: 'بائع', iban: 'SA0380000000608010167519', bankName: 'بنك', isDefault: true } },
    },
  });
  // المتجر يبدأ بفئاته الثماني المقترحة (مشغِّل القاعدة)، ولا منتج بلا فئة
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: v.id }, orderBy: { sort: 'asc' } });
  vendor = { userId: vu.id, vendorId: v.id, token: await login(vEmail), categoryId: category.id };
}, 120_000);

afterAll(async () => {
  if (dbUp) {
    // ما لا يشير إليه شيء ولا يحمل مالاً — لا يبقى في قوائم اللوحة بعد التشغيل
    await prisma.cmsPage.deleteMany({ where: { slug: { startsWith: `pg-${SUFFIX}` } } });
    await prisma.coupon.deleteMany({ where: { code: { startsWith: code('') } } });
    await prisma.banner.deleteMany({ where: { titleAr: { contains: SUFFIX } } });
    await prisma.attribute.deleteMany({ where: { code: { startsWith: `pg_${SUFFIX}` } } });
    await prisma.campaign.deleteMany({ where: { nameAr: { contains: SUFFIX } } });
  }
  await app?.close();
  await prisma.$disconnect();
});

/** رمز كوبون بوسم التشغيل — أحرف لاتينية كبيرة وأرقام */
function code(tail: string): string {
  return `PG${SUFFIX.slice(-9)}${tail}`.toUpperCase();
}

// ======================================================================== لوحة الإدارة

// كل حالة تُنشئ عشرات الصفوف — تحت الحزمة كاملة تتجاوز مهلة الخمس ثوانٍ الافتراضية
describe('لوحة الإدارة: كل قائمة صفحات من الخادم بتصفيتها وبحثها وعدّاداتها', { timeout: 60_000 }, () => {
  it('صفحات المحتوى: خمسون خمسون، والحالة والبحث (العنوان أو الرابط) في الخادم (ACFG-056)', async () => {
    if (!dbUp) return;
    await prisma.cmsPage.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({ slug: `pg-${SUFFIX}-${i}`, titleAr: `صفحة ${SUFFIX} ${i}`, bodyAr: 'نص.', isPublished: i < 40 })),
    });
    await twoPages(`/admin/pages?search=${SUFFIX}`, admin.token, 53, 50);

    const drafts = await get<{ items: { isPublished: boolean }[]; total: number }>(`/admin/pages?status=draft&search=${SUFFIX}`, admin.token);
    expect(drafts.total).toBe(13);
    expect(drafts.items.every((p) => !p.isPublished)).toBe(true);
    expect((await get(`/admin/pages?status=published&search=${SUFFIX}`, admin.token)).total).toBe(40);

    // بالعنوان وحده: «… 7» لا تطابق «… 17» — وبالرابط
    const byTitle = await get<{ items: { slug: string }[]; total: number }>(`/admin/pages?search=${encodeURIComponent(`صفحة ${SUFFIX} 7`)}`, admin.token);
    expect(byTitle.items.map((p) => p.slug)).toEqual([`pg-${SUFFIX}-7`]);
    expect((await get(`/admin/pages?search=pg-${SUFFIX}-52`, admin.token)).total).toBe(1);

    // العدّادات للصفحات كلها لا لنتيجة البحث
    const { counts } = await get<{ counts: { all: number; published: number; draft: number } }>(`/admin/pages?search=${SUFFIX}`, admin.token);
    expect(counts.all).toBe(counts.published + counts.draft);
    expect(counts.published).toBeGreaterThanOrEqual(40);
    expect(counts.draft).toBeGreaterThanOrEqual(13);
    expect((await call('GET', '/admin/pages?status=archived', admin.token)).statusCode).toBe(400);
  });

  it('الكوبونات: الحالة تُحسب وتُصفّى وتُعدّ في الخادم، والبحث بالرمز أو المتجر', async () => {
    if (!dbUp) return;
    const day = 86_400_000;
    await prisma.coupon.createMany({
      data: [
        ...Array.from({ length: 50 }, (_, i) => ({ code: code(`A${i}`), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform' })),
        { code: code('OFF'), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform', isActive: false },
        { code: code('DATED'), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform', endsAt: new Date(Date.now() - day) },
        { code: code('USEDUP'), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform', usageLimitTotal: 5, usedCount: 5 },
        { code: code('NEAR'), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform', usageLimitTotal: 100, usedCount: 91 },
        // 90% بالضبط ليست «قارب النفاد» — فوقها
        { code: code('NINETY'), scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform', usageLimitTotal: 10, usedCount: 9 },
        { code: code('SHOP'), scope: 'vendor', vendorId: vendor.vendorId, type: 'percent', valueBps: 500, fundedBy: 'vendor' },
      ],
    });
    const stem = code('');
    await twoPages(`/admin/coupons?search=${stem}`, admin.token, 56, 50);

    const of = async (state: string) => {
      const r = await get<{ items: { code: string; state: string }[]; total: number }>(`/admin/coupons?state=${state}&search=${stem}`, admin.token);
      expect(r.items.every((c) => c.state === state), state).toBe(true);
      return r;
    };
    expect((await of('ending')).items.map((c) => c.code)).toEqual([code('NEAR')]);
    expect((await of('expired')).items.map((c) => c.code).sort()).toEqual([code('DATED'), code('USEDUP')].sort());
    expect((await of('off')).items.map((c) => c.code)).toEqual([code('OFF')]);
    expect((await of('active')).total).toBe(52);

    // باسم المتجر كما بالرمز
    const shop = await get<{ items: { code: string }[] }>(`/admin/coupons?search=${encodeURIComponent(`متجر ${SUFFIX}`)}`, admin.token);
    expect(shop.items.map((c) => c.code)).toEqual([code('SHOP')]);

    const { counts } = await get<{ counts: Record<string, number> }>(`/admin/coupons?search=${stem}`, admin.token);
    expect(counts['all']).toBe(counts['active']! + counts['ending']! + counts['expired']! + counts['off']!);
    expect(counts['ending']).toBeGreaterThanOrEqual(1);
    expect((await call('GET', '/admin/coupons?state=gone', admin.token)).statusCode).toBe(400);
  });

  it('اللافتات: خمسون خمسون، و«الرئيسية» والبحث بالعنوان في الخادم، وعدد كل موضع', async () => {
    if (!dbUp) return;
    // مطفأة: لا تظهر في رئيسية قاعدة التطوير ولو لحظة
    await prisma.banner.createMany({
      data: Array.from({ length: 52 }, (_, i) => ({
        placement: i < 50 ? 'home_hero' : 'category_top', imageKey: `banners/${randomUUID()}`, titleAr: `لافتة ${SUFFIX} ${i}`, isActive: false, sort: i,
      })),
    });
    await twoPages(`/admin/banners?search=${SUFFIX}`, admin.token, 52, 50);
    const home = await get<{ items: { placement: string }[]; total: number }>(`/admin/banners?filter=home&search=${SUFFIX}`, admin.token);
    expect(home.total).toBe(50);
    expect(home.items.every((b) => b.placement.startsWith('home_'))).toBe(true);

    const r = await get<{ counts: { all: number; home: number }; placements: Record<string, number> }>(`/admin/banners?search=${SUFFIX}`, admin.token);
    expect(r.placements['home_hero']).toBeGreaterThanOrEqual(50);
    expect(r.placements['category_top']).toBeGreaterThanOrEqual(2);
    expect(r.counts.all).toBe(Object.values(r.placements).reduce((n, c) => n + c, 0));
    expect(r.counts.home).toBeLessThan(r.counts.all);
    expect((await call('GET', '/admin/banners?filter=category', admin.token)).statusCode).toBe(400);
  });

  it('العمولة: العامة وحدها، والخاصة صفحات ببحث باسم المتجر، وعددها كله', async () => {
    if (!dbUp) return;
    const owners = Array.from({ length: 52 }, (_, i) => ({ id: randomUUID(), email: `cm${i}.${SUFFIX}@basta.test`, fullName: `مالك ${i}` }));
    await prisma.user.createMany({ data: owners.map((o) => ({ ...o, passwordHash: 'x' })) });
    const shops = owners.map((o, i) => ({ id: randomUUID(), ownerUserId: o.id, slug: `cm-${SUFFIX}-${i}`, nameAr: `عمولة ${SUFFIX} ${i}`, status: 'approved' as const, approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA' }));
    await prisma.vendor.createMany({ data: shops });
    const now = Date.now();
    await prisma.commissionRule.createMany({
      data: shops.map((s, i) => ({ scope: 'vendor', vendorId: s.id, rateBps: 100 + i, effectiveFrom: new Date(now - i * 1000), createdBy: admin.userId })),
    });

    const { one } = await twoPages(`/admin/finance/commissions?search=${encodeURIComponent(`عمولة ${SUFFIX}`)}`, admin.token, 52, 50);
    expect(one.items.every((r) => r['scope'] === 'vendor')).toBe(true);
    // الأحدث أولاً
    expect(one.items[0]!['rateBps']).toBe(100);
    const r = await get<{ global: { scope: string } | null; counts: { vendor: number } }>(`/admin/finance/commissions?search=${encodeURIComponent(`عمولة ${SUFFIX}`)}`, admin.token);
    if (r.global) expect(r.global.scope).toBe('global');
    expect(r.counts.vendor).toBeGreaterThanOrEqual(52);
    // برابط المتجر أيضاً
    expect((await get(`/admin/finance/commissions?search=cm-${SUFFIX}-51`, admin.token)).total).toBe(1);
  });

  it('مستخدمو الإدارة: خمسون خمسون، و«بلا تحقّق بخطوتين» والبحث في الخادم، والمالك من الخادم', async () => {
    if (!dbUp) return;
    await prisma.user.createMany({
      data: Array.from({ length: 52 }, (_, i) => ({
        id: randomUUID(), email: `adm${i}.${SUFFIX}@basta.test`, fullName: `مدير ${SUFFIX} ${i}`, passwordHash: 'x', ...(i < 20 ? { totpEnabledAt: new Date() } : {}),
      })),
    });
    const made = await prisma.user.findMany({ where: { email: { endsWith: `.${SUFFIX}@basta.test`, startsWith: 'adm' } }, select: { id: true } });
    await prisma.userRole.createMany({ data: made.map((u) => ({ userId: u.id, role: 'admin' })) });

    await twoPages(`/admin/users?search=${encodeURIComponent(`مدير ${SUFFIX}`)}`, admin.token, 52, 50);
    const off = await get<{ items: { twoFactor: boolean }[]; total: number }>(`/admin/users?filter=tfa_off&search=${encodeURIComponent(`مدير ${SUFFIX}`)}`, admin.token);
    expect(off.total).toBe(32);
    expect(off.items.every((u) => !u.twoFactor)).toBe(true);
    // بالبريد كما بالاسم
    expect((await get(`/admin/users?search=adm51.${SUFFIX}`, admin.token)).total).toBe(1);

    const r = await get<{ counts: { all: number; tfa_off: number }; iAmOwner: boolean }>('/admin/users', admin.token);
    expect(r.counts.all).toBeGreaterThanOrEqual(53);
    expect(r.counts.tfa_off).toBeGreaterThanOrEqual(32);
    expect(r.iAmOwner).toBe(false);
    expect((await call('GET', '/admin/users?filter=owners', admin.token)).statusCode).toBe(400);
  });

  it('الخصائص: خمسون خمسون، والمحاور والقابلة للتصفية والبحث (الاسم أو الرمز) في الخادم', async () => {
    if (!dbUp) return;
    // مؤرشفة: لا تظهر لبائع في محرّر منتجه أثناء التشغيل
    await prisma.attribute.createMany({
      data: Array.from({ length: 52 }, (_, i) => ({
        code: `pg_${SUFFIX}_${i}`, nameAr: `خصيصة ${SUFFIX} ${i}`, inputType: 'text', isVariantAxis: i < 10, isFilterable: i < 30, archivedAt: new Date(),
      })),
    });
    await twoPages(`/admin/attributes?search=pg_${SUFFIX}`, admin.token, 52, 50);
    const axis = await get<{ items: { isVariantAxis: boolean }[]; total: number }>(`/admin/attributes?filter=axis&search=pg_${SUFFIX}`, admin.token);
    expect(axis.total).toBe(10);
    expect(axis.items.every((a) => a.isVariantAxis)).toBe(true);
    expect((await get(`/admin/attributes?filter=filter&search=pg_${SUFFIX}`, admin.token)).total).toBe(30);
    expect((await get(`/admin/attributes?search=${encodeURIComponent(`خصيصة ${SUFFIX} 51`)}`, admin.token)).total).toBe(1);

    const { counts } = await get<{ counts: { all: number; axis: number; filter: number } }>(`/admin/attributes?search=pg_${SUFFIX}`, admin.token);
    expect(counts.all).toBeGreaterThanOrEqual(52);
    expect(counts.axis).toBeGreaterThanOrEqual(10);
    expect(counts.filter).toBeGreaterThanOrEqual(30);
    expect((await call('GET', '/admin/attributes?filter=archived', admin.token)).statusCode).toBe(400);
  });

  it('الحملات: خمسون خمسون، والحالة من الساعة شرطاً في الخادم، والبحث بالاسم', async () => {
    if (!dbUp) return;
    const h = 3_600_000;
    const now = Date.now();
    // بلا منتجات: الجارية منها لا تظهر في الرئيسية — والكل يُمحى بعد التشغيل
    const spec = (i: number) =>
      i < 20
        ? { startsAt: new Date(now - 3 * h), endsAt: new Date(now - h), isActive: true } // منتهية
        : i < 32
          ? { startsAt: new Date(now - h), endsAt: new Date(now + h), isActive: false } // موقوفة
          : i < 42
            ? { startsAt: new Date(now + h), endsAt: new Date(now + 2 * h), isActive: true } // مجدولة
            : { startsAt: new Date(now - h), endsAt: new Date(now + h), isActive: true }; // جارية
    await prisma.campaign.createMany({ data: Array.from({ length: 52 }, (_, i) => ({ nameAr: `حملة ${SUFFIX} ${i}`, placement: 'home_top', ...spec(i) })) });

    await twoPages(`/admin/campaigns?search=${SUFFIX}`, admin.token, 52, 50);
    for (const [status, n] of [['ended', 20], ['paused', 12], ['scheduled', 10], ['live', 10]] as const) {
      const r = await get<{ items: { status: string }[]; total: number }>(`/admin/campaigns?status=${status}&search=${SUFFIX}`, admin.token);
      expect(r.total, status).toBe(n);
      expect(r.items.every((c) => c.status === status), status).toBe(true);
    }
    const { counts } = await get<{ counts: Record<string, number> }>(`/admin/campaigns?search=${SUFFIX}`, admin.token);
    expect(counts['all']).toBe(counts['live']! + counts['scheduled']! + counts['ended']! + counts['paused']!);
    expect(counts['ended']).toBeGreaterThanOrEqual(20);
    expect((await call('GET', '/admin/campaigns?status=draft', admin.token)).statusCode).toBe(400);
  });
});

// ======================================================================== البائع والمشتري

describe('لوحة البائع وحساب المشتري: لا سقف صامت — صفحات بـ«المزيد» و«السابق»', { timeout: 60_000 }, () => {
  it('سجلّ سحوبات البائع: عشرون عشرون، الأحدث أولاً (كان أول مئتين)', async () => {
    if (!dbUp) return;
    // محفظة فارغة وطلبات مرفوضة بلا قيد: لا مال يتحرّك ولا يختلّ دفتر
    const wallet = await prisma.wallet.create({ data: { vendorId: vendor.vendorId, currency: 'SAR' } });
    const now = Date.now();
    await prisma.payoutRequest.createMany({
      data: Array.from({ length: 21 }, (_, i) => ({
        vendorId: vendor.vendorId, walletId: wallet.id, currency: 'SAR', amountMinorUnits: BigInt(1000 + i), status: 'rejected' as const,
        rejectReason: 'اختبار الصفحات', bankAccountSnapshot: {}, requestedAt: new Date(now - i * 60_000),
      })),
    });
    const { one, two } = await twoPages('/vendor/finance/payouts', vendor.token, 21, 20);
    expect(one.items[0]!['amountMinorUnits']).toBe('1000');
    expect(two.items[0]!['amountMinorUnits']).toBe('1020');
  });

  it('النزاعات للمشتري وللبائع: عشرون عشرون (كان أول مئة)، وبحث البائع برقم الطلب أو السبب في الخادم', async () => {
    if (!dbUp) return;
    const sub = await subOrder();
    const reasons = ['damaged', 'not_received', 'other'];
    await prisma.dispute.createMany({
      data: Array.from({ length: 21 }, (_, i) => ({
        subOrderId: sub.id, openedByUserId: buyer.userId, against: 'vendor', reasonCode: reasons[i % 3]!, status: 'closed', createdAt: new Date(Date.now() - i * 60_000),
      })),
    });
    await twoPages('/me/disputes', buyer.token, 21, 20);
    await twoPages('/vendor/disputes', vendor.token, 21, 20);

    // بالسبب كما يُقرأ على الشاشة — بالعربية وبالإنجليزية — وبرقم الطلب
    expect((await get('/vendor/disputes?search=تالفاً', vendor.token)).total).toBe(7);
    expect((await get('/vendor/disputes?search=damaged', vendor.token)).total).toBe(7);
    expect((await get(`/vendor/disputes?search=${sub.subOrderNumber}`, vendor.token)).total).toBe(21);
    expect((await get('/vendor/disputes?search=zzzz', vendor.token)).total).toBe(0);
  });

  it('صندوق الرسائل للمشتري وللبائع: ثلاثون ثلاثون (كان أول مئتين)، والبحث في الخادم، وعدد الصندوق كله', async () => {
    if (!dbUp) return;
    const products = Array.from({ length: 31 }, (_, i) => ({
      id: randomUUID(), vendorId: vendor.vendorId, vendorCategoryId: vendor.categoryId, slug: `msg-${SUFFIX}-${i}`, nameAr: `منتج محادثة ${SUFFIX} ${i}`, status: 'draft' as const,
    }));
    await prisma.product.createMany({ data: products });
    const now = Date.now();
    await prisma.conversation.createMany({
      data: products.map((p, i) => ({
        customerId: buyer.userId, vendorId: vendor.vendorId, contextKey: `product:${p.id}`, productId: p.id,
        lastPreview: `سؤال ${i}`, lastSenderSide: 'customer', lastMessageAt: new Date(now - i * 60_000), customerReadAt: new Date(now),
      })),
    });
    await twoPages('/me/conversations', buyer.token, 31, 30);
    const { one } = await twoPages('/vendor/conversations', vendor.token, 31, 30);
    expect(one.items[0]!['lastPreview']).toBe('سؤال 0');

    const box = await get<{ unread: number; all: number; total: number }>(`/vendor/conversations?search=${encodeURIComponent(`منتج محادثة ${SUFFIX} 7`)}`, vendor.token);
    // «… 7» لا تطابق «… 17»، والصندوق كله وغير مقروئه كما هما
    expect(box.total).toBe(1);
    expect(box.all).toBe(31);
    expect(box.unread).toBe(31);
    expect((await get(`/vendor/conversations?search=${encodeURIComponent(`مشترية ${SUFFIX}`)}`, vendor.token)).total).toBe(31);
    expect((await get(`/me/conversations?search=${encodeURIComponent(`متجر ${SUFFIX}`)}`, buyer.token)).total).toBe(31);
    expect((await get('/vendor/conversations?search=zzzz', vendor.token)).total).toBe(0);
  });

  it('صندوق الإشعارات: الإجمالي مع كل صفحة، وتصفية رموز القوالب وعدّاداتها من الخادم', async () => {
    if (!dbUp) return;
    // حساب وحده: إشعارات طلب الاختبار للبائع والمشتري لا تدخل العدّ
    const email = `notes.${SUFFIX}@basta.test`;
    const u = await prisma.user.create({ data: { email, fullName: 'صندوق الإشعارات', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } } });
    const token = await login(email);
    const now = Date.now();
    await prisma.notification.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        userId: u.id, channel: 'in_app', templateCode: i < 20 ? 'vendor_order_placed' : 'payout_paid', payloadJson: {}, status: 'sent',
        body: `إشعار ${i}`, sentAt: new Date(now - i * 60_000), createdAt: new Date(now - i * 60_000),
      })),
    });
    type Inbox = { items: { id: string; code: string }[]; total: number; unread: number; nextCursor: string | null; counts?: Record<string, number> };
    const first = await get<Inbox>('/me/notifications?counts=1', token);
    expect(first.items).toHaveLength(30);
    expect(first.total).toBe(35);
    expect(first.counts).toMatchObject({ vendor_order_placed: 20, payout_paid: 15 });
    const rest = await get<Inbox>(`/me/notifications?before=${first.nextCursor}`, token);
    expect(rest.items).toHaveLength(5);
    expect(rest.total).toBe(35);
    expect(rest.items.filter((n) => first.items.some((x) => x.id === n.id))).toEqual([]);

    const money = await get<Inbox>('/me/notifications?codes=payout_paid', token);
    expect(money.total).toBe(15);
    expect(money.items.every((n) => n.code === 'payout_paid')).toBe(true);
    expect(money.nextCursor).toBeNull();
    expect((await get<Inbox>('/me/notifications?unread=1', token)).total).toBe(35);
    expect((await call('GET', '/me/notifications?codes=Payout-Paid', token)).statusCode).toBe(400);
  });

  it('كشف حساب البائع: عدد قيود المدة كلها مع الصفحة', async () => {
    if (!dbUp) return;
    await subOrder();
    const entries = await prisma.ledgerEntry.count({ where: { vendorId: vendor.vendorId, currency: 'SAR' } });
    expect(entries).toBeGreaterThan(0);
    const s = await get<{ rows: unknown[]; total: number }>('/vendor/finance/statement?currency=SAR', vendor.token);
    expect(s.total).toBe(entries);
    expect(s.rows).toHaveLength(Math.min(entries, 500));
  });

  it('ملف العميل في الإدارة: طلباته عشرين عشرين، الأحدث أولاً (كانت آخر عشرين بلا ما قبلها)', async () => {
    if (!dbUp) return;
    await subOrder();
    // عشرون طلباً أقدم لم يُدفع: بلا طلبات فرعية ولا مال ولا إشعار — شراء حقيقي عشرين مرة كان يملأ
    // طابور الإشعارات وطابور «قاربت مهلة القبول» على اختبارات الملفات الأخرى
    const old = Date.now() - 86_400_000;
    await prisma.order.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        orderNumber: `PG-${SUFFIX}-${i}`, idempotencyKey: randomUUID(), customerUserId: buyer.userId, currency: 'SAR', status: 'payment_failed' as const,
        itemsSubtotalMinorUnits: 15_000n, grandTotalMinorUnits: 16_500n, shippingAddressSnapshot: {}, placedAt: new Date(old - i * 60_000),
      })),
    });
    const { one } = await twoPages(`/admin/customers/${buyer.userId}/orders`, admin.token, 21, 20, (r) => r['orderNumber'] as string);
    const newest = await prisma.order.findFirstOrThrow({ where: { customerUserId: buyer.userId }, orderBy: { placedAt: 'desc' }, select: { orderNumber: true } });
    expect(one.items[0]!['orderNumber']).toBe(newest.orderNumber);
    // الملف نفسه بلا قائمة الطلبات — تُقرأ صفحاتها وحدها
    expect((await get<Record<string, unknown>>(`/admin/customers/${buyer.userId}`, admin.token))['orders']).toBeUndefined();
  });
});

/** طلب مدفوع واحد من متجر الاختبار للمشتري — نزاعاته وقيوده تُبنى عليه */
let placed: { id: string; subOrderNumber: string } | null = null;
let variantId = '';
async function subOrder(): Promise<{ id: string; subOrderNumber: string }> {
  if (placed) return placed;
  const orderId = await checkout();
  placed = await prisma.subOrder.findFirstOrThrow({ where: { orderId }, select: { id: true, subOrderNumber: true } });
  return placed;
}

/** طلب مدفوع من المشترية بقطعة من منتج الاختبار — يُنشئ المنتج أول مرة */
async function checkout(): Promise<string> {
  if (!variantId) {
    const p = await prisma.product.create({
      data: { vendorId: vendor.vendorId, vendorCategoryId: vendor.categoryId, slug: `p-${SUFFIX}`, nameAr: `منتج ${SUFFIX}`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: p.id, vendorId: vendor.vendorId, sku: `SKU-${SUFFIX}`.toUpperCase(), priceMinorUnits: 15_000n, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 100, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 100, reason: 'import' } });
    variantId = variant.id;
  }
  const cart = await call('POST', '/cart', undefined, { currency: 'SAR' });
  const token = cart.json().token as string;
  await call('POST', '/cart/items', undefined, { variantId, qty: 1 }, { 'x-cart-token': token });
  const address = { recipientName: 'مشترية', phone: '+966500000001', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' };
  const shown = (await call('POST', '/checkout/quote', undefined, { country: address.country, region: address.region, city: address.city }, { 'x-cart-token': token })).json();
  const res = await call(
    'POST',
    '/checkout',
    buyer.token,
    { address, paymentToken: 'tok_success', expectedTotal: shown.totals.total.minorUnits, expectedCurrency: shown.currency },
    { 'x-cart-token': token, 'idempotency-key': randomUUID() },
  );
  expect(res.statusCode, res.body).toBe(200);
  return res.json().orderId as string;
}
