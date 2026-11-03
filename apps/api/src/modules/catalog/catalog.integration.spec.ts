/**
 * إثبات بوابة خروج المرحلة 05 — البندان الأول والثالث — عبر الواجهة البرمجية الحيّة.
 *
 * التطبيق يُقلع بالتهيئة نفسها التي يُقلع بها الخادم (configureApp)، والطلبات
 * تمرّ بالحارس والتحقق ومرشّح الأخطاء كما يمرّ طلب البائع الحقيقي. اختبار
 * يستدعي الخدمة مباشرةً يثبت الخدمة، لا ما يصل إليه البائع.
 *
 * البيانات لا تُحذف: المتغيّر ذو التاريخ مقيَّد (ADR-005). تُؤرشف المنتجات
 * وتُحذف ملفات الصور، و npm run verify يبني القاعدة من الصفر.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { ConflictError, InvalidInputError, InvalidStateTransitionError } from '../../common/errors/domain-error';
import { hashPassword, TokenService } from '../identity/public';
import { ProductService, UPLOADS_ROOT, type AttributeView } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `cat${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';

type Tag = 'a' | 'b' | 'pending' | 'review';
const vendors = {} as Record<Tag, { userId: string; vendorId: string; token: string }>;
let attributes: AttributeView[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات الكتالوج الحيّة متخطّاة.\n');
    return;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const specs: [Tag, 'approved' | 'pending' | 'in_review', string][] = [
    ['a', 'approved', 'SAR'],
    ['b', 'approved', 'JOD'],
    ['pending', 'pending', 'SAR'],
    ['review', 'in_review', 'SAR'],
  ];
  for (const [tag, status, currency] of specs) {
    const email = `${tag}.${SUFFIX}@basta.test`;
    const user = await prisma.user.create({
      data: {
        email,
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
        status,
        ...(status === 'approved' ? { approvedAt: new Date() } : {}),
        settlementCurrency: currency,
        country: 'SA',
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    vendors[tag] = { userId: user.id, vendorId: vendor.id, token: login.json().tokens.accessToken };
  }

  const res = await app.inject({ method: 'GET', url: '/api/v1/attributes' });
  attributes = res.json();
}, 60_000);

afterAll(async () => {
  if (dbUp) {
    const vendorIds = Object.values(vendors).map((v) => v.vendorId);
    const products = await prisma.product.findMany({ where: { vendorId: { in: vendorIds } }, select: { id: true } });
    const now = new Date();
    await prisma.productVariant.updateMany({
      where: { vendorId: { in: vendorIds }, archivedAt: null },
      data: { archivedAt: now, isActive: false },
    });
    await prisma.product.updateMany({
      where: { vendorId: { in: vendorIds }, deletedAt: null },
      data: { deletedAt: now, status: 'archived' },
    });
    await Promise.all(
      products.map((p) => rm(join(UPLOADS_ROOT, 'products', p.id), { recursive: true, force: true })),
    );
    await app?.close();
  }
  await prisma.$disconnect();
});

const dbIt: typeof it = ((name: string, fn: never, timeout?: number) =>
  it(
    name,
    async (...args: never[]) => {
      if (!dbUp) return;
      return (fn as (...a: never[]) => unknown)(...args);
    },
    timeout,
  )) as never;

// ---------------------------------------------------------------------------- أدوات

/** أوّل فئة في المتجر — كل متجر يبدأ بالثماني المقترحة، ولا منتج بلا فئة (18 أكتوبر 2026) */
const firstCategory = new Map<Tag, string>();
async function catOf(tag: Tag): Promise<string> {
  const known = firstCategory.get(tag);
  if (known) return known;
  const list = (await as(tag).get('/vendor/categories')).json() as { id: string }[];
  firstCategory.set(tag, list[0]!.id);
  return list[0]!.id;
}

function as(tag: Tag) {
  const headers = { authorization: `Bearer ${vendors[tag].token}` };
  const url = (path: string) => `/api/v1${path}`;
  return {
    get: (path: string) => app.inject({ method: 'GET', url: url(path), headers }),
    post: (path: string, payload?: object) => app.inject({ method: 'POST', url: url(path), headers, ...(payload ? { payload } : {}) }),
    patch: (path: string, payload: object) => app.inject({ method: 'PATCH', url: url(path), headers, payload }),
    put: (path: string, payload: object) => app.inject({ method: 'PUT', url: url(path), headers, payload }),
    delete: (path: string) => app.inject({ method: 'DELETE', url: url(path), headers }),
    upload: (path: string, file: { name: string; type: string; data: Buffer }, fields: Record<string, string> = {}) => {
      const boundary = `----basta${randomBytes(8).toString('hex')}`;
      const chunks: Buffer[] = [];
      for (const [key, value] of Object.entries(fields)) {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
      }
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
        ),
        file.data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      );
      return app.inject({
        method: 'POST',
        url: url(path),
        headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat(chunks),
      });
    },
  };
}

const attr = (code: string): AttributeView => {
  const found = attributes.find((a) => a.code === code);
  if (!found) throw new Error(`السمة ${code} غير مبذورة — شغّل npm run db:seed`);
  return found;
};
const opt = (code: string, valueAr: string) => {
  const a = attr(code);
  const value = a.values.find((v) => v.valueAr === valueAr);
  if (!value) throw new Error(`القيمة ${valueAr} غير مبذورة للسمة ${code}`);
  return { attributeId: a.attributeId, valueId: value.id };
};

interface VariantJson {
  id: string;
  sku: string;
  price: { minorUnits: string; currency: string; formatted: string };
  stock: { onHand: number; reserved: number; available: number; isLow: boolean };
  options: { attributeId: string; valueAr: string }[];
}
const bySku = (product: { variants: VariantJson[] }, sku: string): VariantJson => {
  const v = product.variants.find((x) => x.sku === sku);
  if (!v) throw new Error(`لا متغيّر بـ SKU ${sku}`);
  return v;
};

async function expectNoDrift(variantIds: readonly string[]): Promise<void> {
  expect(
    await prisma.$queryRaw<unknown[]>`SELECT * FROM "audit_inventory_drift" WHERE "variantId" = ANY(${[...variantIds]}::uuid[])`,
  ).toEqual([]);
  expect(
    await prisma.$queryRaw<unknown[]>`SELECT * FROM "audit_reservation_drift" WHERE "variantId" = ANY(${[...variantIds]}::uuid[])`,
  ).toEqual([]);
}

async function simpleProduct(tag: Tag, sku: string, vendorCategoryId?: string) {
  const res = await as(tag).post('/vendor/products', {
    vendorCategoryId: vendorCategoryId ?? (await catOf(tag)),
    nameAr: 'منتج بسيط',
    attributes: [{ attributeId: attr('material').attributeId, text: 'قطن' }],
    variants: [{ sku, price: '10.00', stock: 2 }],
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; slug: string; variants: VariantJson[] };
}

/** صورة حقيقية للمنتج — النشر يشترط صورة واحدة على الأقل */
async function withImage(tag: Tag, productId: string): Promise<string> {
  const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 120, g: 60, b: 40 } } }).png().toBuffer();
  const up = await as(tag).upload(`/vendor/products/${productId}/images`, { name: 'p.png', type: 'image/png', data: png });
  expect(up.statusCode, up.body).toBe(201);
  return up.json().id as string;
}

