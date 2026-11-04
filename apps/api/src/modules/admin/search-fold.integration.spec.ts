/**
 * كل خانات البحث تتجاهل فرق الحروف (4 نوفمبر 2026) — صاحبة المشروع: «لما كتبت الاسم ناقص الهمزة
 * ما ظهر» و«بدي كل خانات البحث ما تكون حساسة للاحرف».
 *
 * الأسماء هنا مكتوبة صحيحة، وعبارات البحث «خاطئة» عمداً بطريقة غير ما يخزّنه العمود الموحّد: همزة
 * في غير مكانها (الأيقاف ← الإيقاف)، وهاء مكان التاء المربوطة، وألف مقصورة مكان الياء — فلا تجد
 * العبارة كما كُتبت شيئاً إلا بتوحيدها هي أيضاً. كل عبارة تحمل وسم التشغيل فلا تختلط بغيرها.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { fold } from '../../common/arabic-fold';
import { hashPassword } from '../identity/public';
import { SearchService } from '../search/public';
import { PERMISSION_CODES } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const TAG = `sf${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();
const uniquePhone = () => `+9665${randomBytes(4).readUInt32BE(0).toString().padStart(10, '0').slice(-8)}`;

/** الأسماء كما تُكتب في القاعدة */
const NAMES = {
  admin: `مُديرة البَحث ${TAG}`,
  buyer: `آمنة المسؤولة ${TAG}`,
  vendor: `متجر الأمانة ${TAG}`,
  product: `ساعة الإيقاف ${TAG}`,
  description: `وصفٌ مُشكَّلٌ للمنتج ${TAG}`,
  recipient: `أسماء الإختبار ${TAG}`,
  preview: `${TAG} هل يوجد مقاسٌ أكبرُ`,
  page: `سياسة الإرجاع ${TAG}`,
  banner: `عروض الأعياد ${TAG}`,
  attribute: `اللون الأساسي ${TAG}`,
  campaign: `حملة الإطلاق ${TAG}`,
  review: `منتجٌ رائعٌ ${TAG}`,
};

