/**
 * ربط صورة المنتج بخيار — صورة الأحمر تظهر لمن يختار الأحمر بأي مقاس، وفي سلّته وطلبه.
 *
 * الصور تُكتب صفوفاً مباشرة: ما يُختبر الربط وأثره، لا معالجة الملفات (catalog.integration).
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `vi${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
let token = '';
let otherToken = '';
const vendorIds: string[] = [];
let productId = '';
let otherProductId = '';
const variant: Record<'redS' | 'redM' | 'blueS', string> = { redS: '', redM: '', blueS: '' };
const value: Record<'red' | 'blue' | 'green', string> = { red: '', blue: '', green: '' };
const image: Record<'main' | 'red' | 'blue', string> = { main: '', red: '', blue: '' };
/** مفتاح ملف كل صورة — بصيغة التخزين الحقيقية (products/<منتج>/<صورة>) */
const keyOf: Record<'main' | 'red' | 'blue', string> = { main: '', red: '', blue: '' };

async function call(method: 'GET' | 'POST' | 'PUT', url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { payload: opts.body as Record<string, unknown> } : {}),
  });
}

const link = (imageId: string, body: object, as = token, product = productId) =>
  call('PUT', `/vendor/products/${product}/images/${imageId}/link`, { token: as, body });

async function vendor(tag: string): Promise<{ vendorId: string; token: string }> {
  const email = `${tag}.${SUFFIX}@basta.test`;
  const user = await prisma.user.create({
    data: { email, fullName: `بائع ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
  });
  const v = await prisma.vendor.create({
    data: {
      ownerUserId: user.id,
      slug: `v-${tag}-${SUFFIX}`,
      nameAr: `متجر ${tag}`,
      status: 'approved',
      approvedAt: new Date(),
      settlementCurrency: 'SAR',
      country: 'SA',
    },
  });
  vendorIds.push(v.id);
  const login = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  return { vendorId: v.id, token: login.json().tokens.accessToken as string };
}

/** سطر السلة لمتغيّر واحد — الصورة التي يراها المشتري في سلّته وتُثبَّت في طلبه */
async function cartImage(variantId: string): Promise<string | null> {
  const cart = (await call('POST', '/cart', { body: { currency: 'SAR' } })).json().token as string;
  expect((await call('POST', '/cart/items', { body: { variantId, qty: 1 }, headers: { 'x-cart-token': cart } })).statusCode).toBe(201);
  const view = (await call('GET', '/cart', { headers: { 'x-cart-token': cart } })).json();
  return view.groups[0].lines[0].imageKey as string | null;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات ربط الصور متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const a = await vendor('a');
  token = a.token;
  otherToken = (await vendor('b')).token;

  const color = await prisma.attribute.findUniqueOrThrow({ where: { code: 'color' }, include: { values: true } });
  const size = await prisma.attribute.findUniqueOrThrow({ where: { code: 'size' }, include: { values: true } });
  const valueOf = (attr: typeof color, en: string) => attr.values.find((v) => v.valueEn === en)!.id;
  value.red = valueOf(color, 'Red');
  value.blue = valueOf(color, 'Blue');
  value.green = valueOf(color, 'Green');

  const product = await prisma.product.create({
    data: {
      vendorId: a.vendorId,
      slug: `p-${SUFFIX}`,
      nameAr: `قميص ${SUFFIX}`,
      status: 'active',
      publishedAt: new Date(),
      hasVariants: true,
    },
  });
  productId = product.id;
  for (const [key, colorValue, sizeValue] of [
    ['redS', value.red, valueOf(size, 'S')],
    ['redM', value.red, valueOf(size, 'M')],
    ['blueS', value.blue, valueOf(size, 'S')],
  ] as const) {
    const v = await prisma.productVariant.create({
      data: {
        productId,
        vendorId: a.vendorId,
        sku: `VI-${key}-${SUFFIX}`.toUpperCase(),
        priceMinorUnits: 9_900n,
        optionsKey: `${colorValue}|${sizeValue}`,
        isActive: true,
        optionValues: {
          create: [
            { attributeId: color.id, attributeValueId: colorValue },
            { attributeId: size.id, attributeValueId: sizeValue },
          ],
        },
      },
    });
    await prisma.inventory.create({ data: { variantId: v.id, onHand: 5, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: v.id, delta: 5, reason: 'import' } });
    variant[key] = v.id;
  }
  for (const [sort, key] of (['main', 'red', 'blue'] as const).entries()) {
    const id = randomUUID();
    keyOf[key] = `products/${productId}/${id}`;
    const img = await prisma.productImage.create({ data: { id, productId, fileKey: keyOf[key], sort } });
    image[key] = img.id;
  }
  const other = await prisma.product.create({
    data: { vendorId: vendorIds[1]!, slug: `p-other-${SUFFIX}`, nameAr: 'منتج آخر', status: 'draft' },
  });
  otherProductId = other.id;
}, 60_000);

afterAll(async () => {
  if (dbUp) {
    // المنتجات لا تُحذف (أرشفة) — تُخفى من متجر التطوير كما يفعل catalog.integration
    const now = new Date();
    await prisma.productVariant.updateMany({ where: { vendorId: { in: vendorIds }, archivedAt: null }, data: { archivedAt: now, isActive: false } });
    await prisma.product.updateMany({ where: { vendorId: { in: vendorIds }, deletedAt: null }, data: { deletedAt: now, status: 'archived' } });
    await app?.close();
  }
  await prisma.$disconnect();
});

describe('ربط صورة المنتج بخيار', () => {
  it('صورة لقيمة: تظهر مع كل متغيّر يحملها — والمنشور يبقى منشوراً', async () => {
    if (!dbUp) return;
    const red = await link(image.red, { optionValueId: value.red });
    expect(red.statusCode, red.body).toBe(200);
    expect(red.json()).toMatchObject({ id: image.red, optionValueId: value.red, variantId: null });
    expect((await link(image.blue, { optionValueId: value.blue })).statusCode).toBe(200);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(after.status).toBe('active');

    // المحرّر يقرأ الربط
    const detail = (await call('GET', `/vendor/products/${productId}`, { token })).json();
    expect(detail.images.find((i: { id: string }) => i.id === image.red).optionValueId).toBe(value.red);

    // المتجر يعرضه لتقفز الصفحة إلى صورة اللون المختار
    const page = (await call('GET', `/storefront/products/${encodeURIComponent(`p-${SUFFIX}`)}`)).json();
    expect(page.images.map((i: { optionValueId: string | null }) => i.optionValueId)).toEqual([null, value.red, value.blue]);
  });

  it('السلة والطلب يعرضان صورة ما اختاره: الأحمر بأي مقاس أحمر، والمتغيّر بعينه يسبق القيمة', async () => {
    if (!dbUp) return;
    expect(await cartImage(variant.redS)).toBe(keyOf.red);
    expect(await cartImage(variant.redM)).toBe(keyOf.red);
    expect(await cartImage(variant.blueS)).toBe(keyOf.blue);

    // صورة لمتغيّر واحد بعينه تسبق صورة قيمته
    expect((await link(image.main, { variantId: variant.redM })).statusCode).toBe(200);
    expect(await cartImage(variant.redM)).toBe(keyOf.main);
    expect(await cartImage(variant.redS)).toBe(keyOf.red);

    // فكّ الربط: الصورة للجميع، والسطر بلا صورة خاصة يأخذ الرئيسية
    expect((await link(image.main, { variantId: null })).json()).toMatchObject({ variantId: null, optionValueId: null });
    expect((await link(image.blue, { optionValueId: null })).statusCode).toBe(200);
    expect(await cartImage(variant.blueS)).toBe(keyOf.main);
  });

  it('يُرفض: قيمة ليست بين خيارات المنتج، وقيمة ومتغيّر معاً، وصورة منتج غيره', async () => {
    if (!dbUp) return;
    const green = await link(image.red, { optionValueId: value.green });
    expect(green.statusCode).toBe(400);
    expect(green.json().message).toMatch(/ليست بين خيارات المنتج/);

    const both = await link(image.red, { optionValueId: value.red, variantId: variant.redS });
    expect(both.statusCode).toBe(400);

    // بائع آخر لا يمسّ صور هذا المنتج، ولا تُنقل صورة إلى منتج غير منتجها
    expect((await link(image.red, { optionValueId: value.red }, otherToken)).statusCode).toBe(404);
    expect((await link(image.red, { optionValueId: value.red }, token, otherProductId)).statusCode).toBe(404);

    // والقاعدة نفسها ترفض الربطين معاً — لا يمرّ من طريق غير الخدمة
    await expect(
      prisma.productImage.update({ where: { id: image.red }, data: { variantId: variant.redS, optionValueId: value.red } }),
    ).rejects.toThrow();
  });
});