// ============================================================================
describe('بوابة 05 · البند الأول — دورة حياة منتج بثلاثة متغيّرات', () => {
  dbIt('يُنشأ ويُعدَّل ويُحذف، ومخزون كل متغيّر صحيح في كل خطوة', async () => {
    const A = as('a');
    const RED_M = `RED-M-${SUFFIX}`;
    const RED_L = `RED-L-${SUFFIX}`;
    const BLUE_M = `BLUE-M-${SUFFIX}`;
    const BLUE_L = `BLUE-L-${SUFFIX}`;

    // ---- الإنشاء: في فئة من فئات المتجر، والسمات من المكتبة العامة
    const created = await A.post('/vendor/products', {
      vendorCategoryId: await catOf('a'),
      nameAr: 'قميص قطني',
      nameEn: 'Cotton T-shirt',
      attributes: [{ attributeId: attr('material').attributeId, text: 'قطن مصري' }],
      variants: [
        { sku: RED_M, price: '79.00', compareAtPrice: '99.00', stock: 5, options: [opt('color', 'أحمر'), opt('size', 'M')] },
        { sku: RED_L, price: '79.00', stock: 3, options: [opt('color', 'أحمر'), opt('size', 'L')] },
        { sku: BLUE_M, price: '85.50', stock: 0, options: [opt('size', 'M'), opt('color', 'أزرق')] },
      ],
    });
    expect(created.statusCode).toBe(201);
    const product = created.json();
    expect(product).toMatchObject({ status: 'draft', currency: 'SAR', hasVariants: true });
    expect(product.variants).toHaveLength(3);
    expect(bySku(product, RED_M).stock).toMatchObject({ onHand: 5, reserved: 0, available: 5 });
    expect(bySku(product, RED_L).stock).toMatchObject({ onHand: 3, available: 3 });
    expect(bySku(product, BLUE_M).stock).toMatchObject({ onHand: 0, available: 0, isLow: true });
    expect(bySku(product, BLUE_M).price).toMatchObject({ minorUnits: '8550', currency: 'SAR' });

    const ids = {
      redM: bySku(product, RED_M).id,
      redL: bySku(product, RED_L).id,
      blueM: bySku(product, BLUE_M).id,
    };
    await expectNoDrift(Object.values(ids));

    // ---- التعديل: سعر وجرد لمتغيّر، إبقاء آخر، استبدال ثالث بجديد
    const edited = await A.patch(`/vendor/products/${product.id}`, {
      nameAr: 'قميص قطني مصري',
      variants: [
        { id: ids.redM, sku: RED_M, price: '75.00', stock: 8, options: [opt('color', 'أحمر'), opt('size', 'M')] },
        { id: ids.redL, sku: RED_L, price: '79.00', options: [opt('color', 'أحمر'), opt('size', 'L')] },
        { sku: BLUE_L, price: '85.50', stock: 4, options: [opt('color', 'أزرق'), opt('size', 'L')] },
      ],
    });
    expect(edited.statusCode).toBe(200);
    const after = edited.json();
    expect(after.nameAr).toBe('قميص قطني مصري');
    expect(after.variants.map((v: VariantJson) => v.sku).sort()).toEqual([BLUE_L, RED_L, RED_M].sort());
    expect(bySku(after, RED_M)).toMatchObject({ price: { minorUnits: '7500' }, stock: { onHand: 8 } });
    expect(bySku(after, RED_L).stock.onHand).toBe(3);
    expect(bySku(after, BLUE_L).stock.onHand).toBe(4);
    const blueL = bySku(after, BLUE_L).id;

    const archived = await prisma.productVariant.findUniqueOrThrow({ where: { id: ids.blueM } });
    expect(archived.archivedAt).not.toBeNull();
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: ids.blueM } })).onHand).toBe(0);

    const redMoves = await prisma.inventoryMovement.findMany({ where: { variantId: ids.redM }, orderBy: { createdAt: 'asc' } });
    expect(redMoves.map((m) => m.delta)).toEqual([5, 3]);
    await expectNoDrift([...Object.values(ids), blueL]);

    // ---- تركيبة مكررة تُرفض ولا يتغيّر شيء
    const duplicate = await A.patch(`/vendor/products/${product.id}`, {
      variants: [
        { id: ids.redM, sku: RED_M, price: '75.00', options: [opt('color', 'أحمر'), opt('size', 'M')] },
        { id: ids.redL, sku: RED_L, price: '79.00', options: [opt('size', 'M'), opt('color', 'أحمر')] },
      ],
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('DUPLICATE');
    expect((await A.get(`/vendor/products/${product.id}`)).json().variants).toHaveLength(3);

    // ---- تعديل مخزون متغيّر: حدث تلف، ولا يُقبل الجرد والحدث معاً
    const damaged = await A.patch(`/vendor/products/${product.id}/variants/${ids.redM}/stock`, {
      delta: -2,
      reason: 'damage',
      note: 'تلف أثناء التخزين',
    });
    expect(damaged.statusCode).toBe(200);
    expect(damaged.json()).toMatchObject({ onHand: 6, available: 6 });
    const both = await A.patch(`/vendor/products/${product.id}/variants/${ids.redM}/stock`, {
      delta: 1,
      setTo: 3,
      reason: 'manual_adjust',
    });
    expect(both.statusCode).toBe(400);

    // ---- النشر فوري بلا مراجعة (15 أكتوبر 2026)، وتفريغ السمات تعديل يبقى منشوراً
    await withImage('a', product.id);
    const published = await A.post(`/vendor/products/${product.id}/publish`);
    expect(published.statusCode).toBe(200);
    expect(published.json().status).toBe('active');
    const stripped = await A.patch(`/vendor/products/${product.id}`, { attributes: [] });
    expect(stripped.statusCode).toBe(200);
    expect(stripped.json().status).toBe('active');

    // ---- الحذف: يختفي، والمخزون الفعلي لا يُصفَّر، والتاريخ باقٍ
    expect((await A.delete(`/vendor/products/${product.id}`)).statusCode).toBe(204);
    expect((await A.get(`/vendor/products/${product.id}`)).statusCode).toBe(404);
    const list = (await A.get('/vendor/products?pageSize=100')).json();
    expect(list.items.some((p: { id: string }) => p.id === product.id)).toBe(false);

    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: true } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.status).toBe('archived');
    expect(row.variants.every((v) => v.archivedAt !== null)).toBe(true);

    const stock = await prisma.inventory.findMany({ where: { variantId: { in: [...Object.values(ids), blueL] } } });
    const onHand = Object.fromEntries(stock.map((s) => [s.variantId, s.onHand]));
    expect(onHand).toEqual({ [ids.redM]: 6, [ids.redL]: 3, [ids.blueM]: 0, [blueL]: 4 });
    await expectNoDrift([...Object.values(ids), blueL]);

    expect((await A.delete(`/vendor/products/${product.id}`)).statusCode).toBe(404);
  }, 60_000);

  dbIt('SKU المحذوف يتحرّر لإعادة الاستعمال، والحيّ لا يتكرّر في المتجر', async () => {
    const sku = `REUSE-${SUFFIX}`;
    const first = await simpleProduct('a', sku);
    const clash = await as('a').post('/vendor/products', {
      vendorCategoryId: await catOf('a'),
      nameAr: 'منتج آخر',
      variants: [{ sku, price: '10.00', stock: 1 }],
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().message).toContain(sku);

    expect((await as('a').delete(`/vendor/products/${first.id}`)).statusCode).toBe(204);
    await simpleProduct('a', sku);

    // SKU فريد لكل بائع لا على المنصة: بائع آخر يستعمله بلا تعارض
    await simpleProduct('b', sku);
  });

  dbIt('الدينار بثلاث خانات: «12.500» لبائع JOD تُخزَّن 12500 وتُعرض 12.500', async () => {
    const res = await as('b').post('/vendor/products', {
      vendorCategoryId: await catOf('b'),
      nameAr: 'شماغ',
      variants: [{ sku: `JOD-${SUFFIX}`, price: '12.500', stock: 1 }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().variants[0].price).toMatchObject({ minorUnits: '12500', currency: 'JOD' });
    expect(res.json().variants[0].price.formatted).toContain('12.500');

    const numeric = await as('b').post('/vendor/products', {
      vendorCategoryId: await catOf('b'),
      nameAr: 'شماغ',
      variants: [{ sku: `JODN-${SUFFIX}`, price: 12.5, stock: 1 }],
    });
    expect(numeric.statusCode).toBe(400);
  });
});

// ============================================================================
describe('ADR-010 · عزل البائعين عبر الواجهة', () => {
  dbIt('البائع (ب) لا يقرأ منتج (أ) ولا يعدّله ولا يحذفه ولا يمسّ مخزونه أو صوره', async () => {
    const product = await simpleProduct('a', `ISO-${SUFFIX}`);
    const variantId = product.variants[0]?.id as string;
    const B = as('b');

    expect((await B.get(`/vendor/products/${product.id}`)).statusCode).toBe(404);
    expect((await B.patch(`/vendor/products/${product.id}`, { nameAr: 'مخترَق' })).statusCode).toBe(404);
    expect((await B.patch(`/vendor/products/${product.id}/variants/${variantId}/stock`, { setTo: 0, reason: 'damage' })).statusCode).toBe(404);
    expect((await B.post(`/vendor/products/${product.id}/publish`)).statusCode).toBe(404);
    expect((await B.delete(`/vendor/products/${product.id}`)).statusCode).toBe(404);
    const png = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
    expect((await B.upload(`/vendor/products/${product.id}/images`, { name: 'x.png', type: 'image/png', data: png })).statusCode).toBe(404);

    const list = (await B.get('/vendor/products?pageSize=100')).json();
    expect(list.items.some((p: { id: string }) => p.id === product.id)).toBe(false);

    const intact = (await as('a').get(`/vendor/products/${product.id}`)).json();
    expect(intact.nameAr).toBe('منتج بسيط');
    expect(intact.variants[0].stock.onHand).toBe(2);
  });

  dbIt('مسارات الإدارة ترفض رمز البائع، والمعرّف غير الصالح 404 لا 400', async () => {
    expect((await as('a').post('/admin/attributes', { code: 'x_y', nameAr: 'سمة', inputType: 'text' })).statusCode).toBe(403);
    expect((await as('a').get('/vendor/products/not-a-uuid')).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/vendor/products' })).statusCode).toBe(401);
  });
});

// ============================================================================
describe('VCAT-017 · حفظ المحرّر لا يمحو السعر قبل الخصم والباركود والوزن (24 أكتوبر 2026)', () => {
  dbIt('ما لم يُرسَل لمتغيّر قائم يبقى، و null يمحوه صراحةً', async () => {
    const A = as('a');
    const SKU = `DISC-${SUFFIX}`;
    const created = await A.post('/vendor/products', {
      vendorCategoryId: await catOf('a'),
      nameAr: 'منتج بخصم',
      variants: [{ sku: SKU, price: '79.00', compareAtPrice: '99.00', barcode: '6291041500213', weightGrams: 180, stock: 4 }],
    });
    expect(created.statusCode).toBe(201);
    const product = created.json();
    const id = bySku(product, SKU).id;

    // ما يرسله المحرّر حين يغيّر البائع الاسم وحده: لا خانات له لهذه الثلاثة
    const renamed = await A.patch(`/vendor/products/${product.id}`, {
      nameAr: 'منتج بخصم — تعديل',
      variants: [{ id, sku: SKU, price: '79.00' }],
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(bySku(renamed.json(), SKU)).toMatchObject({
      compareAtPrice: { minorUnits: '9900' },
      barcode: '6291041500213',
      weightGrams: 180,
    });
    expect(await prisma.productVariant.findUniqueOrThrow({ where: { id } })).toMatchObject({
      compareAtPriceMinorUnits: 9900n,
      barcode: '6291041500213',
      weightGrams: 180,
    });

    // من يرسلها null يمحوها — المحو قرار صريح لا أثر جانبي لحفظ آخر
    const cleared = await A.patch(`/vendor/products/${product.id}`, {
      variants: [{ id, sku: SKU, price: '79.00', compareAtPrice: null, barcode: null, weightGrams: null }],
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(bySku(cleared.json(), SKU)).toMatchObject({ compareAtPrice: null, barcode: null, weightGrams: null });
  });
});

// ============================================================================
describe('VD-11 · المخزون من الخادم — بحث وتصفية وصفحات (20 أكتوبر 2026)', () => {
  dbIt('متغيّراً متغيّراً بالبحث، و«المنخفض» و«النافد» من الخادم، والمنخفض أولاً، ولا يرى متجرٌ مخزون غيره', async () => {
    const A = as('a');
    const ok = await simpleProduct('a', `INV-OK-${SUFFIX}`);
    await simpleProduct('a', `INV-LOW-${SUFFIX}`);
    const out = await simpleProduct('a', `INV-OUT-${SUFFIX}`);
    const stock = (p: { id: string; variants: VariantJson[] }, setTo: number) =>
      A.patch(`/vendor/products/${p.id}/variants/${p.variants[0]!.id}/stock`, { setTo, reason: 'manual_adjust' });
    expect((await stock(ok, 50)).statusCode).toBe(200);
    expect((await stock(out, 0)).statusCode).toBe(200);
    // low يبقى على 2 — دون حدّ التنبيه (5)

    const inv = async (q: string) => {
      const res = await A.get(`/vendor/inventory?${q}`);
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { items: { sku: string; onHand: number; available: number; isLow: boolean; variant: string; productNameAr: string }[]; total: number; counts: Record<string, number> };
    };
    const term = (s: string) => `search=${encodeURIComponent(s)}`;
    const skus = (r: { items: { sku: string }[] }) => r.items.map((i) => i.sku).filter((s) => s.endsWith(SUFFIX));

    // بحث SKU بلا حساسية للأحرف، والمنخفض أولاً
    const mine = await inv(term('inv-'));
    expect(skus(mine)).toEqual(expect.arrayContaining([`INV-OK-${SUFFIX}`, `INV-LOW-${SUFFIX}`, `INV-OUT-${SUFFIX}`]));
    const order = skus(mine);
    expect(order.indexOf(`INV-OK-${SUFFIX}`)).toBeGreaterThan(order.indexOf(`INV-LOW-${SUFFIX}`));
    const one = await inv(term(`inv-ok-${SUFFIX}`));
    expect(one.total).toBe(1);
    expect(one.items[0]).toMatchObject({ onHand: 50, available: 50, isLow: false, productNameAr: 'منتج بسيط' });

    // التصفية من الخادم: النافد وحده نافد، والمنخفض يجمع ما بلغ الحدّ
    expect(skus(await inv(`filter=out&${term('inv-')}`))).toEqual([`INV-OUT-${SUFFIX}`]);
    expect(skus(await inv(`filter=low&${term('inv-')}`)).sort()).toEqual([`INV-LOW-${SUFFIX}`, `INV-OUT-${SUFFIX}`].sort());
    expect((await A.get('/vendor/inventory?filter=bogus')).statusCode).toBe(400);

    // العدّادات للمتجر كله لا للبحث
    const counts = (await inv(term(`inv-ok-${SUFFIX}`))).counts;
    expect(counts.all).toBeGreaterThanOrEqual(3);
    expect(counts.out).toBeGreaterThanOrEqual(1);
    expect(counts.low).toBeGreaterThanOrEqual(2);
    expect(counts.attention).toBeGreaterThanOrEqual(counts.out!);

    // الصفحة الثانية لا تكرّر الأولى
    const p1 = await inv('');
    const p2 = await inv('page=2');
    expect(p2.items.some((i) => p1.items.some((j) => j.sku === i.sku))).toBe(false);
    expect(p1.items.length + p2.items.length).toBeLessThanOrEqual(p1.total);

    // عزل البائعين: متجر آخر لا يرى هذه المتغيّرات ولا تدخل عدّاداته
    const other = (await as('b').get(`/vendor/inventory?${term(`inv-ok-${SUFFIX}`)}`)).json();
    expect(other).toMatchObject({ items: [], total: 0 });
  });

  dbIt('المنتجات بتاريخ آخر تعديل: الأحدث أولاً افتراضياً، و?sort=oldest يعكسه، وغيرهما 400', async () => {
    const A = as('a');
    await simpleProduct('a', `SORT-1-${SUFFIX}`);
    await simpleProduct('a', `SORT-2-${SUFFIX}`);
    const updated = async (q: string) => ((await A.get(`/vendor/products?pageSize=100${q}`)).json().items as { updatedAt: string }[]).map((p) => Date.parse(p.updatedAt));
    const newest = await updated('');
    const oldest = await updated('&sort=oldest');
    expect(newest.length).toBeGreaterThan(1);
    expect(newest).toEqual([...newest].sort((x, y) => y - x));
    expect(oldest).toEqual([...oldest].sort((x, y) => x - y));
    expect((await A.get('/vendor/products?sort=bogus')).statusCode).toBe(400);
  });
});

// ============================================================================
describe('النشر', () => {
  dbIt('يُمنع بكل أسبابه معاً: متجر لم يُرسل طلبه ولا صورة', async () => {
    const P = as('pending');
    const created = await P.post('/vendor/products', {
      vendorCategoryId: await catOf('pending'),
      nameAr: 'حذاء',
      variants: [{ sku: `PEND-${SUFFIX}`, price: '150.00', stock: 2 }],
    });
    expect(created.statusCode).toBe(201);

    const res = await P.post(`/vendor/products/${created.json().id}/publish`);
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe('PUBLISH_BLOCKED');
    expect(body.details.reasons).toHaveLength(2);
    expect(body.message).toContain('أرسل طلب متجرك');
    expect(body.message).toContain('صورة واحدة على الأقل');
  });

  dbIt('الصورة شرط للنشر: بلا صورة يُمنع، وبصورة يُنشر فوراً', async () => {
    const A = as('a');
    const product = await simpleProduct('a', `NOIMG-${SUFFIX}`);
    const blocked = await A.post(`/vendor/products/${product.id}/publish`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().details.reasons).toEqual(['أضف صورة واحدة على الأقل — الأولى هي الرئيسية في المتجر']);

    await withImage('a', product.id);
    const published = await A.post(`/vendor/products/${product.id}/publish`);
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().status).toBe('active');
  });

  dbIt('سمة ليست محور متغيّرات لا تصير خياراً: «الخامة» على متغيّر تُرفض', async () => {
    const material = attr('material').attributeId;
    const res = await as('a').post('/vendor/products', {
      vendorCategoryId: await catOf('a'),
      nameAr: 'أرز',
      variants: [
        { sku: `RICE-M-${SUFFIX}`, price: '20.00', stock: 1, options: [{ attributeId: material, valueId: opt('size', 'M').valueId }] },
        { sku: `RICE-L-${SUFFIX}`, price: '30.00', stock: 1, options: [{ attributeId: material, valueId: opt('size', 'L').valueId }] },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('ليست من سمات المتغيّرات');
  });
});

// ============================================================================
describe('النشر بلا مراجعة — قرار صاحب المشروع 15 أكتوبر 2026 (ألغى Q-15 و Q-16)', () => {
  dbIt('النشر فوري، والإدارة توقف المخالف بسبب يراه البائع، وإعادة النشر بعد الإصلاح فورية', async () => {
    const A = as('a');
    const service = app.get(ProductService);
    const product = await simpleProduct('a', `LIVE-${SUFFIX}`);
    await withImage('a', product.id);
    const shown = () => app.inject({ method: 'GET', url: `/api/v1/storefront/products/${product.slug}` });
    expect((await shown()).statusCode).toBe(404);

    const published = await A.post(`/vendor/products/${product.id}/publish`);
    expect(published.json()).toMatchObject({ status: 'active', rejectReason: null });
    const firstPublishedAt = published.json().publishedAt as string;
    expect(firstPublishedAt).not.toBeNull();
    expect((await shown()).statusCode).toBe(200);
    // النشر المكرر لا يغيّر شيئاً
    expect((await A.post(`/vendor/products/${product.id}/publish`)).json().publishedAt).toBe(firstPublishedAt);

    // البائع لا يصل لمسارات الإدارة
    expect((await A.post(`/admin/products/${product.id}/reject`, { reason: 'محاولة من البائع' })).statusCode).toBe(403);
    expect((await A.get('/admin/products')).statusCode).toBe(403);

    // الإيقاف بسبب: يختفي من المتجر، والسبب يصل البائع كما كُتب
    await service.reject(product.id, 'الصور لا تطابق المنتج الموصوف.');
    expect((await A.get(`/vendor/products/${product.id}`)).json()).toMatchObject({
      status: 'rejected',
      rejectReason: 'الصور لا تطابق المنتج الموصوف.',
    });
    expect((await shown()).statusCode).toBe(404);

    // يعيد النشر بعد الإصلاح فيظهر فوراً، والسبب يُمسح، وتاريخ نشره الأول باقٍ
    const again = (await A.post(`/vendor/products/${product.id}/publish`)).json();
    expect(again).toMatchObject({ status: 'active', rejectReason: null, publishedAt: firstPublishedAt });
    expect((await shown()).statusCode).toBe(200);

    // سحب النشر بيد البائع يعيده مسودة ويخفيه، والمسودة لا تُوقف
    expect((await A.post(`/vendor/products/${product.id}/unpublish`)).json().status).toBe('draft');
    expect((await shown()).statusCode).toBe(404);
    await expect(service.reject(product.id, 'سبب كافٍ للإيقاف')).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  // خمس مسافات كانت تمرّ بحدّ الطول فيصل البائع سبب فارغ (ADM-051، 30 أكتوبر 2026)
  dbIt('سبب الإيقاف يُقاس بلا مسافات طرفيه، ويُحفظ ويصل البائع بلاها', async () => {
    const A = as('a');
    const service = app.get(ProductService);
    const product = await simpleProduct('a', `TRIM-${SUFFIX}`);
    await withImage('a', product.id);
    expect((await A.post(`/vendor/products/${product.id}/publish`)).json().status).toBe('active');

    await expect(service.reject(product.id, '     ')).rejects.toBeInstanceOf(InvalidInputError);
    await expect(service.reject(product.id, '  مكسو  ')).rejects.toBeInstanceOf(InvalidInputError);
    expect((await A.get(`/vendor/products/${product.id}`)).json().status).toBe('active');

    expect(await service.reject(product.id, '  مخالف  ')).toBe('مخالف');
    expect((await A.get(`/vendor/products/${product.id}`)).json()).toMatchObject({ status: 'rejected', rejectReason: 'مخالف' });
  });

  // قرار إداري يمسّ بائعاً كان بلا أثر في السجل (ADM-054، 30 أكتوبر 2026)
  dbIt('الإيقاف يُكتب في سجل التدقيق: من أوقف، والسبب، والحالة قبله وبعده', async () => {
    const A = as('a');
    const product = await simpleProduct('a', `AUDIT-${SUFFIX}`);
    await withImage('a', product.id);
    expect((await A.post(`/vendor/products/${product.id}/publish`)).json().status).toBe('active');

    const admin = await prisma.user.create({
      data: {
        email: `catalog.admin.${SUFFIX}@basta.test`,
        fullName: 'مدير الكتالوج',
        passwordHash: await hashPassword(randomUUID()),
        roles: { create: { role: 'admin' } },
        permissions: { create: { permission: 'catalog.manage' } },
        totpEnabledAt: new Date(),
      },
    });
    try {
      const { accessToken } = await app.get(TokenService).issue({ sub: admin.id, roles: ['admin'], permissions: ['catalog.manage'] }, {});
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/products/${product.id}/reject`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { reason: '  الصورة لا تطابق الوصف  ' },
      });
      expect(res.statusCode, res.body).toBe(204);

      const line = await prisma.auditLog.findFirst({ where: { action: 'product.reject', entityId: product.id } });
      expect(line).toMatchObject({ actorUserId: admin.id, actorRole: 'admin', entityType: 'Product' });
      expect(line?.beforeJson).toMatchObject({ status: 'active' });
      expect(line?.afterJson).toMatchObject({ status: 'rejected', reason: 'الصورة لا تطابق الوصف', vendorId: vendors.a.vendorId });
    } finally {
      // لا يبقى مدير اختبار يتلقّى تنبيهات الكتالوج على قاعدة التطوير
      await prisma.user.update({ where: { id: admin.id }, data: { status: 'suspended' } });
    }
  });

  dbIt('لا يُوقف إلا المنشور برسالة بأسماء الحالات العربية، والمجهول غير موجود — ولا إشعار للبائع (ADM-052)', async () => {
    const A = as('a');
    const draft = await simpleProduct('a', `NOSTOP-D-${SUFFIX}`);
    const stopped = await simpleProduct('a', `NOSTOP-R-${SUFFIX}`);
    await withImage('a', stopped.id);
    expect((await A.post(`/vendor/products/${stopped.id}/publish`)).json().status).toBe('active');
    await app.get(ProductService).reject(stopped.id, 'إيقاف أول للاختبار');

    const admin = await prisma.user.create({
      data: {
        email: `catalog.nostop.${SUFFIX}@basta.test`,
        fullName: 'مدير الكتالوج',
        passwordHash: await hashPassword(randomUUID()),
        roles: { create: { role: 'admin' } },
        permissions: { create: { permission: 'catalog.manage' } },
        totpEnabledAt: new Date(),
      },
    });
    try {
      const { accessToken } = await app.get(TokenService).issue({ sub: admin.id, roles: ['admin'], permissions: ['catalog.manage'] }, {});
      const stop = (id: string) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/products/${id}/reject`,
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { reason: 'سبب صالح للإيقاف' },
        });
      const notices = () => prisma.notification.count({ where: { userId: vendors.a.userId, templateCode: 'product_rejected' } });
      const before = await notices();

      const fromDraft = await stop(draft.id);
      expect(fromDraft.statusCode, fromDraft.body).toBe(409);
      expect(fromDraft.json().message).toBe('الانتقال من «مسوّدة» إلى «موقوف» غير مسموح.');
      const twice = await stop(stopped.id);
      expect(twice.statusCode, twice.body).toBe(409);
      expect(twice.json().message).toBe('الانتقال من «موقوف» إلى «موقوف» غير مسموح.');
      const unknown = await stop(randomUUID());
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().message).toBe('المنتج غير موجود.');
      const notUuid = await stop('not-a-uuid');
      expect(notUuid.statusCode).toBe(404);
      expect(notUuid.json().message).toBe('المورد غير موجود.');

      expect(await notices()).toBe(before);
      expect((await A.get(`/vendor/products/${draft.id}`)).json().status).toBe('draft');
      expect((await A.get(`/vendor/products/${stopped.id}`)).json().rejectReason).toBe('إيقاف أول للاختبار');
    } finally {
      await prisma.user.update({ where: { id: admin.id }, data: { status: 'suspended' } });
    }
  });

  dbIt('متجر قيد المراجعة ينشر فيُحفظ منشوراً مخفياً، ويظهر للمشترين لحظة اعتماد متجره', async () => {
    const R = as('review');
    const product = await simpleProduct('review', `PRE-${SUFFIX}`);
    await withImage('review', product.id);
    const shown = () => app.inject({ method: 'GET', url: `/api/v1/storefront/products/${product.slug}` });

    const published = await R.post(`/vendor/products/${product.id}/publish`);
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().status).toBe('active');
    // قاعدة الرؤية تشترط بائعاً معتمداً — لا شيء يُعاد بعد الاعتماد
    expect((await shown()).statusCode).toBe(404);

    await prisma.vendor.update({ where: { id: vendors.review.vendorId }, data: { status: 'approved', approvedAt: new Date() } });
    expect((await shown()).statusCode).toBe(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('active');
  });

  dbIt('تعديل المنشور يظهر فوراً ويبقى منشوراً: الاسم والسعر والمخزون والصور', async () => {
    const A = as('a');
    const sku = `EDIT-${SUFFIX}`;
    const product = await simpleProduct('a', sku);
    const variantId = product.variants[0]?.id as string;
    await withImage('a', product.id);
    await A.post(`/vendor/products/${product.id}/publish`);
    const status = async () => (await A.get(`/vendor/products/${product.id}`)).json().status;

    const repriced = await A.patch(`/vendor/products/${product.id}`, { variants: [{ id: variantId, sku, price: '12.50', stock: 9 }] });
    expect(repriced.json().status).toBe('active');
    expect((await A.patch(`/vendor/products/${product.id}/variants/${variantId}/stock`, { delta: -1, reason: 'damage' })).statusCode).toBe(200);

    const renamed = await A.patch(`/vendor/products/${product.id}`, { nameAr: 'منتج بسيط محسَّن' });
    expect(renamed.json().status).toBe('active');
    const page = (await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${product.slug}` })).json();
    expect(page.nameAr).toBe('منتج بسيط محسَّن');

    const png = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 90, g: 30, b: 50 } } }).png().toBuffer();
    expect((await A.upload(`/vendor/products/${product.id}/images`, { name: 'p.png', type: 'image/png', data: png })).statusCode).toBe(201);
    expect(await status()).toBe('active');

    // والمسودة تبقى مسودة بتعديلها — النشر قرار البائع
    const draft = await simpleProduct('a', `EDIT-DRAFT-${SUFFIX}`);
    expect((await A.patch(`/vendor/products/${draft.id}`, { nameAr: 'اسم جديد للمسودة' })).json().status).toBe('draft');
  });
});

// ============================================================================
// خصيصة يراها كل بائع كانت تُنشأ وتُزاد قيمها بلا أثر في السجل (ACFG-086، 31 أكتوبر 2026)
describe('الخصائص في سجل التدقيق', () => {
  dbIt('إنشاء خصيصة وإضافة قيمة لها: سطر لكل منهما بالمدير وما أُضيف', async () => {
    const admin = await prisma.user.create({
      data: {
        email: `attr.admin.${SUFFIX}@basta.test`,
        fullName: 'مدير الخصائص',
        passwordHash: await hashPassword(randomUUID()),
        roles: { create: { role: 'admin' } },
        permissions: { create: { permission: 'catalog.manage' } },
        totpEnabledAt: new Date(),
      },
    });
    let attributeId: string | null = null;
    try {
      const { accessToken } = await app.get(TokenService).issue({ sub: admin.id, roles: ['admin'], permissions: ['catalog.manage'] }, {});
      const post = (url: string, payload: object) =>
        app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { authorization: `Bearer ${accessToken}`, 'user-agent': 'audit-spec/1' }, payload });
      const code = `audit_${SUFFIX}`;

      const created = await post('/admin/attributes', { code, nameAr: 'خامة الاختبار', inputType: 'select', values: [{ valueAr: 'قطن' }] });
      expect(created.statusCode, created.body).toBe(201);
      attributeId = created.json().id as string;
      const added = await post(`/admin/attributes/${attributeId}/values`, { valueAr: 'كتان' });
      expect(added.statusCode, added.body).toBe(201);

      const lines = await prisma.auditLog.findMany({ where: { entityType: 'Attribute', entityId: attributeId }, orderBy: { createdAt: 'asc' } });
      expect(lines.map((l) => l.action)).toEqual(['attribute.create', 'attribute.value_add']);
      for (const l of lines) expect(l).toMatchObject({ actorUserId: admin.id, actorRole: 'admin', userAgent: 'audit-spec/1' });
      expect(lines[0]!.afterJson).toMatchObject({ code, nameAr: 'خامة الاختبار', inputType: 'select', values: ['قطن'] });
      expect(lines[1]!.afterJson).toMatchObject({ attribute: 'خامة الاختبار', valueAr: 'كتان' });
    } finally {
      // لا يبقى مدير اختبار ولا خصيصة اختبار يراها البائعون على قاعدة التطوير
      await prisma.user.update({ where: { id: admin.id }, data: { status: 'suspended' } });
      if (attributeId) {
        await prisma.attributeValue.deleteMany({ where: { attributeId } });
        await prisma.attribute.delete({ where: { id: attributeId } });
      }
    }
  });
});

// كانت الإدارة تُنشئ الخصيصة فقط: الخطأ الإملائي لا يُصحَّح إلا من القاعدة، ولا حذف ولا
// أرشفة، ولا يُرى من يستعملها (ACFG-099، 1 نوفمبر 2026)
describe('الخصائص: تصحيح، وحذف غير المستعمل، وأرشفة المستعمل', () => {
  dbIt('تُصحَّح وتُحذف غير المستعملة، والمستعملة تُؤرشف فلا تُختار لمنتج جديد وتبقى لمنتجها', async () => {
    const admin = await prisma.user.create({
      data: {
        email: `attr.edit.${SUFFIX}@basta.test`,
        fullName: 'محرّر الخصائص',
        passwordHash: await hashPassword(randomUUID()),
        roles: { create: { role: 'admin' } },
        permissions: { create: { permission: 'catalog.manage' } },
        totpEnabledAt: new Date(),
      },
    });
    const created: string[] = [];
    try {
      const { accessToken } = await app.get(TokenService).issue({ sub: admin.id, roles: ['admin'], permissions: ['catalog.manage'] }, {});
      const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
        app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${accessToken}` }, ...(payload ? { payload } : {}) });
      const A = as('a');
      const product = (sku: string, axisId: string, valueId: string) => ({
        vendorCategoryId: firstCategory.get('a'),
        nameAr: 'منتج بمحور',
        variants: [{ sku, price: '10.00', stock: 2, options: [{ attributeId: axisId, valueId }] }],
      });
      await catOf('a');

      const res = await call('POST', '/admin/attributes', {
        code: `edit_axis_${SUFFIX}`,
        nameAr: 'قصة الاختبار',
        inputType: 'select',
        isVariantAxis: true,
        values: [{ valueAr: 'ضيق' }, { valueAr: 'واسع' }, { valueAr: 'زائدة' }],
      });
      expect(res.statusCode, res.body).toBe(201);
      const axis = res.json() as { id: string; values: { id: string; valueAr: string }[] };
      created.push(axis.id);
      const [narrow, wide, extra] = axis.values;

      // التصحيح: اسم الخصيصة واسم القيمة، ولا تكرار
      expect((await call('PATCH', `/admin/attributes/${axis.id}`, { nameAr: 'القصّة' })).statusCode).toBe(200);
      expect((await call('PATCH', `/admin/attributes/${axis.id}/values/${narrow!.id}`, { valueAr: 'ضيّق' })).statusCode).toBe(200);
      expect((await call('PATCH', `/admin/attributes/${axis.id}/values/${narrow!.id}`, { valueAr: 'واسع' })).statusCode).toBe(409);

      const made = await A.post('/vendor/products', product(`AXE-${SUFFIX}`, axis.id, narrow!.id));
      expect(made.statusCode, made.body).toBe(201);
      const used = made.json() as { id: string; variants: VariantJson[] };
      expect(used.variants[0]!.options[0]!.valueAr).toBe('ضيّق');

      // الحذف: غير المستعملة تُحذف، والمستعملة يُقال ما العمل بها
      expect((await call('DELETE', `/admin/attributes/${axis.id}/values/${extra!.id}`)).statusCode).toBe(204);
      const valueRefused = await call('DELETE', `/admin/attributes/${axis.id}/values/${narrow!.id}`);
      expect(valueRefused.statusCode).toBe(409);
      expect(valueRefused.json().message).toContain('صحّح اسمها');
      const attrRefused = await call('DELETE', `/admin/attributes/${axis.id}`);
      expect(attrRefused.statusCode).toBe(409);
      expect(attrRefused.json().message).toContain('أرشفها');

      // الأرشفة: القائمة تعرض الاستعمال والأرشفة، والمكتبة العامة تحمل العلامة
      expect((await call('POST', `/admin/attributes/${axis.id}/archive`)).statusCode).toBe(204);
      const listed = ((await call('GET', '/admin/attributes')).json() as {
        id: string;
        nameAr: string;
        archivedAt: string | null;
        _count: { variantOptions: number };
        values: { valueAr: string; _count: { variantOptions: number } }[];
      }[]).find((x) => x.id === axis.id)!;
      expect(listed).toMatchObject({ nameAr: 'القصّة', _count: { variantOptions: 1 } });
      expect(listed.archivedAt).not.toBeNull();
      expect(listed.values.map((v) => [v.valueAr, v._count.variantOptions])).toEqual([['ضيّق', 1], ['واسع', 0]]);
      const library = (await app.inject({ method: 'GET', url: '/api/v1/attributes' })).json() as { attributeId: string; archived: boolean }[];
      expect(library.find((x) => x.attributeId === axis.id)?.archived).toBe(true);

      // منتج جديد لا يختار المؤرشفة، والمنتج الذي يستعملها يُحفظ كما هو
      const fresh = await A.post('/vendor/products', product(`AXE2-${SUFFIX}`, axis.id, wide!.id));
      expect(fresh.statusCode).toBe(400);
      expect(fresh.json().message).toContain('مؤرشفة');
      const kept = await A.patch(`/vendor/products/${used.id}`, {
        nameAr: 'منتج بمحور معدَّل',
        variants: [{ id: used.variants[0]!.id, sku: `AXE-${SUFFIX}`, price: '11.00', options: [{ attributeId: axis.id, valueId: narrow!.id }] }],
      });
      expect(kept.statusCode, kept.body).toBe(200);

      // الاسترجاع يعيدها إلى الخيارات
      expect((await call('POST', `/admin/attributes/${axis.id}/restore`)).statusCode).toBe(204);
      expect((await A.post('/vendor/products', product(`AXE3-${SUFFIX}`, axis.id, wide!.id))).statusCode).toBe(201);

      // غير المستعملة تُحذف هي وقيمها
      const spare = (await call('POST', '/admin/attributes', { code: `edit_spare_${SUFFIX}`, nameAr: 'خصيصة زائدة', inputType: 'select', values: [{ valueAr: 'أ' }] })).json() as { id: string };
      created.push(spare.id);
      expect((await call('DELETE', `/admin/attributes/${spare.id}`)).statusCode).toBe(204);
      expect(await prisma.attribute.count({ where: { id: spare.id } })).toBe(0);
      expect(await prisma.attributeValue.count({ where: { attributeId: spare.id } })).toBe(0);

      const actions = await prisma.auditLog.findMany({
        where: { entityType: 'Attribute', entityId: { in: [axis.id, spare.id] }, actorUserId: admin.id },
        select: { action: true },
      });
      expect(new Set(actions.map((l) => l.action))).toEqual(
        new Set(['attribute.create', 'attribute.update', 'attribute.value_update', 'attribute.value_delete', 'attribute.archive', 'attribute.restore', 'attribute.delete']),
      );
    } finally {
      // لا يبقى مدير اختبار ولا خصيصة اختبار يراها البائعون على قاعدة التطوير
      await prisma.user.update({ where: { id: admin.id }, data: { status: 'suspended' } });
      for (const id of created) {
        await prisma.variantOptionValue.deleteMany({ where: { attributeId: id } });
        await prisma.attributeValue.deleteMany({ where: { attributeId: id } });
        await prisma.attribute.deleteMany({ where: { id } });
      }
    }
  });
});

// ============================================================================
describe('بوابة 05 · البند الثالث — الاستيراد الجماعي', () => {
  const HEADER = ['رمز_المنتج', 'SKU', 'الاسم_عربي', 'الفئة', 'السعر', 'السعر_قبل_الخصم', 'الكمية', 'الخيار_1', 'قيمة_الخيار_1', 'الخيار_2', 'قيمة_الخيار_2'];

  /** 250 منتجاً × مقاسان = 500 سطر، و 12 خطأً متنوعاً كلٌّ في منتج مختلف */
  function buildCsv(prefix: string): { csv: string; rejectedLines: number[] } {
    const rows: string[][] = [];
    for (let p = 0; p < 250; p++) {
      for (const size of ['M', 'L']) {
        rows.push([`${prefix}-P${p}`, `${prefix}-${p}-${size}`, `منتج مستورد ${p}`, 'قمصان مستوردة', '49.90', '', String((p % 7) + 1), 'المقاس', size, 'اللون', 'أسود']);
      }
    }
    const row = (i: number): string[] => rows[i] as string[];
    const errors: [number, (r: string[]) => void][] = [
      [3, (r) => { r[4] = 'مجاناً'; }],
      [40, (r) => { r[4] = '0'; }],
      [77, (r) => { r[6] = '-3'; }],
      [101, (r) => { r[6] = '2.5'; }],
      [150, (r) => { r[1] = ''; }],
      [188, (r) => { r[1] = 'قميص/أسود'; }],
      [233, (r) => { r[3] = 'ف'.repeat(81); }],
      [271, (r) => { r[8] = 'XXXL'; }],
      [300, (r) => { r[1] = row(298)[1] as string; }],
      [345, (r) => { r[5] = '10.00'; }],
      [402, (r) => { r[10] = ''; }],
      [467, (r) => { r[4] = '10.999'; }],
    ];
    for (const [i, mutate] of errors) mutate(row(i));

    const csv = `﻿${[HEADER, ...rows].map((r) => r.join(',')).join('\r\n')}\r\n`;
    return { csv, rejectedLines: errors.map(([i]) => i + 2).sort((a, b) => a - b) };
  }

  dbIt('500 سطر بينها 12 خطأ: يُستورد 488 ويُبلَّغ عن 12 بأرقام أسطرها', async () => {
    const A = as('a');
    const prefix = `IMP${SUFFIX}`;
    const { csv, rejectedLines } = buildCsv(prefix);
    const file = { name: 'منتجات.csv', type: 'text/csv', data: Buffer.from(csv, 'utf8') };

    const res = await A.upload('/vendor/catalog/import', file);
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report).toMatchObject({
      format: 'csv',
      totalRows: 500,
      imported: 488,
      productsCreated: 250,
      variantsCreated: 488,
      variantsUpdated: 0,
      rejectedCount: 12,
    });
    expect(report.rejected.map((r: { line: number }) => r.line)).toEqual(rejectedLines);
    expect(report.rejected.every((r: { reasons: unknown[] }) => r.reasons.length > 0)).toBe(true);

    const variants = await prisma.productVariant.findMany({
      where: { vendorId: vendors.a.vendorId, sku: { startsWith: `${prefix}-` }, archivedAt: null },
      select: { id: true },
    });
    expect(variants).toHaveLength(488);
    await expectNoDrift(variants.map((v) => v.id));
    expect(
      await prisma.product.count({ where: { vendorId: vendors.a.vendorId, nameAr: { startsWith: 'منتج مستورد' }, status: 'draft' } }),
    ).toBe(250);
    // الفئة بالاسم في متجر البائع: أُنشئت مرة واحدة بلا إدارة، والمنتجات كلها فيها
    const imported = await prisma.vendorCategory.findMany({
      where: { vendorId: vendors.a.vendorId, nameAr: 'قمصان مستوردة' },
      include: { _count: { select: { products: true } } },
    });
    expect(imported).toHaveLength(1);
    expect(imported[0]?._count.products).toBe(250);

    // رفع الملف نفسه مرة ثانية: الموجود يُحدَّث لا يتكرّر، والأخطاء نفسها تُبلَّغ
    const again = (await A.upload('/vendor/catalog/import', file)).json();
    expect(again).toMatchObject({ imported: 488, productsCreated: 0, variantsCreated: 0, variantsUpdated: 488, rejectedCount: 12 });
    expect(again.rejected.map((r: { line: number }) => r.line)).toEqual(rejectedLines);
    expect(await prisma.product.count({ where: { vendorId: vendors.a.vendorId, nameAr: { startsWith: 'منتج مستورد' } } })).toBe(250);
    expect(await prisma.vendorCategory.count({ where: { vendorId: vendors.a.vendorId, nameAr: 'قمصان مستوردة' } })).toBe(1);
    await expectNoDrift(variants.map((v) => v.id));
  }, 120_000);

  // موجة «يُؤتمت» الثالثة (2 نوفمبر 2026): مطابقة SKU في متجر البائع وحده — VCAT-083
  dbIt('SKU موجود في متجر آخر: الاستيراد ينشئ منتجاً جديداً هنا، ومتغيّر الآخر لا يُمسّ', async () => {
    const sku = `SHARED-${SUFFIX}`;
    const created = await as('b').post('/vendor/products', {
      vendorCategoryId: await catOf('b'),
      nameAr: 'منتج المتجر الآخر',
      attributes: [{ attributeId: attr('material').attributeId, text: 'قطن' }],
      variants: [{ sku, price: '10.00', stock: 7 }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const theirs = await prisma.productVariant.findFirstOrThrow({ where: { vendorId: vendors.b.vendorId, sku }, include: { inventory: true } });
    const movements = () => prisma.inventoryMovement.count({ where: { variantId: theirs.id } });
    const movesBefore = await movements();

    const csv = `﻿رمز_المنتج,SKU,الاسم_عربي,الفئة,السعر,الكمية\r\nSH-${SUFFIX},${sku},منتج بالرمز نفسه,قمصان مستوردة,1.00,0\r\n`;
    const res = await as('a').upload('/vendor/catalog/import', { name: 'shared.csv', type: 'text/csv', data: Buffer.from(csv, 'utf8') });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ imported: 1, productsCreated: 1, variantsCreated: 1, variantsUpdated: 0, rejectedCount: 0 });

    const mine = await prisma.productVariant.findFirstOrThrow({ where: { vendorId: vendors.a.vendorId, sku }, include: { product: true } });
    expect(mine.id).not.toBe(theirs.id);
    expect(mine.product.status).toBe('draft');
    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: theirs.id }, include: { inventory: true } });
    expect(after.priceMinorUnits).toBe(theirs.priceMinorUnits);
    expect(after.productId).toBe(theirs.productId);
    expect(after.inventory?.onHand).toBe(7);
    expect(await movements()).toBe(movesBefore);
  });

  dbIt('الملف الفاسد يُرفض كله ولا يترك بيانات جزئية', async () => {
    const A = as('a');
    const count = () => prisma.productVariant.count({ where: { vendorId: vendors.a.vendorId } });
    const before = await count();

    const unclosed = `﻿رمز_المنتج,SKU,الاسم_عربي,الفئة,السعر,الكمية\r\nX1,OK-${SUFFIX},منتج سليم,men-clothing,10.00,1\r\nX2,BROKEN-${SUFFIX},"منتج بلا إغلاق,men-clothing,10.00,1\r\n`;
    const broken = await A.upload('/vendor/catalog/import', { name: 'broken.csv', type: 'text/csv', data: Buffer.from(unclosed) });
    expect(broken.statusCode).toBe(422);
    expect(broken.json().code).toBe('IMPORT_FILE_REJECTED');

    const unknownColumn = `رمز_المنتج,SKU,الاسم_عربي,الفئة,السعر,الكمية,السعر_الجديد\r\nX1,U-${SUFFIX},منتج,men-clothing,10.00,1,9.00\r\n`;
    const unknown = await A.upload('/vendor/catalog/import', { name: 'u.csv', type: 'text/csv', data: Buffer.from(unknownColumn) });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().message).toContain('السعر_الجديد');

    const binary = await A.upload('/vendor/catalog/import', { name: 'x.csv', type: 'text/csv', data: Buffer.from([0xff, 0xfe, 0x00, 0x81, 0x9c]) });
    expect(binary.statusCode).toBe(422);

    expect(await count()).toBe(before);
  });

  dbIt('ملف Excel يمرّ بالقواعد نفسها، والقالب العربي يُستورد كما هو', async () => {
    const A = as('a');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('منتجات');
    sheet.addRow(['رمز_المنتج', 'SKU', 'الاسم_عربي', 'الفئة', 'السعر', 'الكمية', 'الخيار_1', 'قيمة_الخيار_1']);
    sheet.addRow([`XL-${SUFFIX}`, `XL-${SUFFIX}-M`, 'بنطال', 'men-clothing', 120, 7, 'المقاس', 'M']);
    sheet.addRow([`XL-${SUFFIX}`, `XL-${SUFFIX}-L`, 'بنطال', 'men-clothing', 120.5, 2, 'المقاس', 'L']);
    sheet.addRow([`XL-${SUFFIX}`, `XL-${SUFFIX}-XL`, 'بنطال', 'men-clothing', 'غالٍ', 2, 'المقاس', 'XL']);
    const data = Buffer.from(await workbook.xlsx.writeBuffer());

    const xlsx = await A.upload('/vendor/catalog/import', {
      name: 'products.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data,
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.json()).toMatchObject({ format: 'xlsx', imported: 2, rejectedCount: 1 });
    expect(xlsx.json().rejected[0].line).toBe(4);
    const priced = await prisma.productVariant.findFirstOrThrow({ where: { vendorId: vendors.a.vendorId, sku: `XL-${SUFFIX}-L` } });
    expect(priced.priceMinorUnits).toBe(12050n);

    const template = await A.get('/vendor/catalog/import/template');
    expect(template.statusCode).toBe(200);
    expect(template.headers['content-type']).toContain('text/csv');
    expect(template.body.startsWith('﻿رمز_المنتج')).toBe(true);

    const roundTrip = await A.upload('/vendor/catalog/import', { name: 'template.csv', type: 'text/csv', data: Buffer.from(template.rawPayload) });
    expect(roundTrip.statusCode).toBe(200);
    expect(roundTrip.json()).toMatchObject({ imported: 2, rejectedCount: 0 });
  }, 60_000);
});

// ============================================================================
describe('صور المنتجات', () => {
  dbIt('تُعاد كتابتها WebP و AVIF بحد 1600، والصغيرة والمزيّفة تُرفض، والحذف يزيل الملفات', async () => {
    const A = as('a');
    const product = await simpleProduct('a', `IMG-${SUFFIX}`);

    const png = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .png()
      .toBuffer();
    const uploaded = await A.upload(`/vendor/products/${product.id}/images`, { name: 'قميص.png', type: 'image/png', data: png }, { altAr: 'قميص أحمر' });
    expect(uploaded.statusCode).toBe(201);
    const image = uploaded.json();
    expect(image).toMatchObject({ width: 1600, height: 1200, altAr: 'قميص أحمر' });

    const webp = await app.inject({ method: 'GET', url: image.urls['full.webp'] });
    expect(webp.statusCode).toBe(200);
    expect((await sharp(webp.rawPayload).metadata()).format).toBe('webp');
    const avif = await app.inject({ method: 'GET', url: image.urls['full.avif'] });
    expect(avif.statusCode).toBe(200);
    expect(['heif', 'avif']).toContain((await sharp(avif.rawPayload).metadata()).format);
    const thumb = await app.inject({ method: 'GET', url: image.urls['thumb.webp'] });
    expect((await sharp(thumb.rawPayload).metadata()).width).toBe(400);

    const tiny = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const small = await A.upload(`/vendor/products/${product.id}/images`, { name: 'tiny.png', type: 'image/png', data: tiny });
    expect(small.statusCode).toBe(422);
    expect(small.json().code).toBe('IMAGE_REJECTED');

    const fake = await A.upload(`/vendor/products/${product.id}/images`, { name: 'fake.jpg', type: 'image/jpeg', data: Buffer.from('ليست صورة') });
    expect(fake.statusCode).toBe(422);

    expect((await A.delete(`/vendor/products/${product.id}/images/${image.id}`)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: image.urls['full.webp'] })).statusCode).toBe(404);
    expect((await A.get(`/vendor/products/${product.id}`)).json().images).toEqual([]);
  }, 60_000);

  dbIt('الترتيب: الأولى هي الرئيسية، والمجموعة كاملة أو 409، وتغيير الرئيسية يبقى منشوراً', async () => {
    const A = as('a');
    const product = await simpleProduct('a', `ORDER-${SUFFIX}`);
    const order = async () => ((await A.get(`/vendor/products/${product.id}`)).json().images as { id: string; sort: number }[]);
    const status = async () => (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status;

    const i1 = await withImage('a', product.id);
    const i2 = await withImage('a', product.id);
    const i3 = await withImage('a', product.id);
    // بعد حذف صورة لا تتساوى صورتان في الترتيب — كان ترتيب الجديدة عدد الصور فيساوي آخر باقية
    expect((await A.delete(`/vendor/products/${product.id}/images/${i1}`)).statusCode).toBe(204);
    const i4 = await withImage('a', product.id);
    const before = await order();
    expect(before.map((i) => i.id)).toEqual([i2, i3, i4]);
    expect(new Set(before.map((i) => i.sort)).size).toBe(3);

    await A.post(`/vendor/products/${product.id}/publish`);

    // الترتيب نفسه، أو تبديل ما بعد الرئيسية
    expect((await A.put(`/vendor/products/${product.id}/images/order`, { imageIds: [i2, i3, i4] })).statusCode).toBe(200);
    const swapped = await A.put(`/vendor/products/${product.id}/images/order`, { imageIds: [i2, i4, i3] });
    expect(swapped.statusCode, swapped.body).toBe(200);
    expect(swapped.json().map((i: { id: string }) => i.id)).toEqual([i2, i4, i3]);
    expect(await status()).toBe('active');

    // الرئيسية تغيّرت: تظهر للمشترين فوراً، والمنتج يبقى منشوراً (لا مراجعة)
    expect((await A.put(`/vendor/products/${product.id}/images/order`, { imageIds: [i4, i2, i3] })).statusCode).toBe(200);
    expect((await order()).map((i) => i.id)).toEqual([i4, i2, i3]);
    expect(await status()).toBe('active');

    // المجموعة كاملة وإلا 409، والمكرّر 400، وبائع آخر لا يرى المنتج
    expect((await A.put(`/vendor/products/${product.id}/images/order`, { imageIds: [i4, i2] })).statusCode).toBe(409);
    expect((await A.put(`/vendor/products/${product.id}/images/order`, { imageIds: [i4, i2, randomUUID()] })).statusCode).toBe(409);
    expect((await A.put(`/vendor/products/${product.id}/images/order`, { imageIds: [i4, i4, i2] })).statusCode).toBe(400);
    expect((await as('b').put(`/vendor/products/${product.id}/images/order`, { imageIds: [i4, i2, i3] })).statusCode).toBe(404);
    expect((await order()).map((i) => i.id)).toEqual([i4, i2, i3]);
  }, 60_000);

  dbIt('الصورة الوحيدة للمنتج المعروض لا تُحذف، وللمسودة تُحذف', async () => {
    const A = as('a');
    const product = await simpleProduct('a', `ONLY-${SUFFIX}`);
    const only = await withImage('a', product.id);
    await A.post(`/vendor/products/${product.id}/publish`);

    const refused = await A.delete(`/vendor/products/${product.id}/images/${only}`);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toContain('الوحيدة');
    // بعد إضافة غيرها تُحذف
    await withImage('a', product.id);
    expect((await A.delete(`/vendor/products/${product.id}/images/${only}`)).statusCode).toBe(204);

    const draft = await simpleProduct('a', `ONLY-DRAFT-${SUFFIX}`);
    const draftImage = await withImage('a', draft.id);
    expect((await A.delete(`/vendor/products/${draft.id}/images/${draftImage}`)).statusCode).toBe(204);
  }, 60_000);
});

