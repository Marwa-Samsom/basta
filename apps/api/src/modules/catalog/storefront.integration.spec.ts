/**
 * بوابة المرحلة 07 — البنود الثلاثة الأولى، على محرّك بحث حيّ.
 *
 * 1. كلمة عربية مكتوبة خطأ إملائياً تُرجع النتيجة الصحيحة.
 * 2. الهمزات والمدّات المختلفة (احمد / أحمد) تُرجع النتائج نفسها.
 * 3. زمن الاستجابة تحت 100 مللي ثانية.
 *
 * ويُثبت هنا أيضاً بند بوابة المرحلة 06 الثاني: **بائع معلَّق تختفي منتجاته
 * من المتجر فوراً** — بلا تعديل صفٍّ واحد من منتجاته.
 *
 * بلا محرّك شغّال تُتخطّى اختبارات البحث وحدها؛ اختبارات الرؤية تعمل على
 * القاعدة ولا تحتاجه.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { SearchService } from '../search/public';
import { StorefrontService } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let storefront: StorefrontService;
let search: SearchService;
let dbUp = false;
let meiliUp = false;

const SUFFIX = `sf${Date.now()}`;
let vendorId = '';
let secondVendorId = '';
const productIds: string[] = [];

const api = (url: string) => ({ url: `/api/v1${url}` });

/** منتج منشور جاهز للعرض — يُنشأ مباشرةً بالقاعدة كي يبقى الاختبار عن المتجر لا عن الإنشاء */
async function publishProduct(
  vendor: string,
  nameAr: string,
  priceMinor: bigint,
  stock: number,
): Promise<string> {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'men-clothing' } });
  const product = await prisma.product.create({
    data: {
      vendorId: vendor,
      categoryId: category.id,
      slug: `${nameAr.replace(/\s/g, '-')}-${SUFFIX}-${Math.random().toString(36).slice(2, 7)}`,
      nameAr,
      status: 'active',
      publishedAt: new Date(),
    },
  });

  // المتغيّر يُنشأ منفصلاً: بائعه مقيَّد بمفتاح مركّب مع المنتج فلا يُمرَّر في إنشاء متداخل
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      vendorId: vendor,
      sku: `SKU-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      priceMinorUnits: priceMinor,
      optionsKey: '',
      isActive: true,
    },
  });
  // المخزون يطابق مجموع حركاته — الحارس في المخطط يفحص ذلك (ADR-006)
  await prisma.inventory.create({
    data: { variantId: variant.id, onHand: stock, reserved: 0, lowStockThreshold: 2 },
  });
  if (stock > 0) {
    await prisma.inventoryMovement.create({
      data: { variantId: variant.id, delta: stock, reason: 'import', actorUserId: null },
    });
  }

  productIds.push(product.id);
  return product.id;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات المتجر الحيّة متخطّاة.\n');
    return;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  storefront = app.get(StorefrontService);
  search = app.get(SearchService);
  meiliUp = (await search.stats()).up;
  if (!meiliUp) console.warn('\n⚠ محرّك البحث غير شغّال — اختبارات البحث متخطّاة (npm run search:start).\n');

  for (const [tag, currency] of [
    ['main', 'JOD'],
    ['other', 'SAR'],
  ] as const) {
    const email = `${tag}.${SUFFIX}@basta.test`;
    const user = await prisma.user.create({
      data: {
        email,
        fullName: `بائع ${tag}`,
        passwordHash: await hashPassword('كلمة-مرور-اختبار-طويلة'),
        roles: { create: { role: 'vendor_owner' } },
      },
    });
    const vendor = await prisma.vendor.create({
      data: {
        ownerUserId: user.id,
        slug: `shop-${tag}-${SUFFIX}`,
        nameAr: `متجر ${tag}`,
        status: 'approved',
        approvedAt: new Date(),
        settlementCurrency: currency,
        country: 'JO',
      },
    });
    if (tag === 'main') vendorId = vendor.id;
    else secondVendorId = vendor.id;
  }

  await publishProduct(vendorId, 'قميص قطني أزرق', 19_900n, 5);
  await publishProduct(vendorId, 'سمّاعة لاسلكية', 45_000n, 3);
  await publishProduct(vendorId, 'عطر أحمد الملكي', 120_000n, 0);
  await publishProduct(secondVendorId, 'حذاء رياضي', 89_000n, 7);

  if (meiliUp) {
    await storefront.reindexAll();
    // الفهرسة غير متزامنة، والفهرس فيه منتجات القاعدة كلها لا منتجاتنا وحدها:
    // عدّ الوثائق يرضى بالعدد القديم قبل أن يجري المسح. ننتظر فراغ الطابور نفسه.
    expect(await search.idle(), 'طابور الفهرسة لم يفرغ خلال المهلة').toBe(true);
  }
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('بوابة 07 · البحث العربي', () => {
  it('البند 1: كلمة مكتوبة خطأ إملائياً تُرجع النتيجة الصحيحة', async () => {
    if (!dbUp || !meiliUp) return;
    const res = await app.inject({ method: 'GET', ...api('/storefront/products?q=قمييص') });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.engine).toBe('meili');
    expect(body.items.map((i: { nameAr: string }) => i.nameAr)).toContain('قميص قطني أزرق');
  });

  it('البند 2: «احمد» بلا همزة تُرجع ما تُرجعه «أحمد»', async () => {
    if (!dbUp || !meiliUp) return;
    const [without, with_] = await Promise.all([
      app.inject({ method: 'GET', ...api('/storefront/products?q=احمد') }),
      app.inject({ method: 'GET', ...api('/storefront/products?q=أحمد') }),
    ]);
    const ids = (r: typeof without): string[] =>
      r.json().items.map((i: { id: string }) => i.id);
    expect(ids(without)).toEqual(ids(with_));
    expect(ids(without).length).toBeGreaterThan(0);
  });

  it('الشدّة كذلك: «سماعة» تجد «سمّاعة»', async () => {
    if (!dbUp || !meiliUp) return;
    const res = await app.inject({ method: 'GET', ...api('/storefront/products?q=سماعة') });
    expect(res.json().items.map((i: { nameAr: string }) => i.nameAr)).toContain('سمّاعة لاسلكية');
  });

  it('المرادف العامّي: «بنطلون» تصل إلى «بنطال» — معرفة سوق لا لغة', async () => {
    if (!dbUp || !meiliUp) return;
    await publishProduct(vendorId, 'بنطال جينز', 35_000n, 4);
    await storefront.reindexAll();
    expect(await search.idle()).toBe(true);
    const res = await app.inject({ method: 'GET', ...api('/storefront/products?q=بنطلون') });
    expect(res.json().items.map((i: { nameAr: string }) => i.nameAr)).toContain('بنطال جينز');
  });

  it('البند 3: زمن الاستجابة تحت 100 مللي ثانية', async () => {
    if (!dbUp || !meiliUp) return;
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = Date.now();
      const res = await app.inject({ method: 'GET', ...api('/storefront/products?q=قميص') });
      times.push(Date.now() - started);
      expect(res.statusCode).toBe(200);
    }
    const median = times.sort((a, b) => a - b)[2]!;
    expect(median).toBeLessThan(100);
  });

  it('أوجه البحث تعدّ المطابقات لا المتجر كله', async () => {
    if (!dbUp || !meiliUp) return;
    const res = await app.inject({ method: 'GET', ...api('/storefront/products?q=قمييص') });
    const body = res.json() as { total: number; facets: { vendors: { count: number }[] } };
    const counted = body.facets.vendors.reduce((sum, v) => sum + v.count, 0);
    // كل منتج لبائع واحد: مجموع عدّاد البائعين هو عدد المطابقات بالضبط
    expect(counted).toBe(body.total);
  });

  it('الاقتراحات أثناء الكتابة تعيد أسماء لا منتجات كاملة', async () => {
    if (!dbUp || !meiliUp) return;
    const res = await app.inject({ method: 'GET', ...api('/storefront/suggest?q=قمي') });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().suggestions)).toBe(true);
  });
});

describe('قاعدة الرؤية — تُكتب مرة وتسري على كل مسار', () => {
  it('المنشور يظهر، ونافد المخزون يظهر معلَّماً لا مخفيّاً', async () => {
    if (!dbUp) return;
    const res = await app.inject({ method: 'GET', ...api('/storefront/products?pageSize=48') });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { nameAr: string; isSoldOut: boolean }[];
    const perfume = items.find((i) => i.nameAr === 'عطر أحمد الملكي');
    // ST-08: النافد يُعرض ويُقال إنه نفد — إخفاؤه يفقد صفحةً مفهرسة ورابطاً محفوظاً
    expect(perfume?.isSoldOut).toBe(true);
  });

  it('المسودّة لا تظهر أصلاً', async () => {
    if (!dbUp) return;
    const draft = await publishProduct(vendorId, 'منتج مسودّة', 10_000n, 1);
    await prisma.product.update({ where: { id: draft }, data: { status: 'draft' } });

    const res = await app.inject({ method: 'GET', ...api('/storefront/products?pageSize=48') });
    const ids = res.json().items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(draft);
  });

  it('صفحة المنتج تُقرأ بالرابط، والمخفيّ يردّ 404', async () => {
    if (!dbUp) return;
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productIds[0]! } });
    const ok = await app.inject({ method: 'GET', ...api(`/storefront/products/${product.slug}`) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().nameAr).toBe('قميص قطني أزرق');
    // العملة من بائعه لا من إعداد عام — ADR-013
    expect(ok.json().currency).toBe('JOD');

    const missing = await app.inject({ method: 'GET', ...api('/storefront/products/لا-يوجد') });
    expect(missing.statusCode).toBe(404);
  });

  it('بوابة 06 · البند 2: تعليق البائع يُخفي منتجاته فوراً بلا لمس صفوفها', async () => {
    if (!dbUp) return;
    const before = await app.inject({ method: 'GET', ...api('/storefront/products?pageSize=48') });
    const beforeIds: string[] = before.json().items.map((i: { id: string }) => i.id);
    expect(beforeIds).toContain(productIds[0]);

    await prisma.vendor.update({
      where: { id: vendorId },
      data: { status: 'suspended', suspendedAt: new Date() },
    });

    const after = await app.inject({ method: 'GET', ...api('/storefront/products?pageSize=48') });
    const afterIds: string[] = after.json().items.map((i: { id: string }) => i.id);

    const own = await prisma.product.findMany({ where: { vendorId }, select: { id: true } });
    const ownIds = new Set(own.map((p) => p.id));
    // منتجات المعلَّق كلها تختفي…
    for (const id of beforeIds.filter((p) => ownIds.has(p))) {
      expect(afterIds).not.toContain(id);
    }
    // …ومنتجات غيره تبقى: الإخفاء على البائع لا على المتجر كله
    for (const id of beforeIds.filter((p) => !ownIds.has(p))) {
      expect(afterIds).toContain(id);
    }

    // وحالة المنتج نفسها لم تتغيّر: الإخفاء من شرط البائع لا من نسخة محفوظة
    const row = await prisma.product.findUniqueOrThrow({ where: { id: productIds[0]! } });
    expect(row.status).toBe('active');

    // وصفحة متجره تُعرض بحالتها لا 404 — ST-12، فلا ينكسر رابط مفهرس
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } });
    const shop = await app.inject({ method: 'GET', ...api(`/storefront/shops/${vendor.slug}`) });
    expect(shop.statusCode).toBe(200);
    expect(shop.json().vendor.isSuspended).toBe(true);
    expect(shop.json().products).toHaveLength(0);

    await prisma.vendor.update({
      where: { id: vendorId },
      data: { status: 'approved', suspendedAt: null },
    });
  });

  it('صفحة البائع المعتمد تعرض منتجاته وحدها', async () => {
    if (!dbUp) return;
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: secondVendorId } });
    const res = await app.inject({ method: 'GET', ...api(`/storefront/shops/${vendor.slug}`) });
    expect(res.statusCode).toBe(200);
    const names = res.json().products.map((p: { nameAr: string }) => p.nameAr);
    expect(names).toContain('حذاء رياضي');
    expect(names).not.toContain('قميص قطني أزرق');
  });
});

describe('الأوجه والتصفية', () => {
  it('التصفية بالبائع تُضيّق النتائج والأوجه تعدّ ما سيُرى', async () => {
    if (!dbUp) return;
    const res = await app.inject({
      method: 'GET',
      ...api(`/storefront/products?vendorId=${secondVendorId}`),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((i: { vendor: { id: string } }) => i.vendor.id === secondVendorId)).toBe(true);
    expect(body.facets.vendors.length).toBeGreaterThan(0);
  });

  it('حدّ السعر يستبعد ما فوقه', async () => {
    if (!dbUp) return;
    const res = await app.inject({ method: 'GET', ...api('/storefront/products?maxPrice=20000') });
    const prices = res.json().items.map((i: { price: { minorUnits: string } }) => Number(i.price.minorUnits));
    expect(prices.every((p: number) => p <= 20_000)).toBe(true);
  });

  it('الفهرس يسقط إلى قاعدة البيانات لا إلى صفحة خطأ', async () => {
    if (!dbUp) return;
    // بحث بكلمة لا يعرفها المحرّك ولا القاعدة: النتيجة فارغة لا خطأ
    const res = await app.inject({ method: 'GET', ...api('/storefront/products?q=زقزقةغيرموجودة') });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);
    expect(['meili', 'db']).toContain(res.json().engine);
  });
});