let admin = { userId: '', token: '' };
let buyer = { userId: '', token: '' };
let vendor = { userId: '', vendorId: '', token: '' };
let orderNumber = '';
/** معرّف كل ما يُبحث عنه — الردّ يُفحص به لا بالوسم: قوائم تعيد عبارة البحث نفسها في ردّها */
const ids = { admin: '', buyer: '', vendor: '', product: '', review: '', conversation: '', page: '', banner: '', attribute: '', campaign: '', coupon: '' };

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
async function call(method: 'GET' | 'POST', url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

async function login(email: string, totpSecret?: string): Promise<string> {
  const totp = totpSecret ? generateSync({ strategy: 'totp', secret: totpSecret, crypto: totpCrypto, base32: totpBase32 }) : undefined;
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD, ...(totp ? { totp } : {}) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tokens.accessToken as string;
}

/** البحث بالعبارة يجد الصفّ بمعرّفه (أو رقمه) — والعبارة كما كُتبت لا تطابق النصّ المخزَّن حرفياً */
async function finds(path: string, param: string, term: string, token: string | undefined, stored: string, marker: string): Promise<void> {
  expect(stored.includes(term.replace(TAG, '').trim()), `«${term}» تطابق «${stored}» حرفياً — العبارة لا تختبر شيئاً`).toBe(false);
  expect(marker && !term.includes(marker), `علامة الإيجاد «${marker}» فارغة أو في العبارة نفسها`).toBe(true);
  const sep = path.includes('?') ? '&' : '?';
  const res = await call('GET', `${path}${sep}${param}=${encodeURIComponent(term)}`, token);
  expect(res.statusCode, `${path} ${res.body.slice(0, 300)}`).toBe(200);
  expect(res.body.includes(marker), `${path} بـ «${term}» لم يجد «${stored}»`).toBe(true);
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات توحيد البحث متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const secret = generateSecret();
  const aEmail = `root.${TAG}@basta.test`;
  const a = await prisma.user.create({
    data: {
      email: aEmail, fullName: NAMES.admin, phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'admin' } },
      permissions: { create: PERMISSION_CODES.map((permission) => ({ permission })) },
      totpSecretEnc: secret, totpEnabledAt: new Date(),
    },
  });
  admin = { userId: a.id, token: await login(aEmail, secret) };
  ids.admin = a.id;

  const bEmail = `buyer.${TAG}@basta.test`;
  const b = await prisma.user.create({
    data: { email: bEmail, fullName: NAMES.buyer, phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  buyer = { userId: b.id, token: await login(bEmail) };
  ids.buyer = b.id;

  const vEmail = `vendor.${TAG}@basta.test`;
  const vu = await prisma.user.create({
    data: { email: vEmail, fullName: `بائع ${TAG}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
  });
  const v = await prisma.vendor.create({
    data: {
      ownerUserId: vu.id, slug: `v-${TAG}`, nameAr: NAMES.vendor, status: 'approved', approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA',
      shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 1_500n } } } },
      bankAccounts: { create: { holderName: 'بائع', iban: 'SA0380000000608010167519', bankName: 'بنك', isDefault: true } },
    },
  });
  vendor = { userId: vu.id, vendorId: v.id, token: await login(vEmail) };
  ids.vendor = v.id;
  const category = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: v.id }, orderBy: { sort: 'asc' } });

  // منتج منشور بمتغيّر ومخزون — يُشترى مرة فتُبنى عليه الطلبات والتقييم والمحادثة
  const p = await prisma.product.create({
    data: { vendorId: v.id, vendorCategoryId: category.id, slug: `p-${TAG}`, nameAr: NAMES.product, descriptionAr: NAMES.description, status: 'active', publishedAt: new Date() },
  });
  ids.product = p.id;
  const variant = await prisma.productVariant.create({
    data: { productId: p.id, vendorId: v.id, sku: `SKU-${TAG}`.toUpperCase(), priceMinorUnits: 15_000n, optionsKey: '', isActive: true },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: 10, reserved: 0 } });
  await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 10, reason: 'import' } });

  const cart = await call('POST', '/cart', undefined, { currency: 'SAR' });
  const cartToken = cart.json().token as string;
  await call('POST', '/cart/items', undefined, { variantId: variant.id, qty: 1 }, { 'x-cart-token': cartToken });
  const address = { recipientName: NAMES.recipient, phone: '+966500000001', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' };
  const shown = (await call('POST', '/checkout/quote', undefined, { country: address.country, region: address.region, city: address.city }, { 'x-cart-token': cartToken })).json();
  const placed = await call(
    'POST',
    '/checkout',
    buyer.token,
    { address, paymentToken: 'tok_success', expectedTotal: shown.totals.total.minorUnits, expectedCurrency: shown.currency },
    { 'x-cart-token': cartToken, 'idempotency-key': randomUUID() },
  );
  expect(placed.statusCode, placed.body).toBe(200);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.json().orderId as string }, include: { items: true } });
  orderNumber = order.orderNumber;

  ids.review = (await prisma.review.create({
    data: { orderItemId: order.items[0]!.id, productId: p.id, vendorId: v.id, userId: b.id, rating: 5, title: NAMES.review, body: NAMES.review },
  })).id;
  ids.conversation = (await prisma.conversation.create({
    data: {
      customerId: b.id, vendorId: v.id, contextKey: `product:${p.id}`, productId: p.id,
      lastPreview: NAMES.preview, lastSenderSide: 'customer', lastMessageAt: new Date(), customerReadAt: new Date(),
    },
  })).id;
  // مطفأة ومؤرشفة وموقوفة: لا تظهر في قاعدة التطوير خارج هذا التشغيل، وتُمحى بعده
  ids.page = (await prisma.cmsPage.create({ data: { slug: `sf-${TAG}`, titleAr: NAMES.page, bodyAr: '', isPublished: false } })).id;
  ids.banner = (await prisma.banner.create({ data: { placement: 'home_hero', imageKey: `banners/${randomUUID()}`, titleAr: NAMES.banner, isActive: false } })).id;
  ids.attribute = (await prisma.attribute.create({ data: { code: `sf_${TAG}`, nameAr: NAMES.attribute, inputType: 'text', archivedAt: new Date() } })).id;
  ids.campaign = (await prisma.campaign.create({ data: { nameAr: NAMES.campaign, placement: 'home_top', isActive: false, startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000) } })).id;
  ids.coupon = (await prisma.coupon.create({ data: { code: `SF${TAG.slice(-9)}`.toUpperCase(), scope: 'vendor', vendorId: v.id, type: 'percent', valueBps: 500, fundedBy: 'vendor', isActive: false } })).id;
}, 120_000);

afterAll(async () => {
  if (dbUp) {
    await prisma.cmsPage.deleteMany({ where: { slug: `sf-${TAG}` } });
    await prisma.banner.deleteMany({ where: { titleAr: NAMES.banner } });
    await prisma.attribute.deleteMany({ where: { code: `sf_${TAG}` } });
    await prisma.campaign.deleteMany({ where: { nameAr: NAMES.campaign } });
    await prisma.coupon.deleteMany({ where: { vendorId: vendor.vendorId } });
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('توحيد الحروف في البحث', () => {
  it('basta_fold في القاعدة = fold() في الكود، والعمود الموحَّد يُحسب عند الكتابة', async () => {
    if (!dbUp) return;
    const samples = [
      'منتج تجربة الإيقاف', 'مستشفى الأمل', 'مسؤول المبيعات', 'شيء جميل', 'قرآن', 'ٱلرحمن', 'مَرْحَبًا', 'كتـــاب',
      'هاتف ٠٧٩١٢٣ و۴۵۶', 'BST-261103-ABC', 'Cotton SHIRT', 'سائل', 'یک',
    ];
    for (const s of samples) {
      const [row] = await prisma.$queryRaw<{ f: string }[]>`SELECT basta_fold(${s}) AS f`;
      expect(row!.f, s).toBe(fold(s));
    }
    const [p] = await prisma.$queryRaw<{ f: string }[]>`SELECT "nameArFold" AS f FROM products WHERE slug = ${`p-${TAG}`}`;
    expect(p!.f).toBe(fold(NAMES.product));
    expect(fold(NAMES.product)).toBe(`ساعه الايقاف ${TAG}`);
  });

  it('لوحة الإدارة: المنتجات والمتاجر والعملاء والمديرون والطلبات والتقييمات', async () => {
    if (!dbUp) return;
    await finds('/admin/products', 'search', `ساعه الأيقاف ${TAG}`, admin.token, NAMES.product, ids.product);
    await finds('/admin/vendors?status=approved', 'search', `متجر الامانه ${TAG}`, admin.token, NAMES.vendor, ids.vendor);
    await finds('/admin/customers', 'search', `امنه المسوولة ${TAG}`, admin.token, NAMES.buyer, ids.buyer);
    await finds('/admin/users', 'search', `مديره البحث ${TAG}`, admin.token, NAMES.admin, ids.admin);
    await finds('/admin/orders', 'q', `امنه المسوولة ${TAG}`, admin.token, NAMES.buyer, orderNumber);
    await finds('/admin/orders', 'q', `متجر الامانه ${TAG}`, admin.token, NAMES.vendor, orderNumber);
    await finds('/admin/reviews', 'search', `منتج رائع ${TAG}`, admin.token, NAMES.review, ids.review);
  });

  it('لوحة الإدارة: الصفحات واللافتات والخصائص والحملات والكوبونات (بلغة القاعدة)', async () => {
    if (!dbUp) return;
    await finds('/admin/pages', 'search', `سياسه الأرجاع ${TAG}`, admin.token, NAMES.page, ids.page);
    await finds('/admin/banners', 'search', `عروض الإعياد ${TAG}`, admin.token, NAMES.banner, ids.banner);
    await finds('/admin/attributes', 'search', `اللون الاساسى ${TAG}`, admin.token, NAMES.attribute, ids.attribute);
    await finds('/admin/campaigns', 'search', `حمله الاطلاق ${TAG}`, admin.token, NAMES.campaign, ids.campaign);
    await finds('/admin/coupons', 'search', `متجر الامانه ${TAG}`, admin.token, NAMES.vendor, ids.coupon);
  });

  it('لوحة البائع: منتجاته، وطلباته باسم المستلم وباسم المنتج، ورسائله', async () => {
    if (!dbUp) return;
    await finds('/vendor/products', 'search', `ساعه الأيقاف ${TAG}`, vendor.token, NAMES.product, ids.product);
    await finds('/vendor/orders', 'search', `اسما الاختبار ${TAG}`, vendor.token, NAMES.recipient, orderNumber);
    await finds('/vendor/orders', 'search', `ساعه الأيقاف ${TAG}`, vendor.token, NAMES.product, orderNumber);
    await finds('/vendor/conversations', 'search', `${TAG} هل يوجد مقاس اكبر`, vendor.token, NAMES.preview, ids.conversation);
    await finds('/vendor/conversations', 'search', `امنه المسوولة ${TAG}`, vendor.token, NAMES.buyer, ids.conversation);
  });

  it('المشتري: رسائله باسم المتجر، وبحث المتجر بالاسم وبالوصف (القاعدة حين يغيب محرّك البحث)', async () => {
    if (!dbUp) return;
    await finds('/me/conversations', 'search', `متجر الامانه ${TAG}`, buyer.token, NAMES.vendor, ids.conversation);
    // محرّك البحث (Meilisearch) يتجاهل الفرق بنفسه — جُرّب بفهرس مؤقت — لكن منتج الاختبار لا يصل
    // فهرسه في الحال؛ فطريق القاعدة يُختبر وحده كأن المحرّك غائب، أكان يعمل على الجهاز أم لا
    const engine = vi.spyOn(app.get(SearchService), 'search').mockResolvedValue(null);
    try {
      await finds('/storefront/products', 'q', `ساعه الأيقاف ${TAG}`, undefined, NAMES.product, ids.product);
      await finds('/storefront/products', 'q', `وصف مشكل للمنتج ${TAG}`, undefined, NAMES.description, ids.product);
    } finally {
      engine.mockRestore();
    }
  });

  it('رقم الطلب بأرقام هندية يجده كما بالأرقام اللاتينية', async () => {
    if (!dbUp) return;
    const arabicDigits = orderNumber.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
    expect(arabicDigits).not.toBe(orderNumber);
    const res = await call('GET', `/admin/orders?q=${encodeURIComponent(arabicDigits)}`, admin.token);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain(orderNumber);
  });
});