// ============================================================================
describe('فئات المتجر — يديرها البائع بلا إدارة (قرار 14 أكتوبر 2026)', () => {
  interface CategoryJson {
    id: string;
    nameAr: string;
    sort: number;
    productCount: number;
  }
  const listOf = async (tag: Tag): Promise<CategoryJson[]> => (await as(tag).get('/vendor/categories')).json();

  dbIt('ينشئ ويسمّي ويرتّب ويحذف، والاسم المكرّر يُرفض ولو اختلفت فراغاته أو حالة أحرفه', async () => {
    const A = as('a');
    const created = await A.post('/vendor/categories', { nameAr: `قمصان ${SUFFIX}` });
    expect(created.statusCode, created.body).toBe(201);
    const shirts = created.json() as CategoryJson;
    const pants = (await A.post('/vendor/categories', { nameAr: `بناطيل ${SUFFIX}` })).json() as CategoryJson;
    expect(shirts).toMatchObject({ nameAr: `قمصان ${SUFFIX}`, productCount: 0 });
    expect(pants.sort).toBeGreaterThan(shirts.sort);

    const dup = await A.post('/vendor/categories', { nameAr: `  قمصان   ${SUFFIX.toUpperCase()} ` });
    expect(dup.statusCode).toBe(409);
    expect((await A.post('/vendor/categories', { nameAr: '   ' })).statusCode).toBe(400);

    // المنتج في فئته، والقائمة تعدّه، والتصفية بالفئة وبـ«بلا فئة»
    const product = await simpleProduct('a', `VC-${SUFFIX}`, shirts.id);
    expect((await A.get(`/vendor/products/${product.id}`)).json().vendorCategory).toEqual({ id: shirts.id, nameAr: shirts.nameAr });
    expect((await listOf('a')).find((c) => c.id === shirts.id)?.productCount).toBe(1);
    const inShirts = (await A.get(`/vendor/products?category=${shirts.id}&pageSize=100`)).json();
    expect(inShirts.items.map((p: { id: string }) => p.id)).toEqual([product.id]);
    const uncategorized = (await A.get('/vendor/products?category=none&pageSize=100')).json();
    expect(uncategorized.items.some((p: { id: string }) => p.id === product.id)).toBe(false);
    expect((await A.get('/vendor/products?category=shirts')).statusCode).toBe(400);

    // إعادة التسمية، والاسم المأخوذ يُرفض
    const renamed = await A.patch(`/vendor/categories/${shirts.id}`, { nameAr: `قمصان صيفية ${SUFFIX}` });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().nameAr).toBe(`قمصان صيفية ${SUFFIX}`);
    expect((await A.patch(`/vendor/categories/${shirts.id}`, { nameAr: pants.nameAr })).statusCode).toBe(409);

    // الترتيب: كل الفئات بلا نقص، والناقص يُرفض ولا يغيّر شيئاً
    const ids = (await listOf('a')).map((c) => c.id);
    const reversed = [...ids].reverse();
    const reordered = await A.put('/vendor/categories/order', { ids: reversed });
    expect(reordered.statusCode, reordered.body).toBe(200);
    expect((reordered.json() as CategoryJson[]).map((c) => c.id)).toEqual(reversed);
    expect((await A.put('/vendor/categories/order', { ids: reversed.slice(1) })).statusCode).toBe(400);
    expect((await listOf('a')).map((c) => c.id)).toEqual(reversed);

    // فئة فيها منتج لا تُحذف — لا منتج بلا فئة؛ تُحذف بعد نقله، والمنتج سليم في فئته الجديدة
    const blocked = await A.delete(`/vendor/categories/${shirts.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toMatch(/فيها 1 منتج — انقلها إلى فئة أخرى/);
    expect((await A.patch(`/vendor/products/${product.id}`, { vendorCategoryId: pants.id })).statusCode).toBe(200);
    const removed = await A.delete(`/vendor/categories/${shirts.id}`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ productsUncategorized: 0 });
    const after = (await A.get(`/vendor/products/${product.id}`)).json();
    expect(after.vendorCategory).toEqual({ id: pants.id, nameAr: pants.nameAr });
    expect(after.variants).toHaveLength(1);
    expect((await listOf('a')).some((c) => c.id === shirts.id)).toBe(false);
  });

  dbIt('العزل: بائع لا يرى فئة غيره ولا يضع منتجه فيها — والقاعدة نفسها ترفض الكتابة المباشرة', async () => {
    const own = (await as('a').post('/vendor/categories', { nameAr: `خاصة ${SUFFIX}` })).json() as CategoryJson;
    const B = as('b');

    expect((await listOf('b')).some((c) => c.id === own.id)).toBe(false);
    expect((await B.patch(`/vendor/categories/${own.id}`, { nameAr: 'مخترَقة' })).statusCode).toBe(404);
    expect((await B.delete(`/vendor/categories/${own.id}`)).statusCode).toBe(404);
    expect((await B.put('/vendor/categories/order', { ids: [own.id] })).statusCode).toBe(400);

    const foreign = await B.post('/vendor/products', {
      vendorCategoryId: own.id,
      nameAr: 'دخيل',
      variants: [{ sku: `VC-X-${SUFFIX}`, price: '10.000', stock: 1 }],
    });
    expect(foreign.statusCode).toBe(404);
    const mine = await simpleProduct('b', `VC-B-${SUFFIX}`);
    expect((await B.patch(`/vendor/products/${mine.id}`, { vendorCategoryId: own.id })).statusCode).toBe(404);

    // المفتاح الأجنبي المركّب (vendorCategoryId, vendorId): لا يمرّ ولو تجاوز أحدٌ الخدمة
    await expect(
      prisma.product.update({ where: { id: mine.id }, data: { vendorCategoryId: own.id } }),
    ).rejects.toThrow();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: mine.id } })).vendorCategoryId).toBe(await catOf('b'));
    expect((await as('a').get('/vendor/categories')).json().find((c: CategoryJson) => c.id === own.id)?.nameAr).toBe(`خاصة ${SUFFIX}`);
  });

  dbIt('نقل المنشور بين فئات المتجر يبقيه منشوراً، وصفحة المتجر تصفّي بها', async () => {
    const A = as('a');
    const offers = (await A.post('/vendor/categories', { nameAr: `عروض ${SUFFIX}` })).json() as CategoryJson;
    const empty = (await A.post('/vendor/categories', { nameAr: `فارغة ${SUFFIX}` })).json() as CategoryJson;
    const product = await simpleProduct('a', `VC-LIVE-${SUFFIX}`);
    await withImage('a', product.id);
    await A.post(`/vendor/products/${product.id}/publish`);

    const moved = await A.patch(`/vendor/products/${product.id}`, { vendorCategoryId: offers.id });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ status: 'active', vendorCategory: { id: offers.id } });
    // لا يُخرج من كل فئة: null مرفوض والمنتج باقٍ في فئته منشوراً
    const out = await A.patch(`/vendor/products/${product.id}`, { vendorCategoryId: null });
    expect(out.statusCode).toBe(400);
    expect((await A.get(`/vendor/products/${product.id}`)).json()).toMatchObject({ status: 'active', vendorCategory: { id: offers.id } });

    // المشتري يرى الفئة التي فيها معروض وحدها، ويصفّي منتجات المتجر بها
    await A.patch(`/vendor/products/${product.id}`, { vendorCategoryId: offers.id });
    const shop = (await app.inject({ method: 'GET', url: `/api/v1/storefront/shops/v-a-${SUFFIX}` })).json();
    const shown = (shop.categories as { id: string; count: number }[]).map((c) => c.id);
    expect(shown).toContain(offers.id);
    expect(shown).not.toContain(empty.id);
    const filtered = (
      await app.inject({ method: 'GET', url: `/api/v1/storefront/shops/v-a-${SUFFIX}?category=${offers.id}` })
    ).json();
    expect(filtered.products.map((p: { id: string }) => p.id)).toEqual([product.id]);
    expect(filtered.total).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/api/v1/storefront/shops/v-a-${SUFFIX}?category=x` })).statusCode).toBe(400);
  });

  dbIt('كل متجر جديد يبدأ بالفئات الثماني المقترحة بترتيبها، ويعدّلها كفئاته', async () => {
    const owner = await prisma.user.create({ data: { email: `tpl.${SUFFIX}@basta.test`, fullName: 'قوالب الفئات' } });
    const v = await prisma.vendor.create({
      data: { ownerUserId: owner.id, slug: `tpl-${SUFFIX}`, nameAr: 'متجر القوالب', country: 'JO', settlementCurrency: 'JOD' },
    });
    const names = (await prisma.vendorCategory.findMany({ where: { vendorId: v.id }, orderBy: { sort: 'asc' } })).map((c) => c.nameAr);
    expect(names).toEqual([
      'أزياء وملابس',
      'أحذية وحقائب',
      'إلكترونيات',
      'المنزل والمطبخ',
      'الجمال والعناية',
      'أطفال وألعاب',
      'رياضة وهوايات',
      'طعام ومنتجات محلية',
    ]);
    // قوالب لا قيود: تُعاد تسميتها وتُحذف كأي فئة للمتجر
    const first = await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId: v.id }, orderBy: { sort: 'asc' } });
    await prisma.vendorCategory.update({ where: { id: first.id }, data: { nameAr: 'عبايات' } });
    expect(await prisma.vendorCategory.count({ where: { vendorId: v.id } })).toBe(8);
  });

  dbIt('لا منتج بلا فئة: الإنشاء بلا فئة يُرفض، والقديم بلا فئة يبقى ظاهراً ويُصنَّف عند أوّل تعديل أو نشر', async () => {
    const A = as('a');
    const none = await A.post('/vendor/products', { nameAr: 'بلا فئة', variants: [{ sku: `VC-NONE-${SUFFIX}`, price: '10.000', stock: 1 }] });
    expect(none.statusCode).toBe(400);
    // رسائل التحقق مصفوفة — رسالة الفئة بينها
    expect([none.json().message].flat().join(' ')).toMatch(/اختر فئة للمنتج/);

    // منتج سبق القرار: منشور بلا فئة — يبقى منشوراً، ولا يُعدَّل ولا يُعاد نشره قبل تصنيفه
    const legacy = await simpleProduct('a', `VC-OLD-${SUFFIX}`);
    await withImage('a', legacy.id);
    expect((await A.post(`/vendor/products/${legacy.id}/publish`)).statusCode).toBe(200);
    await prisma.product.update({ where: { id: legacy.id }, data: { vendorCategoryId: null } });
    expect((await A.get(`/vendor/products/${legacy.id}`)).json()).toMatchObject({ status: 'active', vendorCategory: null });

    const rename = await A.patch(`/vendor/products/${legacy.id}`, { nameAr: 'اسم جديد' });
    expect(rename.statusCode).toBe(400);
    expect(rename.json().message).toMatch(/اختر فئة للمنتج قبل الحفظ/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: legacy.id } })).nameAr).toBe('منتج بسيط');

    await prisma.product.update({ where: { id: legacy.id }, data: { status: 'draft' } });
    const blocked = await A.post(`/vendor/products/${legacy.id}/publish`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toContain('اختر فئة للمنتج');

    const fixed = await A.patch(`/vendor/products/${legacy.id}`, { nameAr: 'اسم جديد', vendorCategoryId: await catOf('a') });
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect((await A.post(`/vendor/products/${legacy.id}/publish`)).statusCode).toBe(200);
  });
});

