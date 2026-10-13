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
import { hashPassword } from '../identity/public';
import { CategoryService, ProductService, UPLOADS_ROOT, type EffectiveAttribute } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `cat${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';

type Tag = 'a' | 'b' | 'pending';
const vendors = {} as Record<Tag, { userId: string; vendorId: string; token: string }>;
let menClothing = '';
let fashion = '';
let attributes: EffectiveAttribute[] = [];

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

  const specs: [Tag, 'approved' | 'pending', string][] = [
    ['a', 'approved', 'SAR'],
    ['b', 'approved', 'JOD'],
    ['pending', 'pending', 'SAR'],
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

  menClothing = (await prisma.category.findUniqueOrThrow({ where: { slug: 'men-clothing' } })).id;
  fashion = (await prisma.category.findUniqueOrThrow({ where: { slug: 'fashion' } })).id;
  const res = await app.inject({ method: 'GET', url: `/api/v1/categories/${menClothing}/attributes` });
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
    await prisma.category.deleteMany({ where: { slug: { contains: SUFFIX } } });
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

/** نسخة المحتوى الحالية — ما يراه المراجِع حين يفتح المنتج */
const revOf = async (id: string): Promise<number> =>
  (await prisma.product.findUniqueOrThrow({ where: { id }, select: { contentRevision: true } })).contentRevision;

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

const attr = (code: string): EffectiveAttribute => {
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

async function simpleProduct(tag: Tag, sku: string, categoryId = menClothing) {
  const res = await as(tag).post('/vendor/products', {
    categoryId,
    nameAr: 'منتج بسيط',
    attributes: [{ attributeId: attr('material').attributeId, text: 'قطن' }],
    variants: [{ sku, price: '10.00', stock: 2 }],
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; variants: VariantJson[] };
}

/** صورة حقيقية للمنتج — الإرسال للمراجعة يشترط صورة واحدة على الأقل */
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

    // ---- الإنشاء: الفئة فرعية، والسمات موروثة من «ملابس وأحذية»
    const created = await A.post('/vendor/products', {
      categoryId: menClothing,
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

    // ---- النشر طلب مراجعة (Q-15)، والمعتمد لا يُفرَّغ من سماته الإلزامية
    await withImage('a', product.id);
    const submitted = await A.post(`/vendor/products/${product.id}/publish`);
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().status).toBe('pending_review');
    await app.get(ProductService).approve(product.id, await revOf(product.id));
    expect((await A.get(`/vendor/products/${product.id}`)).json().status).toBe('active');
    const stripped = await A.patch(`/vendor/products/${product.id}`, { attributes: [] });
    expect(stripped.statusCode).toBe(400);
    expect(stripped.json().message).toContain('الخامة');

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
      categoryId: menClothing,
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
      categoryId: menClothing,
      nameAr: 'شماغ',
      variants: [{ sku: `JOD-${SUFFIX}`, price: '12.500', stock: 1 }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().variants[0].price).toMatchObject({ minorUnits: '12500', currency: 'JOD' });
    expect(res.json().variants[0].price.formatted).toContain('12.500');

    const numeric = await as('b').post('/vendor/products', {
      categoryId: menClothing,
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
    expect((await as('a').post('/admin/categories', { slug: 'x-y', nameAr: 'فئة' })).statusCode).toBe(403);
    expect((await as('a').get('/vendor/products/not-a-uuid')).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/vendor/products' })).statusCode).toBe(401);
  });
});

// ============================================================================
describe('النشر', () => {
  dbIt('يُمنع بكل أسبابه معاً: متجر غير معتمد وسمة إلزامية ناقصة ولا صورة', async () => {
    const P = as('pending');
    const created = await P.post('/vendor/products', {
      categoryId: fashion,
      nameAr: 'حذاء',
      variants: [{ sku: `PEND-${SUFFIX}`, price: '150.00', stock: 2 }],
    });
    expect(created.statusCode).toBe(201);

    const res = await P.post(`/vendor/products/${created.json().id}/publish`);
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe('PUBLISH_BLOCKED');
    expect(body.details.reasons).toHaveLength(3);
    expect(body.message).toContain('لم يُعتمد');
    expect(body.message).toContain('الخامة');
    expect(body.message).toContain('صورة واحدة على الأقل');
  });

  dbIt('الصورة شرط للإرسال: بلا صورة يُمنع، وبصورة يصل المراجعة', async () => {
    const A = as('a');
    const product = await simpleProduct('a', `NOIMG-${SUFFIX}`);
    const blocked = await A.post(`/vendor/products/${product.id}/publish`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().details.reasons).toEqual(['أضف صورة واحدة على الأقل — الأولى هي الرئيسية في المتجر']);

    await withImage('a', product.id);
    const submitted = await A.post(`/vendor/products/${product.id}/publish`);
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().status).toBe('pending_review');
  });

  dbIt('سمة متغيّرات لا تخصّ الفئة تُرفض: «المقاس» على بقالة', async () => {
    const grocery = (await prisma.category.findUniqueOrThrow({ where: { slug: 'grocery' } })).id;
    const res = await as('a').post('/vendor/products', {
      categoryId: grocery,
      nameAr: 'أرز',
      variants: [
        { sku: `RICE-M-${SUFFIX}`, price: '20.00', stock: 1, options: [opt('size', 'M')] },
        { sku: `RICE-L-${SUFFIX}`, price: '30.00', stock: 1, options: [opt('size', 'L')] },
      ],
    });
    expect(res.statusCode).toBe(400);
  });
});

// ============================================================================
describe('مراجعة المنتجات قبل النشر — Q-15', () => {
  dbIt('الإرسال يضع المنتج قيد المراجعة، والإدارة وحدها تعتمده أو ترفضه بسبب يراه البائع', async () => {
    const A = as('a');
    const service = app.get(ProductService);
    const product = await simpleProduct('a', `REVIEW-${SUFFIX}`);
    await withImage('a', product.id);

    const submitted = await A.post(`/vendor/products/${product.id}/publish`);
    expect(submitted.json().status).toBe('pending_review');
    // الإرسال المكرر لا يغيّر شيئاً
    expect((await A.post(`/vendor/products/${product.id}/publish`)).json().status).toBe('pending_review');

    // البائع لا يصل لمسارات الاعتماد والطابور
    expect((await A.post(`/admin/products/${product.id}/approve`)).statusCode).toBe(403);
    expect((await A.get('/admin/products?status=pending_review')).statusCode).toBe(403);

    // قيد المراجعة لا يُفرَّغ من سماته الإلزامية — وإلا اعتمدته الإدارة ناقصاً
    const stripped = await A.patch(`/vendor/products/${product.id}`, { attributes: [] });
    expect(stripped.statusCode).toBe(400);
    expect(stripped.json().message).toContain('قيد المراجعة');

    // الرفض بسبب يصل للبائع كما كُتب
    await service.reject(product.id, 'الصور لا تطابق المنتج الموصوف.');
    expect((await A.get(`/vendor/products/${product.id}`)).json()).toMatchObject({
      status: 'rejected',
      rejectReason: 'الصور لا تطابق المنتج الموصوف.',
    });

    // المرفوض يُعاد إرساله بعد الإصلاح ثم يُعتمد، والسبب القديم يُمسح
    expect((await A.post(`/vendor/products/${product.id}/publish`)).json()).toMatchObject({
      status: 'pending_review',
      rejectReason: null,
    });
    await service.approve(product.id, await revOf(product.id));
    const approved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(approved.status).toBe('active');
    expect(approved.publishedAt).not.toBeNull();

    // الاعتماد مرتين انتقال غير مسموح
    await expect(service.approve(product.id, await revOf(product.id))).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  dbIt('البائع يعدّل بعد أن فتح المراجِع المنتج: الاعتماد يُردّ ولا يُنشر ما لم يُقرأ', async () => {
    const A = as('a');
    const service = app.get(ProductService);
    const product = await simpleProduct('a', `REREAD-${SUFFIX}`);
    await withImage('a', product.id);
    await A.post(`/vendor/products/${product.id}/publish`);

    // المراجِع يفتحه: النسخة في تفاصيله
    const opened = await service.adminGet({ userId: vendors.a.userId, roles: ['admin'] } as never, product.id);
    expect(opened.status).toBe('pending_review');

    // والبائع يغيّر الاسم والوصف قبل الاعتماد
    const edited = await A.patch(`/vendor/products/${product.id}`, { nameAr: 'اسم آخر لم يقرأه أحد', descriptionAr: 'وصف جديد' });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().contentRevision).toBe(opened.contentRevision + 1);

    const stale = await service.approve(product.id, opened.contentRevision).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(ConflictError);
    expect((stale as ConflictError).details).toEqual({ reason: 'CONTENT_CHANGED', contentRevision: opened.contentRevision + 1 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('pending_review');

    // يعيد الفتح فيقرأ الجديد ويعتمده
    await service.approve(product.id, opened.contentRevision + 1);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ status: 'active', nameAr: 'اسم آخر لم يقرأه أحد' });
  });

  dbIt('إضافة صورة أو حذفها نسخة جديدة، والسعر لا', async () => {
    const A = as('a');
    const service = app.get(ProductService);
    const sku = `REV-IMG-${SUFFIX}`;
    const product = await simpleProduct('a', sku);
    const variantId = product.variants[0]?.id as string;
    await withImage('a', product.id);
    await A.post(`/vendor/products/${product.id}/publish`);
    const r0 = await revOf(product.id);

    // السعر تشغيل لا محتوى (Q-16) — الاعتماد بالنسخة المفتوحة يمرّ بعده
    expect((await A.patch(`/vendor/products/${product.id}`, { variants: [{ id: variantId, sku, price: '15.00', stock: 4 }] })).statusCode).toBe(200);
    expect(await revOf(product.id)).toBe(r0);

    const png = await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 20, g: 90, b: 140 } } }).png().toBuffer();
    const up = await A.upload(`/vendor/products/${product.id}/images`, { name: 'p.png', type: 'image/png', data: png });
    expect(up.statusCode, up.body).toBe(201);
    expect(await revOf(product.id)).toBe(r0 + 1);
    await expect(service.approve(product.id, r0)).rejects.toBeInstanceOf(ConflictError);

    expect((await A.delete(`/vendor/products/${product.id}/images/${up.json().id}`)).statusCode).toBeLessThan(300);
    expect(await revOf(product.id)).toBe(r0 + 2);
    await service.approve(product.id, r0 + 2);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('active');
  });

  dbIt('المسودة لم تُرسل فلا تُعتمد ولا تُرفض، والطابور لا يحوي إلا ما ينتظر', async () => {
    const service = app.get(ProductService);
    const draft = await simpleProduct('a', `DRAFT-${SUFFIX}`);
    await withImage('a', draft.id);

    await expect(service.approve(draft.id, await revOf(draft.id))).rejects.toBeInstanceOf(InvalidStateTransitionError);
    await expect(service.reject(draft.id, 'سبب كافٍ للرفض')).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('draft');

    await as('a').post(`/vendor/products/${draft.id}/publish`);
    // الطابور بالأقدم أولاً، وقاعدة التطوير تتراكم فيها منتجات تنتظر من تشغيلات سابقة:
    // يُتصفَّح صفحةً صفحة حتى يظهر — لا يُفترض أن الصفحة الأولى تكفي
    const seen: { id: string; status: string; vendor: { nameAr: string } }[] = [];
    for (let page = 1; page <= 50 && !seen.some((p) => p.id === draft.id); page++) {
      const queue = await service.adminList({ status: 'pending_review', pageSize: 100, page });
      seen.push(...queue.items);
      if (queue.items.length < 100) break;
    }
    expect(seen.some((p) => p.id === draft.id)).toBe(true);
    expect(seen.every((p) => p.status === 'pending_review')).toBe(true);
    expect(seen.find((p) => p.id === draft.id)?.vendor.nameAr).toBe('متجر a');

    // سحب الإرسال يعيده مسودة ويخرجه من الطابور
    expect((await as('a').post(`/vendor/products/${draft.id}/unpublish`)).json().status).toBe('draft');
    // الطابور هو ما حالته pending_review — والصفحة الأولى وحدها قد لا تحويه أصلاً فتنجح كذباً
    expect(await prisma.product.count({ where: { id: draft.id, status: 'pending_review', deletedAt: null } })).toBe(0);
  });
});

// ============================================================================
describe('تعديل المنشور — Q-16', () => {
  dbIt('تعديل المحتوى يعيد المنشور للمراجعة، والسعر والمخزون لا يعيدانه', async () => {
    const A = as('a');
    const service = app.get(ProductService);
    const sku = `EDIT-${SUFFIX}`;
    const product = await simpleProduct('a', sku);
    const variantId = product.variants[0]?.id as string;
    const status = async () => (await A.get(`/vendor/products/${product.id}`)).json().status;
    const publish = async () => {
      await A.post(`/vendor/products/${product.id}/publish`);
      await service.approve(product.id, await revOf(product.id));
      expect(await status()).toBe('active');
    };
    await withImage('a', product.id);
    await publish();

    // السعر والمخزون تشغيل يومي لا محتوى — يبقى منشوراً
    const repriced = await A.patch(`/vendor/products/${product.id}`, {
      variants: [{ id: variantId, sku, price: '12.50', stock: 9 }],
    });
    expect(repriced.statusCode).toBe(200);
    expect(repriced.json().status).toBe('active');
    const stock = await A.patch(`/vendor/products/${product.id}/variants/${variantId}/stock`, {
      delta: -1,
      reason: 'damage',
    });
    expect(stock.statusCode).toBe(200);
    expect(await status()).toBe('active');

    // إرسال الاسم نفسه ليس تعديلاً
    expect((await A.patch(`/vendor/products/${product.id}`, { nameAr: 'منتج بسيط' })).json().status).toBe('active');

    // الاسم محتوى — يعود للمراجعة، ويبقى تاريخ نشره الأول
    const renamed = await A.patch(`/vendor/products/${product.id}`, { nameAr: 'منتج بسيط محسَّن' });
    expect(renamed.json().status).toBe('pending_review');
    expect(renamed.json().publishedAt).not.toBeNull();

    // الصور محتوى أيضاً
    await publish();
    const png = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 90, g: 30, b: 50 } } })
      .png()
      .toBuffer();
    const uploaded = await A.upload(`/vendor/products/${product.id}/images`, { name: 'p.png', type: 'image/png', data: png });
    expect(uploaded.statusCode).toBe(201);
    expect(await status()).toBe('pending_review');

    // والمسودة لا تُرسل للمراجعة بتعديلها
    const draft = await simpleProduct('a', `EDIT-DRAFT-${SUFFIX}`);
    expect((await A.patch(`/vendor/products/${draft.id}`, { nameAr: 'اسم جديد للمسودة' })).json().status).toBe('draft');
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
        rows.push([`${prefix}-P${p}`, `${prefix}-${p}-${size}`, `منتج مستورد ${p}`, 'men-clothing', '49.90', '', String((p % 7) + 1), 'المقاس', size, 'اللون', 'أسود']);
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
      [233, (r) => { r[3] = 'toys'; }],
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

    // رفع الملف نفسه مرة ثانية: الموجود يُحدَّث لا يتكرّر، والأخطاء نفسها تُبلَّغ
    const again = (await A.upload('/vendor/catalog/import', file)).json();
    expect(again).toMatchObject({ imported: 488, productsCreated: 0, variantsCreated: 0, variantsUpdated: 488, rejectedCount: 12 });
    expect(again.rejected.map((r: { line: number }) => r.line)).toEqual(rejectedLines);
    expect(await prisma.product.count({ where: { vendorId: vendors.a.vendorId, nameAr: { startsWith: 'منتج مستورد' } } })).toBe(250);
    await expectNoDrift(variants.map((v) => v.id));
  }, 120_000);

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

  dbIt('الترتيب: الأولى هي الرئيسية، والمجموعة كاملة أو 409، وتغيير الرئيسية وحده يعيد المنشور للمراجعة', async () => {
    const A = as('a');
    const service = app.get(ProductService);
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
    await service.approve(product.id, await revOf(product.id));
    const r0 = await revOf(product.id);

    // الترتيب نفسه، أو تبديل ما بعد الرئيسية: لا محتوى جديد ويبقى منشوراً
    expect((await A.put(`/vendor/products/${product.id}/images/order`, { imageIds: [i2, i3, i4] })).statusCode).toBe(200);
    const swapped = await A.put(`/vendor/products/${product.id}/images/order`, { imageIds: [i2, i4, i3] });
    expect(swapped.statusCode, swapped.body).toBe(200);
    expect(swapped.json().map((i: { id: string }) => i.id)).toEqual([i2, i4, i3]);
    expect(await status()).toBe('active');
    expect(await revOf(product.id)).toBe(r0);

    // الرئيسية تغيّرت: محتوى يراه المشتري — يعود للمراجعة بنسخة جديدة
    expect((await A.put(`/vendor/products/${product.id}/images/order`, { imageIds: [i4, i2, i3] })).statusCode).toBe(200);
    expect((await order()).map((i) => i.id)).toEqual([i4, i2, i3]);
    expect(await status()).toBe('pending_review');
    expect(await revOf(product.id)).toBe(r0 + 1);

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
describe('شجرة الفئات', () => {
  dbIt('متعددة المستويات، والسمات تُورث، ونقل الفرع يعيد كتابة مساراته', async () => {
    const categories = app.get(CategoryService);
    const slug = (name: string) => `${name}-${SUFFIX}`;

    const root = await categories.create({ slug: slug('root'), nameAr: 'جذر اختبار' });
    const child = await categories.create({ parentId: root.id, slug: slug('child'), nameAr: 'فرع' });
    const grand = await categories.create({ parentId: child.id, slug: slug('grand'), nameAr: 'فرع الفرع' });
    const other = await categories.create({ slug: slug('other'), nameAr: 'جذر آخر' });

    await categories.linkAttribute(root.id, attr('material').attributeId, { isRequired: true });
    const inherited = await categories.effectiveAttributes(grand.id);
    expect(inherited.find((a) => a.code === 'material')).toMatchObject({ isRequired: true, definedOn: root.id });

    await categories.move(child.id, other.id);
    const moved = await prisma.category.findUniqueOrThrow({ where: { id: grand.id } });
    expect(moved.path).toBe(`/${other.id}/${child.id}/${grand.id}/`);
    expect(moved.depth).toBe(2);
    expect((await categories.effectiveAttributes(grand.id)).some((a) => a.code === 'material')).toBe(false);

    await expect(categories.move(other.id, grand.id)).rejects.toBeInstanceOf(InvalidInputError);

    const tree = (await app.inject({ method: 'GET', url: '/api/v1/categories' })).json();
    const otherNode = tree.find((n: { id: string }) => n.id === other.id);
    expect(otherNode.children[0].children[0].id).toBe(grand.id);
    void randomUUID;
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
    await as('a').post(`/vendor/products/${id}/publish`);
    await app.get(ProductService).approve(id, await revOf(id));
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
