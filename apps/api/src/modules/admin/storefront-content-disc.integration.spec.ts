/**
 * ما تديره الإدارة ويراه الزائر (DISC-006 · 007 · 085) — البانر والمختارات وصفحات المحتوى،
 * عبر الواجهة البرمجية الحيّة.
 *
 * قاعدة التطوير نفسها: كل بانر يُنشأ هنا يُحذف، والمختارات تعود كما كانت، وصفحات المحتوى
 * مسودّات بمسارات لا تتكرّر — لا يبقى شيء في رئيسية صاحبة المشروع.
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

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `dc${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const DAY = 86_400_000;
let admin = '';
const vendorIds: string[] = [];

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token?: string, body?: unknown): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}
const messages = (res: Res): string[] => [res.json().message].flat() as string[];
const uniquePhone = () => `+9665${randomBytes(4).readUInt32BE(0).toString().padStart(10, '0').slice(-8)}`;

async function makeVendor(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${tag}.${SUFFIX}@basta.test`, fullName: `بائع ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
  });
  const vendor = await prisma.vendor.create({
    data: { ownerUserId: user.id, slug: `dc-${tag}-${SUFFIX}`, nameAr: `متجر ${tag}`, status: 'approved', approvedAt: new Date(), settlementCurrency: 'JOD', country: 'JO' },
  });
  vendorIds.push(vendor.id);
  return vendor.id;
}

async function makeProduct(vendorId: string, nameAr: string): Promise<string> {
  const p = await prisma.product.create({ data: { vendorId, slug: `dc-${SUFFIX}-${Math.random().toString(36).slice(2, 9)}`, nameAr, status: 'active', publishedAt: new Date() } });
  const v = await prisma.productVariant.create({
    data: { productId: p.id, vendorId, sku: `DC-${Math.random().toString(36).slice(2, 9).toUpperCase()}`, priceMinorUnits: 10_000n, optionsKey: '', isActive: true },
  });
  await prisma.inventory.create({ data: { variantId: v.id, onHand: 5, reserved: 0 } });
  await prisma.inventoryMovement.create({ data: { variantId: v.id, delta: 5, reason: 'import' } });
  return p.id;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات محتوى المتجر متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const secret = generateSecret();
  const email = `content.${SUFFIX}@basta.test`;
  await prisma.user.create({
    data: {
      email, fullName: 'مدير المحتوى', phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'admin' } },
      permissions: { create: ['content.manage', 'catalog.manage', 'vendors.review'].map((permission) => ({ permission })) },
      totpSecretEnc: secret, totpEnabledAt: new Date(),
    },
  });
  const totp = generateSync({ strategy: 'totp', secret, crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD, totp });
  expect(res.statusCode, res.body).toBe(200);
  admin = res.json().tokens.accessToken as string;
}, 60_000);

afterAll(async () => {
  if (dbUp && vendorIds.length) {
    await prisma.vendor.updateMany({ where: { id: { in: vendorIds } }, data: { status: 'suspended', suspendedAt: new Date() } });
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('بانر البطل (DISC-006)', () => {
  it('النشط ضمن مدّته وحده بترتيب sort، والرابط القديم الخارجي يُعاد كما حُفظ ليُرفض عند العرض، والحفظ برابط خارجي 400 برسالته', async () => {
    if (!dbUp) return;
    const imageKey = `banners/${randomUUID()}`;
    const make = (titleAr: string, data: Record<string, unknown>) =>
      prisma.banner.create({ data: { placement: 'home_hero', imageKey, titleAr: `${titleAr} ${SUFFIX}`, isActive: true, ...data } });
    const created: string[] = [];
    try {
      const a = await make('تخفيضات الخريف', { linkUrl: '/s/x', sort: -999 });
      const legacy = await make('رابط قديم', { linkUrl: '//evil.example', sort: -1000 });
      const expired = await make('منتهٍ', { endsAt: new Date(Date.now() - DAY), sort: -1001 });
      const scheduled = await make('مجدول', { startsAt: new Date(Date.now() + DAY), sort: -1002 });
      const off = await make('مطفأ', { isActive: false, sort: -1003 });
      created.push(a.id, legacy.id, expired.id, scheduled.id, off.id);

      const live = (await call('GET', '/storefront/banners?placement=home_hero')).json() as { id: string; titleAr: string; linkUrl: string | null; imageUrl: string }[];
      const mine = live.filter((b) => created.includes(b.id));
      // (ب) و(ج) و(د) غائبة، والباقي بترتيب sort: (هـ) قبل (أ)
      expect(mine.map((b) => b.id)).toEqual([legacy.id, a.id]);
      // أول ما يعرضه البطل: أول النشط بترتيبه في القائمة كلها
      expect(live[0]!.id).toBe(legacy.id);
      expect(mine[1]).toMatchObject({ titleAr: `تخفيضات الخريف ${SUFFIX}`, linkUrl: '/s/x', imageUrl: `/uploads/${imageKey}/full.webp` });
      // الخادم لا يمحو الرابط القديم: الصفحة تفحصه عند العرض فتعيد الزرّ إلى /shops (apps/web: disc-home.spec.ts)
      expect(mine[0]!.linkUrl).toBe('//evil.example');

      // تعطيل (هـ) من اللوحة: يصير (أ) الأول
      const disabled = await call('PATCH', `/admin/banners/${legacy.id}`, admin, { placement: 'home_hero', imageKey: `banners/${randomUUID()}`, isActive: false });
      expect(disabled.statusCode, disabled.body).toBe(200);
      const after = ((await call('GET', '/storefront/banners?placement=home_hero')).json() as { id: string }[]).filter((b) => created.includes(b.id));
      expect(after.map((b) => b.id)).toEqual([a.id]);

      for (const linkUrl of ['https://evil.example', '//evil.example']) {
        const res = await call('POST', '/admin/banners', admin, { placement: 'home_hero', imageKey: `banners/${randomUUID()}`, linkUrl, titleAr: `خارجي ${SUFFIX}`, isActive: false });
        expect(res.statusCode, `${linkUrl}: ${res.body}`).toBe(400);
        expect(messages(res), linkUrl).toContain('الرابط مسار داخل الموقع يبدأ بـ / (لا // ولا \\ ولا مسافات).');
      }
      expect(await prisma.banner.count({ where: { titleAr: `خارجي ${SUFFIX}` } })).toBe(0);
    } finally {
      await prisma.banner.deleteMany({ where: { id: { in: created } } });
    }
  });
});

describe('المختارات بترتيب الإدارة (DISC-007)', () => {
  it('P3 ثم P1 ثم P2؛ إيقاف P1 وتعليق متجر P2 يُسقطانهما فوراً فيبقى P3؛ وبإيقافه لا يبقى شيء', async () => {
    if (!dbUp) return;
    const KEY = 'home_featured_product_ids';
    const saved = await prisma.setting.findUnique({ where: { key: KEY } });
    const shopA = await makeVendor('featured-a');
    const shopB = await makeVendor('featured-b');
    const p1 = await makeProduct(shopA, 'مختار 1');
    const p2 = await makeProduct(shopB, 'مختار 2');
    const p3 = await makeProduct(shopA, 'مختار 3');
    const shown = async () => ((await call('GET', '/storefront/featured')).json() as { id: string }[]).map((p) => p.id);
    try {
      expect((await call('PUT', '/admin/storefront/featured', admin, { productIds: [p3, p1, p2] })).statusCode).toBe(204);
      expect(await shown()).toEqual([p3, p1, p2]);

      expect((await call('POST', `/admin/products/${p1}/reject`, admin, { reason: 'صور مخالفة للشروط' })).statusCode).toBe(204);
      expect((await call('POST', `/admin/vendors/${shopB}/suspend`, admin, { reason: 'شكاوى متكرّرة على عدم الشحن.' })).statusCode).toBe(204);
      expect(await shown()).toEqual([p3]);

      expect((await call('POST', `/admin/products/${p3}/reject`, admin, { reason: 'صور مخالفة للشروط' })).statusCode).toBe(204);
      expect(await shown()).toEqual([]);
    } finally {
      if (saved) await prisma.setting.update({ where: { key: KEY }, data: { valueJson: saved.valueJson as never } });
      else await prisma.setting.delete({ where: { key: KEY } }).catch(() => undefined);
    }
  });
});

describe('صفحة محتوى غير منشورة أو غير موجودة (DISC-085)', () => {
  it('المسودّة وغير الموجودة 404 «الصفحة غير موجودة.»، وإلغاء نشر المنشورة يجعلها 404 فوراً', async () => {
    if (!dbUp) return;
    const draftSlug = `terms-${SUFFIX}`;
    const liveSlug = `faq-${SUFFIX}`;
    const draft = await call('POST', '/admin/pages', admin, { slug: draftSlug, titleAr: 'الشروط', bodyAr: 'نص الشروط.', isPublished: false });
    expect(draft.statusCode, draft.body).toBe(201);
    const live = await call('POST', '/admin/pages', admin, { slug: liveSlug, titleAr: 'الأسئلة الشائعة', bodyAr: 'سؤال وجواب.', isPublished: true });
    expect(live.statusCode, live.body).toBe(201);

    for (const slug of [draftSlug, `missing-${SUFFIX}`]) {
      const res = await call('GET', `/pages/${slug}`);
      expect(res.statusCode, slug).toBe(404);
      expect(res.json().message, slug).toBe('الصفحة غير موجودة.');
    }

    expect((await call('GET', `/pages/${liveSlug}`)).statusCode).toBe(200);
    const off = await call('PUT', `/admin/pages/${live.json().id}`, admin, { slug: liveSlug, titleAr: 'الأسئلة الشائعة', bodyAr: 'سؤال وجواب.', isPublished: false });
    expect(off.statusCode, off.body).toBe(200);
    const gone = await call('GET', `/pages/${liveSlug}`);
    expect(gone.statusCode).toBe(404);
    expect(gone.json().message).toBe('الصفحة غير موجودة.');
  });
});