// ============================================================================
describe('صور المنتجات: الظاهر للعموم، والمسودّة والمرفوض برابط موقَّع، والمحذوف بلا ملف', () => {
  const get = (url: string) => app.inject({ method: 'GET', url });
  const bare = (url: string) => url.split('?')[0]!;
  const image = () => sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 30, g: 90, b: 60 } } }).png().toBuffer();
  const uploadTo = async (id: string) => {
    const up = await as('a').upload(`/vendor/products/${id}/images`, { name: 'p.png', type: 'image/png', data: await image() });
    expect(up.statusCode, up.body).toBe(201);
    return up.json() as { id: string; urls: Record<string, string> };
  };
  const live = async (id: string) => {
    expect((await as('a').post(`/vendor/products/${id}/publish`)).json().status).toBe('active');
  };

  dbIt('المسودّة: الرابط الموقَّع وحده يفتحها — لا العاري ولا المزوَّر', async () => {
    const draft = await simpleProduct('a', `IMG-DRAFT-${SUFFIX}`);
    const signed = (await uploadTo(draft.id)).urls['thumb.webp']!;
    expect(signed).toMatch(/\?s=\d+\.[\w-]{22}$/);
    expect((await get(signed)).statusCode).toBe(200);
    expect((await get(bare(signed))).statusCode).toBe(404);
    expect((await get(`${bare(signed)}?s=9999999999.${'A'.repeat(22)}`)).statusCode).toBe(404);
  });

  dbIt('المنشور للعموم، والمرفوض يُحجب عنهم', async () => {
    const shown = await simpleProduct('a', `IMG-LIVE-${SUFFIX}`);
    const shownUrl = bare((await uploadTo(shown.id)).urls['thumb.webp']!);
    await live(shown.id);
    expect((await get(shownUrl)).statusCode).toBe(200);

    const refused = await simpleProduct('a', `IMG-REJ-${SUFFIX}`);
    const refusedImg = await uploadTo(refused.id);
    await live(refused.id);
    await app.get(ProductService).reject(refused.id, 'الصورة مخالفة لسياسة المنصة.');
    expect((await get(bare(refusedImg.urls['thumb.webp']!))).statusCode).toBe(404);
    // وصاحبه ومراجِعه يرونها برابطهم الموقَّع
    expect((await get(refusedImg.urls['thumb.webp']!)).statusCode).toBe(200);
  });

  dbIt('حذف المنتج يحذف ملفات صوره التي لا يذكرها طلب', async () => {
    const gone = await simpleProduct('a', `IMG-DEL-${SUFFIX}`);
    const img = await uploadTo(gone.id);
    const key = bare(img.urls['thumb.webp']!).replace(/^\/uploads\//, '').replace(/\/thumb\.webp$/, '');
    const file = join(UPLOADS_ROOT, ...key.split('/'), 'thumb.webp');
    expect(existsSync(file)).toBe(true);
    expect((await as('a').delete(`/vendor/products/${gone.id}`)).statusCode).toBeLessThan(300);
    expect(existsSync(file)).toBe(false);
    expect(await prisma.productImage.count({ where: { id: img.id } })).toBe(0);
    expect((await get(img.urls['thumb.webp']!)).statusCode).toBe(404);
  });
});

/**
 * موجة «يُؤتمت» الرابعة (3 نوفمبر 2026): حدود المنتج والمتغيّرات والخصائص على الخادم، والنشر
 * بحسب حالة المتجر — ما لا تمنعه الواجهة وحدها.
 */
describe('حدود المنتجات والخصائص — يُؤتمت 4', () => {
  const messages = (res: { json: () => { message?: string | string[] } }) => [res.json().message].flat();
  const material = () => [{ attributeId: attr('material').attributeId, text: 'قطن' }];

  dbIt('معرّف متغيّر من منتج آخر 404 ولا يُمسّ، والمكرّر 400، والمعرّف على منتج جديد 400 (VCAT-033)', async () => {
    const A = as('a');
    const p1 = await simpleProduct('a', `V33A-${SUFFIX}`);
    const p2 = await simpleProduct('a', `V33B-${SUFFIX}`);
    const v1 = p1.variants[0]!;
    const v2 = p2.variants[0]!;
    const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: v2.id } });

    const foreign = await A.patch(`/vendor/products/${p1.id}`, { variants: [{ id: v2.id, sku: v2.sku, price: '99.00' }] });
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(messages(foreign)).toContain('المتغيّر غير موجود في هذا المنتج.');
    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: v2.id } });
    expect(after.productId).toBe(p2.id);
    expect(after.priceMinorUnits).toBe(before.priceMinorUnits);
    expect(after.archivedAt).toBeNull();

    const twice = await A.patch(`/vendor/products/${p1.id}`, {
      variants: [{ id: v1.id, sku: v1.sku, price: '10.00' }, { id: v1.id, sku: v1.sku, price: '11.00' }],
    });
    expect(twice.statusCode, twice.body).toBe(400);
    expect(messages(twice)).toContain('المتغيّر نفسه مذكور مرتين.');

    const sku = `V33C-${SUFFIX}`;
    const fresh = await A.post('/vendor/products', {
      vendorCategoryId: await catOf('a'),
      nameAr: 'منتج بمعرّف متغيّر',
      attributes: material(),
      variants: [{ id: randomUUID(), sku, price: '10.00', stock: 1 }],
    });
    expect(fresh.statusCode, fresh.body).toBe(400);
    expect(messages(fresh)).toContain('متغيّرات المنتج الجديد لا تحمل معرّفات — المعرّف يُنشأ عند الحفظ.');
    expect(await prisma.productVariant.count({ where: { sku } })).toBe(0);
  });

  dbIt('إنشاءان متزامنان بالـ SKU الجديد نفسه: 201 و 409 DUPLICATE، ومتغيّر حيّ واحد ولا منتج يتيم (VCAT-034)', async () => {
    const A = as('a');
    const sku = `RACE-${SUFFIX}`;
    const category = await catOf('a');
    const name = (n: number) => `منتج السباق ${n} ${SUFFIX}`;
    const results = await Promise.all(
      [1, 2].map((n) =>
        A.post('/vendor/products', { vendorCategoryId: category, nameAr: name(n), attributes: material(), variants: [{ sku, price: '10.00', stock: 1 }] }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const lost = results.find((r) => r.statusCode === 409)!;
    expect(lost.json().code).toBe('DUPLICATE');
    expect([
      `SKU «${sku}» مستعمل لمتغيّر آخر في متجرك.`,
      'SKU مستعمل لمتغيّر آخر في متجرك — لكل متغيّر حيّ SKU فريد على مستوى المتجر.',
    ]).toContain(lost.json().message);

    const ours = { vendorId: vendors.a.vendorId, nameAr: { in: [name(1), name(2)] } };
    expect(await prisma.productVariant.count({ where: { vendorId: vendors.a.vendorId, sku, archivedAt: null } })).toBe(1);
    expect(await prisma.product.count({ where: ours })).toBe(1);
    expect(await prisma.product.count({ where: { ...ours, variants: { none: {} } } })).toBe(0);
  });

  dbIt('متجر معلَّق أو محظور أو مرفوض لا ينشر: 409 بعائقه، والمنتج يبقى مسوّدة (VCAT-051)', async () => {
    const B = as('b');
    const product = await simpleProduct('b', `V51-${SUFFIX}`);
    await withImage('b', product.id);
    const cases: ['suspended' | 'banned' | 'rejected', string][] = [
      ['suspended', 'المتجر معلَّق — لا تنشر منتجاً حتى يُرفع التعليق'],
      ['banned', 'المتجر معلَّق — لا تنشر منتجاً حتى يُرفع التعليق'],
      ['rejected', 'أرسل طلب متجرك للمراجعة أولاً — النشر يُتاح من لحظة إرساله'],
    ];
    try {
      for (const [status, reason] of cases) {
        // المرفوض يحمل سببه دائماً (قيد vendors_rejection_reason_check)
        await prisma.vendor.update({ where: { id: vendors.b.vendorId }, data: { status, rejectionReason: status === 'rejected' ? 'الوثائق غير واضحة — أعد رفعها.' : null } });
        const res = await B.post(`/vendor/products/${product.id}/publish`);
        expect(res.statusCode, `${status}: ${res.body}`).toBe(409);
        expect(res.json().details.reasons, status).toContain(reason);
        expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status, status).toBe('draft');
      }
    } finally {
      await prisma.vendor.update({ where: { id: vendors.b.vendorId }, data: { status: 'approved', rejectionReason: null } });
    }
  });

  dbIt('رمز الخصيصة وتفرّده واسمها ونوعها وقيمها: كل رفض بلا خصيصة، والحدّان يُقبلان (ACFG-095)', async () => {
    const admin = await prisma.user.create({
      data: {
        email: `attr.bounds.${SUFFIX}@basta.test`,
        fullName: 'حدود الخصائص',
        passwordHash: await hashPassword(randomUUID()),
        roles: { create: { role: 'admin' } },
        permissions: { create: { permission: 'catalog.manage' } },
        totpEnabledAt: new Date(),
      },
    });
    const { accessToken } = await app.get(TokenService).issue({ sub: admin.id, roles: ['admin'], permissions: ['catalog.manage'] }, {});
    const post = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/v1/admin/attributes', headers: { authorization: `Bearer ${accessToken}` }, payload });
    const created: string[] = [];
    const tail = SUFFIX.replace(/[^a-z0-9]/g, '');
    try {
      const shape = 'رمز السمة حروف لاتينية صغيرة وأرقام و _ ويبدأ بحرف.';
      const malformed = ['1size', 's', 'size-x', `a${tail}`.padEnd(42, 'x')];
      for (const code of malformed) {
        const res = await post({ code, nameAr: 'سمة الحدود', inputType: 'text' });
        expect(res.statusCode, code).toBe(400);
        expect(messages(res), code).toContain(shape);
      }
      // الحدّان: حرفان (أول رمز من حرفين غير مستعمل) و 41
      const taken = new Set((await prisma.attribute.findMany({ select: { code: true } })).map((a) => a.code));
      const two = [...'qwzjkvx'].flatMap((c) => [...'0123456789'].map((d) => `${c}${d}`)).find((c) => !taken.has(c))!;
      for (const code of [two, `b${tail}`.padEnd(41, 'y')]) {
        expect([2, 41]).toContain(code.length);
        const res = await post({ code, nameAr: 'سمة الحدود', inputType: 'text' });
        expect(res.statusCode, `${code}: ${res.body}`).toBe(201);
        created.push(res.json().id);
      }

      const dup = await post({ code: 'size', nameAr: 'مقاس آخر', inputType: 'select', values: [{ valueAr: 'S' }] });
      expect(dup.statusCode).toBe(409);
      expect(messages(dup)).toContain('رمز السمة «size» مستعمل.');

      const rejected = { name: `n${tail}`, type: `t${tail}`, values: `v${tail}`, many: `m${tail}` };
      const shortName = await post({ code: rejected.name, nameAr: 'س', inputType: 'text' });
      expect(shortName.statusCode).toBe(400);
      expect(messages(shortName)).toContain('الاسم بالعربية: 2 أحرف على الأقل.');
      const date = await post({ code: rejected.type, nameAr: 'تاريخ', inputType: 'date' });
      expect(date.statusCode).toBe(400);
      expect(messages(date)).toContain('نوع السمة غير معروف.');
      const twice = await post({ code: rejected.values, nameAr: 'لون الحدود', inputType: 'select', values: [{ valueAr: 'Red' }, { valueAr: 'red' }] });
      expect(twice.statusCode).toBe(409);
      expect(messages(twice)).toContain('القيمة «red» مكررة في السمة — الاستيراد يطابق بالاسم فلا يُقبل تكراره.');
      const many = await post({
        code: rejected.many,
        nameAr: 'كثيرة',
        inputType: 'select',
        values: Array.from({ length: 201 }, (_, i) => ({ valueAr: `قيمة ${i}` })),
      });
      expect(many.statusCode).toBe(400);
      expect(messages(many)).toContain('أحد الحقول: 200 على الأكثر.');

      expect(await prisma.attribute.count({ where: { code: { in: [...malformed, ...Object.values(rejected)] } } })).toBe(0);
    } finally {
      for (const id of created) {
        await app.inject({ method: 'DELETE', url: `/api/v1/admin/attributes/${id}`, headers: { authorization: `Bearer ${accessToken}` } });
      }
    }
  });
});
