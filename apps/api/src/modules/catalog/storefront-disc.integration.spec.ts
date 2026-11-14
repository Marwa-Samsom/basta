/**
 * حالات «التصفّح والبحث» (DISC) — دليل كل حالة باسمها، على محرّك بحث حيّ وقاعدة التطوير.
 *
 * كل حالة ببياناتها: متاجر ومنتجات تُنشأ هنا، والبحث مقصور عليها بمعرّف المتجر أو بكلمة
 * عشوائية في الاسم — قاعدة التطوير فيها آلاف المنتجات من تشغيلات سابقة. في النهاية تُعلَّق
 * المتاجر وتُحذف وثائقها من الفهرس، فلا يبقى منها شيء في متجر صاحبة المشروع.
 *
 * بلا محرّك شغّال تُتخطّى اختبارات البحث بكلمة وحدها؛ ما يمرّ بالقاعدة يعمل بلاه.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { InventoryService } from '../inventory/public';
import { SearchService } from '../search/public';
import { StorefrontService } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let storefront: StorefrontService;
let search: SearchService;
let dbUp = false;
let meiliUp = false;

const SUFFIX = `disc${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const DAY = 86_400_000;
const vendorIds: string[] = [];

/** كلمة لاتينية عشوائية بلا أرقام — لا تقترب بخطأين من كلمة تشغيل سابق كما يقترب طابع الوقت */
const token = (): string => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
const get = (url: string, token?: string): Promise<Res> =>
  app.inject({ method: 'GET', url: `/api/v1${url}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
const messages = (res: Res): string[] => [res.json().message].flat() as string[];

interface Card {
  id: string;
  nameAr: string;
  vendor: { id: string };
  price: { minorUnits: string; currency: string };
  isSoldOut: boolean;
}
interface Facets {
  vendors: { id: string; label: string; count: number }[];
  attributes: { attributeId: string; nameAr: string; values: { id: string; label: string; count: number }[] }[];
}
interface ListBody {
  items: Card[];
  total: number;
  engine: 'meili' | 'db';
  facets: Facets;
}

async function list(query: string): Promise<ListBody> {
  const res = await get(`/storefront/products?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ListBody;
}
const names = (b: ListBody): string[] => b.items.map((i) => i.nameAr);
const q = (term: string): string => `q=${encodeURIComponent(term)}`;

async function makeVendor(
  tag: string,
  opts: { currency?: string; status?: 'approved' | 'in_review' | 'suspended' | 'banned'; data?: Record<string, unknown> } = {},
): Promise<{ id: string; slug: string; nameAr: string; email: string }> {
  const email = `${tag}.${SUFFIX}@basta.test`;
  const user = await prisma.user.create({
    data: { email, fullName: `بائع ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
  });
  const status = opts.status ?? 'approved';
  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: user.id,
      slug: `disc-${tag}-${SUFFIX}`,
      nameAr: `متجر ${tag} ${SUFFIX}`,
      status,
      settlementCurrency: opts.currency ?? 'JOD',
      country: 'JO',
      ...(status === 'approved' ? { approvedAt: new Date() } : {}),
      ...(status === 'in_review' ? { submittedAt: new Date() } : {}),
      ...(status === 'suspended' ? { suspendedAt: new Date() } : {}),
      ...opts.data,
    },
  });
  vendorIds.push(vendor.id);
  return { id: vendor.id, slug: vendor.slug, nameAr: vendor.nameAr, email };
}

interface ProductSpec {
  nameAr: string;
  nameEn?: string;
  descriptionAr?: string;
  price?: bigint;
  stock?: number;
  status?: 'active' | 'draft' | 'rejected';
  publishedAt?: Date | null;
  createdAt?: Date;
  categoryId?: string;
  /** محاور المتغيّر الوحيد: [معرّف السمة، معرّف القيمة] */
  options?: [string, string][];
  slug?: string;
}

/** منتج بمتغيّر واحد ومخزون يطابق حركته — مباشرةً بالقاعدة، فالاختبار عن المتجر لا عن الإنشاء */
async function makeProduct(vendorId: string, spec: ProductSpec): Promise<{ id: string; slug: string; variantId: string }> {
  const status = spec.status ?? 'active';
  const product = await prisma.product.create({
    data: {
      vendorId,
      slug: spec.slug ?? `disc-${SUFFIX}-${Math.random().toString(36).slice(2, 10)}`,
      nameAr: spec.nameAr,
      nameEn: spec.nameEn ?? null,
      descriptionAr: spec.descriptionAr ?? null,
      vendorCategoryId: spec.categoryId ?? null,
      status,
      publishedAt: spec.publishedAt === undefined ? (status === 'draft' ? null : new Date()) : spec.publishedAt,
      hasVariants: (spec.options?.length ?? 0) > 0,
      ...(spec.createdAt ? { createdAt: spec.createdAt } : {}),
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      vendorId,
      sku: `DISC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      priceMinorUnits: spec.price ?? 10_000n,
      optionsKey: (spec.options ?? []).map(([a, v]) => `${a}:${v}`).join('|'),
      isActive: true,
      ...(spec.options?.length ? { optionValues: { create: spec.options.map(([attributeId, attributeValueId]) => ({ attributeId, attributeValueId })) } } : {}),
    },
  });
  const stock = spec.stock ?? 5;
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: stock, reserved: 0, lowStockThreshold: 2 } });
  if (stock > 0) await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: stock, reason: 'import', actorUserId: null } });
  return { id: product.id, slug: product.slug, variantId: variant.id };
}

/** يكتب وثائق المنتجات في الفهرس وينتظر فراغ طابوره — كما يفعل النشر */
async function indexed(ids: readonly string[]): Promise<void> {
  if (!meiliUp) return;
  await storefront.syncIndex(ids);
  expect(await search.idle(), 'طابور الفهرسة لم يفرغ خلال المهلة').toBe(true);
}

async function login(email: string, totpSecret?: string): Promise<string> {
  const totp = totpSecret
    ? generateSync({ strategy: 'totp', secret: totpSecret, crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() })
    : undefined;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD, ...(totp ? { totp } : {}) } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tokens.accessToken as string;
}

/** المحرّك نائم: كل طلب إليه يرمي — كما يرمي حين يتوقّف أو لا يُبلغ عنوانه */
function engineDown() {
  const meili = (search as unknown as { meili: { request: (...args: unknown[]) => Promise<unknown> } }).meili;
  return vi.spyOn(meili, 'request').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:7701'));
}

let color = { id: '', red: '', blue: '', green: '' };
let size = { id: '', S: '', M: '', L: '' };

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات DISC متخطّاة.\n');
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
  if (meiliUp) await search.ensureIndex();
  else console.warn('\n⚠ محرّك البحث غير شغّال — اختبارات البحث بكلمة متخطّاة.\n');

  const value = async (code: string, valueAr: string) =>
    (await prisma.attributeValue.findFirstOrThrow({ where: { attribute: { code }, valueAr }, select: { id: true, attributeId: true } }));
  const [red, blue, green, s, m, l] = await Promise.all([
    value('color', 'أحمر'), value('color', 'أزرق'), value('color', 'أخضر'),
    value('size', 'S'), value('size', 'M'), value('size', 'L'),
  ]);
  color = { id: red.attributeId, red: red.id, blue: blue.id, green: green.id };
  size = { id: s.attributeId, S: s.id, M: m.id, L: l.id };
}, 120_000);

afterAll(async () => {
  if (dbUp && vendorIds.length) {
    // قاعدة التطوير نفسها: متاجر الاختبار تُعلَّق ووثائقها تخرج من الفهرس — لا تظهر في بحث صاحبة المشروع
    await prisma.vendor.updateMany({ where: { id: { in: vendorIds }, status: { not: 'banned' } }, data: { status: 'suspended', suspendedAt: new Date() } });
    if (meiliUp) for (const id of vendorIds) await storefront.syncVendor(id).catch(() => undefined);
  }
  await app?.close();
  await prisma.$disconnect();
});

// ================================================================= البحث العربي

describe('البحث العربي — التطبيع والأخطاء والمرادفات (DISC-018 · 019 · 020)', () => {
  let vendorId = '';

  beforeAll(async () => {
    if (!dbUp) return;
    vendorId = (await makeVendor('arabic')).id;
    const ids: string[] = [];
    for (const nameAr of [
      'قميص قطني أزرق',
      'عطر أحمد الملكي',
      'سمّاعة لاسلكية',
      'بنطلونات رجالية',
      'بنطال جينز',
      'هاتف ذكي',
      'حقيبة جلد',
      'حاسوب محمول',
    ]) {
      ids.push((await makeProduct(vendorId, { nameAr })).id);
    }
    await indexed(ids);
  }, 60_000);

  const found = (term: string) => list(`vendorId=${vendorId}&${q(term)}`);

  it('DISC-018: «احمد» = «أحمد» بالمنتجات والعدد، و«سماعة» و«سَمّاعَة» تجدان «سمّاعة لاسلكية» — من المحرّك', async () => {
    if (!dbUp || !meiliUp) return;
    const [without, withHamza] = await Promise.all([found('احمد'), found('أحمد')]);
    expect(without.engine).toBe('meili');
    expect(withHamza.engine).toBe('meili');
    expect(names(without)).toContain('عطر أحمد الملكي');
    expect(without.items.map((i) => i.id)).toEqual(withHamza.items.map((i) => i.id));
    expect(without.total).toBe(withHamza.total);

    for (const term of ['سماعة', 'سَمّاعَة']) {
      const res = await found(term);
      expect(res.engine, term).toBe('meili');
      expect(names(res), term).toContain('سمّاعة لاسلكية');
    }
  });

  it('DISC-019: خطأ واحد من أربعة أحرف يُصحَّح، وكلمة من ثلاثة لا تُصحَّح، وخطآن من ثمانية فأكثر', async () => {
    if (!dbUp || !meiliUp) return;
    // «قمييص»: حرف زائد في كلمة من أربعة
    expect(names(await found('قمييص'))).toContain('قميص قطني أزرق');
    // «عطط»: ثلاثة أحرف بخطأ واحد — دون عتبة التسامح فلا تجد «عطر»
    const short = await found('عطط');
    expect(short.engine).toBe('meili');
    expect(names(short)).not.toContain('عطر أحمد الملكي');
    expect(short.total).toBe(0);
    // «بمطلوناط»: ثمانية أحرف بحرفين مبدلين من «بنطلونات»
    expect(names(await found('بمطلوناط'))).toContain('بنطلونات رجالية');
  });

  it('DISC-020: «بنطلون» و«جوال» و«موبايل» و«لابتوب» تجد أسماءها الفصيحة', async () => {
    if (!dbUp || !meiliUp) return;
    for (const [term, name] of [
      ['بنطلون', 'بنطال جينز'],
      ['جوال', 'هاتف ذكي'],
      ['موبايل', 'هاتف ذكي'],
      ['لابتوب', 'حاسوب محمول'],
    ] as const) {
      const res = await found(term);
      expect(res.engine, term).toBe('meili');
      expect(names(res), term).toContain(name);
    }
  });

  /**
   * كان 0 نتيجة: المحرّك يخمّن لسان المرادف «حقيبة» فارسياً فيطبّعه بغير تطبيع الوثيقة. صار كل مرادف
   * يُرسَل ومعه نسخة مشكولة تُقرأ عربيةً (engineSynonyms) — قرار صاحبة المشروع 14 نوفمبر 2026.
   */
  it('DISC-020: «شنطة» و«شنطه» تجدان «حقيبة جلد»', async () => {
    if (!dbUp || !meiliUp) return;
    for (const term of ['شنطة', 'شنطه']) {
      const res = await found(term);
      expect(res.engine, term).toBe('meili');
      expect(names(res), term).toContain('حقيبة جلد');
    }
  });
});

// ================================================================= الاقتراحات

describe('الاقتراحات أثناء الكتابة (DISC-011 · 015)', () => {
  it('DISC-011: أسماء نصّية لا بطاقات، ستة حدّاً أعلى، والاسم المكرّر بين متجرين مرة واحدة', async () => {
    if (!dbUp || !meiliUp) return;
    const word = token();
    const a = await makeVendor('suggest-a');
    const b = await makeVendor('suggest-b');
    const ids = [
      (await makeProduct(a.id, { nameAr: `${word} قميص قطني أزرق` })).id,
      (await makeProduct(a.id, { nameAr: `${word} قميص كتان` })).id,
      (await makeProduct(b.id, { nameAr: `${word} قميص كتان` })).id,
    ];
    await indexed(ids);

    const res = await get(`/storefront/suggest?q=${word}`);
    expect(res.statusCode).toBe(200);
    const suggestions = res.json().suggestions as unknown[];
    expect(suggestions.every((s) => typeof s === 'string')).toBe(true);
    expect([...suggestions].sort()).toEqual([`${word} قميص قطني أزرق`, `${word} قميص كتان`].sort());

    // ثمانية أسماء مختلفة: ستة على الأكثر
    const more: string[] = [];
    for (let i = 1; i <= 8; i++) more.push((await makeProduct(a.id, { nameAr: `${word} قميص صيفي ${i}` })).id);
    await indexed(more);
    // تحت حِمل ملفات تعمل بالتوازي قد تتجاوز الاقتراحات مهلتها فتعود فارغة (DISC-015) — نعيد السؤال
    let capped: string[] = [];
    for (let attempt = 0; attempt < 10 && capped.length === 0; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 500));
      capped = (await get(`/storefront/suggest?q=${word}`)).json().suggestions as string[];
    }
    expect(capped).toHaveLength(6);
    expect(new Set(capped).size).toBe(6);
  });

  it('DISC-015: المحرّك النائم — الاقتراحات 200 بقائمة فارغة، والبحث نفسه يعمل من القاعدة', async () => {
    if (!dbUp) return;
    const v = await makeVendor('sleep-suggest');
    await makeProduct(v.id, { nameAr: 'قميص للمحرّك النائم' });
    const spy = engineDown();
    try {
      const res = await get(`/storefront/suggest?q=${encodeURIComponent('قميص')}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ suggestions: [] });
      const results = await list(`vendorId=${v.id}&${q('قميص')}`);
      expect(results.engine).toBe('db');
      expect(names(results)).toContain('قميص للمحرّك النائم');
    } finally {
      spy.mockRestore();
    }
  });
});

// ================================================================= الأوجه والتصفية

describe('أوجه السمات تعدّ مطابقات الكلمة كلها (DISC-023)', () => {
  let vendorId = '';

  beforeAll(async () => {
    if (!dbUp) return;
    vendorId = (await makeVendor('facets')).id;
    const ids: string[] = [];
    // 30 قميصاً: 20 أحمر و10 أزرق؛ و5 كنزات حمراء لا تطابق الكلمة
    for (let i = 0; i < 20; i++) ids.push((await makeProduct(vendorId, { nameAr: `قميص صوف ${i}`, options: [[color.id, color.red]] })).id);
    for (let i = 0; i < 10; i++) ids.push((await makeProduct(vendorId, { nameAr: `قميص كتان ${i}`, options: [[color.id, color.blue]] })).id);
    for (let i = 0; i < 5; i++) ids.push((await makeProduct(vendorId, { nameAr: `كنزة ${i}`, options: [[color.id, color.red]] })).id);
    await indexed(ids);
  }, 120_000);

  it('«أحمر 20» ثم «أزرق 10» بالعدد تنازلياً على المطابقات كلها لا الصفحة (24)، بأسماء القاعدة، و«قمييص» بالأعداد نفسها، و«أحمر» يضيّق إلى 20', async () => {
    if (!dbUp || !meiliUp) return;
    const colorFacet = (b: ListBody) => b.facets.attributes.find((a) => a.attributeId === color.id);

    const exact = await list(`vendorId=${vendorId}&${q('قميص')}`);
    expect(exact.engine).toBe('meili');
    expect(exact.total).toBe(30);
    expect(exact.items).toHaveLength(24);
    const facet = colorFacet(exact)!;
    expect(facet.nameAr).toBe('اللون');
    expect(facet.values.map((v) => [v.id, v.label, v.count])).toEqual([
      [color.red, 'أحمر', 20],
      [color.blue, 'أزرق', 10],
    ]);

    const typo = await list(`vendorId=${vendorId}&${q('قمييص')}`);
    expect(typo.total).toBe(30);
    expect(colorFacet(typo)!.values.map((v) => [v.id, v.count])).toEqual([
      [color.red, 20],
      [color.blue, 10],
    ]);

    const red = await list(`vendorId=${vendorId}&${q('قميص')}&attrs=${color.red}`);
    expect(red.total).toBe(20);
  });
});

describe('قيمتان من سمتين = الشرطان معاً (DISC-024)', () => {
  it('أحمر و M: القميص الأحمر بمقاس M وحده، وبلا M يعود الأحمر كله', async () => {
    if (!dbUp || !meiliUp) return;
    const v = await makeVendor('and');
    const redM = await makeProduct(v.id, { nameAr: 'قميص أحمر M', options: [[color.id, color.red], [size.id, size.M]] });
    const redL = await makeProduct(v.id, { nameAr: 'قميص أحمر L', options: [[color.id, color.red], [size.id, size.L]] });
    const blueM = await makeProduct(v.id, { nameAr: 'قميص أزرق M', options: [[color.id, color.blue], [size.id, size.M]] });
    await indexed([redM.id, redL.id, blueM.id]);

    const both = await list(`vendorId=${v.id}&${q('قميص')}&attrs=${color.red},${size.M}`);
    expect(both.engine).toBe('meili');
    expect(both.items.map((i) => i.id)).toEqual([redM.id]);

    const redOnly = await list(`vendorId=${v.id}&${q('قميص')}&attrs=${color.red}`);
    expect(redOnly.items.map((i) => i.id).sort()).toEqual([redM.id, redL.id].sort());
  });
});

describe('«المتوفّر فقط» (DISC-026)', () => {
  let v = { id: '', email: '' };
  let a = { id: '', variantId: '' };
  let b = { id: '', variantId: '' };

  beforeAll(async () => {
    if (!dbUp) return;
    v = await makeVendor('stock');
    a = await makeProduct(v.id, { nameAr: 'قميص أ', stock: 1 });
    b = await makeProduct(v.id, { nameAr: 'قميص ب', stock: 0 });
    await indexed([a.id, b.id]);
  }, 60_000);

  it('يُظهر قميص أ (متاحه 1) وحده ويُخفي قميص ب النافد', async () => {
    if (!dbUp || !meiliUp) return;
    const res = await list(`vendorId=${v.id}&${q('قميص')}&inStock=true`);
    expect(res.engine).toBe('meili');
    expect(res.items.map((i) => i.id)).toEqual([a.id]);
  });

  /**
   * كان الفهرس يبقى على المخزون القديم: تعديل VD-11 لا يحدّثه. صار المخزون يعلن تغيّر المتاح بعد تثبيت
   * معاملته (تعديل، حجز، تحرير) والكتالوج يعيد كتابة الوثيقة — قرار صاحبة المشروع 14 نوفمبر 2026.
   */
  it('DISC-026: بعد تصفير أ وتزويد ب بخمس من VD-11 يتبع الوجه المخزون: أ يسقط وب يظهر', async () => {
    if (!dbUp || !meiliUp) return;
    const vendorToken = await login(v.email);
    const adjust = (productId: string, variantId: string, setTo: number) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/vendor/products/${productId}/variants/${variantId}/stock`,
        headers: { authorization: `Bearer ${vendorToken}` },
        payload: { setTo, reason: 'manual_adjust' },
      });
    expect((await adjust(a.id, a.variantId, 0)).statusCode).toBe(200);
    expect((await adjust(b.id, b.variantId, 5)).statusCode).toBe(200);
    // المزامنة بعد تثبيت التعديل ولا تؤخّر ردّ البائع — ننتظر وصولها إلى الفهرس
    await expect
      .poll(async () => (await list(`vendorId=${v.id}&${q('قميص')}&inStock=true`)).items.map((i) => i.id), { timeout: 15_000 })
      .toEqual([b.id]);
    // وبلا التصفية القميصان معاً: النافد بقي في الفهرس ولم يُحذف
    expect((await list(`vendorId=${v.id}&${q('قميص')}`)).items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('DISC-026: حجز القطع الخمس في صفحة الدفع يُسقط ب من «المتوفّر فقط»، وتحريره يعيده', async () => {
    if (!dbUp || !meiliUp) return;
    const inventory = app.get(InventoryService);
    const inStock = async () => (await list(`vendorId=${v.id}&${q('قميص')}&inStock=true`)).items.map((i) => i.id);
    await expect.poll(inStock, { timeout: 15_000 }).toEqual([b.id]);
    const { reservations } = await inventory.reserve({ lines: [{ variantId: b.variantId, qty: 5, label: 'قميص ب' }] });
    await expect.poll(inStock, { timeout: 15_000 }).toEqual([]);
    await inventory.release(reservations.map((r) => r.id));
    await expect.poll(inStock, { timeout: 15_000 }).toEqual([b.id]);
  });
});

describe('وجه «المتجر» (DISC-027)', () => {
  it('«حذاء»: المتجران المعتمدان بعدّهما تنازلياً والمعلَّق غائب رغم وثائقه؛ «عطر» بمتجر واحد؛ والاختيار يضيّق', async () => {
    if (!dbUp || !meiliUp) return;
    const shoe = token();
    const perfume = token();
    const big = await makeVendor('shoes-a');
    const small = await makeVendor('shoes-b');
    const gone = await makeVendor('shoes-c');
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) ids.push((await makeProduct(big.id, { nameAr: `حذاء ${shoe} ${i}` })).id);
    ids.push((await makeProduct(small.id, { nameAr: `حذاء ${shoe} خفيف` })).id);
    for (let i = 0; i < 3; i++) ids.push((await makeProduct(gone.id, { nameAr: `حذاء ${shoe} قديم ${i}` })).id);
    ids.push((await makeProduct(small.id, { nameAr: `عطر ${perfume}` })).id);
    await indexed(ids);
    // يُعلَّق بالقاعدة مباشرةً: وثائقه تبقى في الفهرس
    await prisma.vendor.update({ where: { id: gone.id }, data: { status: 'suspended', suspendedAt: new Date() } });

    const shoes = await list(q(shoe));
    expect(shoes.engine).toBe('meili');
    expect(shoes.facets.vendors.map((x) => [x.id, x.label, x.count])).toEqual([
      [big.id, big.nameAr, 2],
      [small.id, small.nameAr, 1],
    ]);
    expect(shoes.items.some((i) => i.vendor.id === gone.id)).toBe(false);

    // «عطر» من متجر واحد: الوجه بقيمة واحدة — والواجهة لا تعرض قسماً بأقل من متجرين
    expect((await list(q(perfume))).facets.vendors.map((x) => x.id)).toEqual([small.id]);

    const narrowed = await list(`${q(shoe)}&vendorId=${big.id}`);
    expect(narrowed.total).toBe(2);
    expect(narrowed.items.every((i) => i.vendor.id === big.id)).toBe(true);
  });
});

// ================================================================= الترتيب

describe('الترتيب (DISC-029)', () => {
  it('السعر بالدولار بين العملات (9.00 USD قبل 10.000 JOD) تصاعدياً وتنازلياً، و«الأحدث» بتاريخ النشر لا الإنشاء — في المحرّك والقاعدة', async () => {
    if (!dbUp) return;
    const word = token();
    const jod = await makeVendor('sort-jod', { currency: 'JOD' });
    const usd = await makeVendor('sort-usd', { currency: 'USD' });
    const now = Date.now();
    // أُنشئ قبل عشرة أيام مسودّةً ونُشر أمس — أحدث نشراً من X الذي أُنشئ بعده ونُشر قبله
    const y = await makeProduct(jod.id, { nameAr: `${word} قميص`, price: 12_000n, createdAt: new Date(now - 10 * DAY), publishedAt: new Date(now - DAY) });
    const x = await makeProduct(jod.id, { nameAr: `${word} قميص`, price: 10_000n, createdAt: new Date(now - 5 * DAY), publishedAt: new Date(now - 3 * DAY) });
    const z = await makeProduct(jod.id, { nameAr: `${word} قميص`, price: 15_000n, createdAt: new Date(now - 2 * DAY), publishedAt: new Date(now - 2 * DAY) });
    const w = await makeProduct(usd.id, { nameAr: `${word} قميص`, price: 900n, createdAt: new Date(now - 20 * DAY), publishedAt: new Date(now - 20 * DAY) });

    // القاعدة (تصفّح متجر بلا كلمة): «الأحدث» بتاريخ النشر
    const dbNewest = await list(`vendorId=${jod.id}&sort=newest`);
    expect(dbNewest.engine).toBe('db');
    expect(dbNewest.items.map((i) => i.id)).toEqual([y.id, z.id, x.id]);

    if (!meiliUp) return;
    await indexed([x.id, y.id, z.id, w.id]);
    const ids = async (sort: string) => {
      const res = await list(`${q(word)}&sort=${sort}`);
      expect(res.engine).toBe('meili');
      return res.items.map((i) => i.id);
    };
    expect(await ids('price_asc')).toEqual([w.id, x.id, y.id, z.id]);
    expect(await ids('price_desc')).toEqual([z.id, y.id, x.id, w.id]);
    expect(await ids('newest')).toEqual([y.id, z.id, x.id, w.id]);
  });
});

// ================================================================= حدود السعر والتحقق

describe('مدى السعر (DISC-030)', () => {
  it('الحدّان شاملان، وما دون الأدنى أو فوق الأعلى خارج، والسالب والكسري 400 برسالتيهما', async () => {
    if (!dbUp) return;
    const v = await makeVendor('range', { currency: 'JOD' });
    const p199 = await makeProduct(v.id, { nameAr: 'رخيص', price: 19_900n });
    const p450 = await makeProduct(v.id, { nameAr: 'وسط', price: 45_000n });
    await makeProduct(v.id, { nameAr: 'غالٍ', price: 120_000n });
    const ids = async (query: string) => (await list(`vendorId=${v.id}&currency=JOD&${query}`)).items.map((i) => i.id);

    expect(await ids('minPrice=20000&maxPrice=50000')).toEqual([p450.id]);
    expect(await ids('minPrice=45000&maxPrice=45000')).toEqual([p450.id]);
    expect(await ids('maxPrice=19899')).toEqual([]);
    expect(await ids('maxPrice=19900')).toEqual([p199.id]);

    const negative = await get(`/storefront/products?vendorId=${v.id}&minPrice=-1`);
    expect(negative.statusCode).toBe(400);
    expect(messages(negative)).toContain('أحد الحقول: لا يقلّ عن 0.');
    const fraction = await get(`/storefront/products?vendorId=${v.id}&minPrice=1.5`);
    expect(fraction.statusCode).toBe(400);
    expect(messages(fraction)).toContain('أحد الحقول: رقم صحيح مطلوب.');
  });
});

describe('تحقّق مدخلات القائمة العامة (DISC-032)', () => {
  it('كل مدخل معطوب 400 برسالته العربية، والحدّ المقبول 200 — لا 500 أبداً', async () => {
    if (!dbUp) return;
    const uuid = '00000000-0000-4000-8000-000000000000';
    const bad = async (query: string, message: string) => {
      const res = await get(`/storefront/products?${query}`);
      expect(res.statusCode, `${query}: ${res.body}`).toBe(400);
      expect(messages(res), query).toContain(message);
    };
    const ok = async (query: string) => {
      const res = await get(`/storefront/products?${query}`);
      expect(res.statusCode, `${query}: ${res.body}`).toBe(200);
    };

    await bad('pageSize=49', 'أحد الحقول: لا يزيد عن 48.');
    await ok('pageSize=48');
    await bad('page=0', 'رقم الصفحة: لا يقلّ عن 1.');
    await bad('sort=popular', 'أحد الحقول: قيمة غير مسموحة.');
    await bad('attrs=abc', 'قيم التصفية معرّفات مفصولة بفاصلة.');
    await ok(`attrs=${uuid},`);
    await bad('storeCategory=x', 'الفئة غير صالحة.');
    await bad('vendorId=x', 'أحد الحقول: معرّف غير صالح.');
    await bad(`q=${encodeURIComponent('ق'.repeat(121))}`, 'أحد الحقول: 120 حرفاً على الأكثر.');
    await ok(`q=${encodeURIComponent('ق'.repeat(120))}`);
    await bad(`attrs=${'-'.repeat(36)}`, 'قيمة غير صالحة في الطلب. راجع المدخلات وأعد المحاولة.');
    await bad('foo=bar', 'في الطلب حقل غير معروف — حدّث الصفحة وأعد المحاولة.');
  });
});

// ================================================================= السقوط إلى القاعدة

describe('السقوط إلى قاعدة البيانات حين يتوقّف المحرّك (DISC-034)', () => {
  let v = { id: '' };
  let soldOut = { id: '' };
  let linen = { id: '' };

  beforeAll(async () => {
    if (!dbUp) return;
    v = await makeVendor('fallback');
    soldOut = await makeProduct(v.id, { nameAr: 'قميص قطني أزرق', nameEn: 'Blue Cotton Shirt', price: 30_000n, stock: 0 });
    linen = await makeProduct(v.id, { nameAr: 'قميص كتان', price: 20_000n, stock: 4 });
    await makeProduct(v.id, { nameAr: 'منديل', descriptionAr: 'قطعة من قماش ناعم', price: 5_000n });
  }, 60_000);

  it('200 و engine=db بعد مهلة 1.5 ثانية، وتطابق جزئي بلا حساسية لحالة الأحرف في الاسمين والوصف، وتحذير في السجل، و«قمييص» لا تجد شيئاً', async () => {
    if (!dbUp) return;
    const spy = engineDown();
    const warn = vi.spyOn(Logger.prototype, 'warn');
    try {
      const shirts = await list(`vendorId=${v.id}&${q('قميص')}`);
      expect(shirts.engine).toBe('db');
      expect(names(shirts).sort()).toEqual(['قميص قطني أزرق', 'قميص كتان'].sort());
      // المهلة التي يُنتظر بعدها المحرّك قبل السقوط
      expect(spy.mock.calls.some((c) => c[1] === `/indexes/${process.env['MEILI_INDEX'] ?? 'products'}/search` && c[3] === 1500)).toBe(true);
      expect(warn.mock.calls.some((c) => String(c[0]).includes('سقط البحث إلى قاعدة البيانات'))).toBe(true);

      // جزء من الاسم الإنجليزي بحالة أحرف أخرى، وجزء من الوصف
      expect(names(await list(`vendorId=${v.id}&${q('COTTON')}`))).toEqual(['قميص قطني أزرق']);
      expect(names(await list(`vendorId=${v.id}&${q('قماش')}`))).toEqual(['منديل']);

      // لا تسامح في القاعدة: «قمييص» بلا نتيجة
      const typo = await list(`vendorId=${v.id}&${q('قمييص')}`);
      expect(typo.engine).toBe('db');
      expect(typo.total).toBe(0);
      expect(typo.items).toEqual([]);
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });

  /**
   * كان مسار القاعدة (whereOf/orderOf) يتجاهل inStock ويرتّب بالأحدث دائماً. صار يطبّق «المتوفّر فقط»
   * والترتيب بالسعر بالدولار كالمحرّك — قرار صاحبة المشروع 14 نوفمبر 2026.
   */
  it('DISC-034: «المتوفّر فقط» والترتيب بالسعر تصاعدياً وتنازلياً مطبّقة في مسار القاعدة', async () => {
    if (!dbUp) return;
    const spy = engineDown();
    try {
      const inStock = await list(`vendorId=${v.id}&${q('قميص')}&inStock=true`);
      expect(inStock.engine).toBe('db');
      expect(inStock.items.map((i) => i.id)).toEqual([linen.id]);
      expect(inStock.total).toBe(1);
      const cheap = await list(`vendorId=${v.id}&${q('قميص')}&sort=price_asc`);
      expect(cheap.engine).toBe('db');
      expect(cheap.items.map((i) => i.id)).toEqual([linen.id, soldOut.id]);
      const dear = await list(`vendorId=${v.id}&${q('قميص')}&sort=price_desc`);
      expect(dear.items.map((i) => i.id)).toEqual([soldOut.id, linen.id]);
      // الصفحة الثانية بحجم 1 هي الثاني في الترتيب، والعدد للمطابقات كلها
      const second = await list(`vendorId=${v.id}&${q('قميص')}&sort=price_asc&page=2&pageSize=1`);
      expect(second.items.map((i) => i.id)).toEqual([soldOut.id]);
      expect(second.total).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

// ================================================================= الرؤية في البحث

describe('البحث لا يُظهر غير المرئي ولو بقي في الفهرس (DISC-035)', () => {
  it('مسودّة وموقوف ومتجر معلَّق بفهرس قديم: لا في النتائج ولا في وجه المتجر، والصفوف بلا لمس، وبرفع التعليق يعود', async () => {
    if (!dbUp || !meiliUp) return;
    const word = token();
    const shop = await makeVendor('watch-a');
    const other = await makeVendor('watch-b');
    const draft = await makeProduct(shop.id, { nameAr: `ساعة ${word} أ` });
    const stopped = await makeProduct(shop.id, { nameAr: `ساعة ${word} ب` });
    const suspended = await makeProduct(other.id, { nameAr: `ساعة ${word} ج` });
    await indexed([draft.id, stopped.id, suspended.id]);
    expect((await list(q(word))).total).toBe(3);

    // التغييرات بالقاعدة مباشرةً — كما لو وقعت والمحرّك متوقّف: الفهرس يبقى قديماً
    await prisma.product.update({ where: { id: draft.id }, data: { status: 'draft' } });
    await prisma.product.update({ where: { id: stopped.id }, data: { status: 'rejected', rejectReason: 'موقوف للاختبار' } });
    await prisma.vendor.update({ where: { id: other.id }, data: { status: 'suspended', suspendedAt: new Date() } });

    const after = await list(q(word));
    expect(after.engine).toBe('meili');
    expect(after.items).toEqual([]);
    expect(after.facets.vendors.map((x) => x.id)).not.toContain(other.id);
    // صفوف المعلَّق كما هي
    expect((await prisma.product.findUniqueOrThrow({ where: { id: suspended.id } })).status).toBe('active');

    await prisma.vendor.update({ where: { id: other.id }, data: { status: 'approved', suspendedAt: null } });
    expect((await list(q(word))).items.map((i) => i.id)).toEqual([suspended.id]);
  });

  /**
   * كان عدّاد المتجر من توزيع المحرّك على الفهرس القديم، فيبقى المتجر المعتمد في الوجه بعدّ 2 ولا منتج له
   * في النتائج. صار يُعدّ على المطابقات التي تقبلها قاعدة الرؤية — قرار صاحبة المشروع 14 نوفمبر 2026.
   */
  it('DISC-035: وجه المتجر والعدد لا يعدّان المسودّة ولا الموقوف من فهرس قديم، ويعدّان المرئي', async () => {
    if (!dbUp || !meiliUp) return;
    const word = token();
    const shop = await makeVendor('watch-c');
    const draft = await makeProduct(shop.id, { nameAr: `ساعة ${word} أ` });
    const stopped = await makeProduct(shop.id, { nameAr: `ساعة ${word} ب` });
    const other = await makeVendor('watch-d');
    const live = await makeProduct(other.id, { nameAr: `ساعة ${word} د` });
    await indexed([draft.id, stopped.id, live.id]);
    await prisma.product.update({ where: { id: draft.id }, data: { status: 'draft' } });
    await prisma.product.update({ where: { id: stopped.id }, data: { status: 'rejected', rejectReason: 'موقوف للاختبار' } });

    const res = await list(q(word));
    expect(res.engine).toBe('meili');
    expect(res.items.map((i) => i.id)).toEqual([live.id]);
    expect(res.facets.vendors.map((x) => [x.id, x.count])).toEqual([[other.id, 1]]);
    expect(res.total).toBe(1);
  });
});

describe('نصّ حقن في كلمة البحث (DISC-036)', () => {
  it('SQL والسكربت يُعاملان نصّاً بـ200 والقاعدة سليمة، والاقتباس داخل الكلمة لا يوسّع مرشّح المتجر', async () => {
    if (!dbUp) return;
    const mine = await makeVendor('inject-a');
    const others = await makeVendor('inject-b');
    const own = await makeProduct(mine.id, { nameAr: 'قميص للحقن' });
    const foreign = await makeProduct(others.id, { nameAr: 'قميص غريب' });
    await indexed([own.id, foreign.id]);
    const users = await prisma.user.count();

    for (const term of ["' OR 1=1; DROP TABLE users; --", '<script>alert(1)</script>']) {
      const res = await get(`/storefront/products?${q(term)}`);
      expect(res.statusCode, term).toBe(200);
      expect((res.json() as ListBody).items.every((i) => !i.nameAr.includes('<script>'))).toBe(true);
    }
    expect(await prisma.user.count()).toBeGreaterThanOrEqual(users);

    const res = await get(`/storefront/products?vendorId=${mine.id}&${q('قميص" OR vendorId != "x')}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as ListBody;
    expect(body.items.every((i) => i.vendor.id === mine.id)).toBe(true);
    expect(body.items.map((i) => i.id)).not.toContain(foreign.id);
  });
});

// ================================================================= صفحة المتجر

describe('صفحة المتجر — ST-11 (DISC-041 · 043 · 044)', () => {
  it('DISC-041: الرأس من بيانات المتجر، و«سياسة الإرجاع» فارغة، ومنتجاته الخمسة وحدها الأحدث نشراً أولاً بلا المسودّة', async () => {
    if (!dbUp) return;
    const v = await makeVendor('profile', {
      data: {
        descriptionAr: 'متجر صغير للحرف اليدوية.',
        shippingPolicyAr: 'نشحن خلال ثلاثة أيام عمل.',
        returnPolicyAr: null,
        ratingAvg: 4.5,
        ratingCount: 8,
        createdAt: new Date('2026-10-05T10:00:00Z'),
      },
    });
    const other = await makeVendor('profile-other');
    await makeProduct(other.id, { nameAr: 'منتج متجر آخر' });
    const now = Date.now();
    const published: string[] = [];
    for (let i = 0; i < 5; i++) published.push((await makeProduct(v.id, { nameAr: `حرفة ${i}`, publishedAt: new Date(now - (i + 1) * DAY) })).id);
    const draft = await makeProduct(v.id, { nameAr: 'حرفة مسودّة', status: 'draft' });

    const res = await get(`/storefront/shops/${v.slug}`);
    expect(res.statusCode, res.body).toBe(200);
    const shop = res.json();
    expect(shop.vendor).toMatchObject({
      nameAr: v.nameAr,
      descriptionAr: 'متجر صغير للحرف اليدوية.',
      shippingPolicyAr: 'نشحن خلال ثلاثة أيام عمل.',
      returnPolicyAr: null,
      ratingAvg: 4.5,
      ratingCount: 8,
      isSuspended: false,
    });
    expect(new Date(shop.vendor.since).toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect(shop.total).toBe(5);
    // i=0 نُشر أمس فهو الأحدث
    expect(shop.products.map((p: { id: string }) => p.id)).toEqual(published);
    expect(shop.products.map((p: { id: string }) => p.id)).not.toContain(draft.id);
  });

  it('DISC-043: معرّف فئة متجر آخر لا يكشف منتجاته — صفحة المتجر والقائمة كلاهما فارغ', async () => {
    if (!dbUp) return;
    const a = await makeVendor('cat-a');
    const b = await makeVendor('cat-b');
    await makeProduct(a.id, { nameAr: 'منتج المتجر أ' });
    const watches = await prisma.vendorCategory.create({ data: { vendorId: b.id, nameAr: 'ساعات', sort: 99 } });
    await makeProduct(b.id, { nameAr: 'ساعة المتجر ب', categoryId: watches.id });

    const shop = await get(`/storefront/shops/${a.slug}?category=${watches.id}`);
    expect(shop.statusCode, shop.body).toBe(200);
    expect(shop.json()).toMatchObject({ products: [], total: 0 });

    const listed = await list(`vendorId=${a.id}&storeCategory=${watches.id}`);
    expect(listed.items).toEqual([]);
    expect(listed.total).toBe(0);
    // ومتجرها نفسه يراها — المرشّح يعمل، لا أنه يُفرغ كل شيء
    expect((await list(`vendorId=${b.id}&storeCategory=${watches.id}`)).total).toBe(1);
  });

  it('DISC-044: الـ API المباشر — category=x و page=0 مرفوضان برسالتيهما', async () => {
    if (!dbUp) return;
    const v = await makeVendor('broken-url');
    await makeProduct(v.id, { nameAr: 'منتج الرابط المعطوب' });
    const category = await get(`/storefront/shops/${v.slug}?category=x`);
    expect(category.statusCode).toBe(400);
    expect(messages(category)).toContain('الفئة غير صالحة.');
    const page = await get(`/storefront/shops/${v.slug}?page=0`);
    expect(page.statusCode).toBe(400);
    expect(messages(page)).toContain('رقم الصفحة: لا يقلّ عن 1.');
  });
});

describe('متجر قيد المراجعة ينشر فيظهر لحظة اعتماده (DISC-047)', () => {
  it('قبل الاعتماد: لا بحث ولا اقتراح ولا صفحة ولا دليل والمتجر بحالته؛ بعد اعتماد المدير من اللوحة: كلها فوراً', async () => {
    if (!dbUp || !meiliUp) return;
    const word = token();
    const v = await makeVendor('review', { status: 'in_review' });
    const lamp = await makeProduct(v.id, { nameAr: `مصباح نحاسي ${word}` });
    // النشر يزامن الفهرس — والمتجر غير المعتمد لا يدخله
    await indexed([lamp.id]);

    const before = async () => ({
      search: (await list(q(word))).items.map((i) => i.id),
      suggest: (await get(`/storefront/suggest?q=${word}`)).json().suggestions as string[],
      page: (await get(`/storefront/products/${lamp.slug}`)).statusCode,
      shop: (await get(`/storefront/shops/${v.slug}`)).json(),
      directory: ((await get(`/storefront/shops?q=${encodeURIComponent(v.nameAr)}`)).json().items as { id: string }[]).map((s) => s.id),
    });
    const pre = await before();
    expect(pre.search).toEqual([]);
    expect(pre.suggest).toEqual([]);
    expect(pre.page).toBe(404);
    expect(pre.shop.vendor.isSuspended).toBe(true);
    expect(pre.shop.products).toEqual([]);
    expect(pre.directory).not.toContain(v.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: lamp.id } })).status).toBe('active');

    const secret = generateSecret();
    const email = `reviewer.${SUFFIX}@basta.test`;
    await prisma.user.create({
      data: {
        email, fullName: 'مراجع', passwordHash: await hashPassword(PASSWORD),
        roles: { create: { role: 'admin' } },
        permissions: { create: [{ permission: 'vendors.review' }] },
        totpSecretEnc: secret, totpEnabledAt: new Date(),
      },
    });
    const admin = await login(email, secret);
    const approve = await app.inject({ method: 'POST', url: `/api/v1/admin/vendors/${v.id}/approve`, headers: { authorization: `Bearer ${admin}` } });
    expect(approve.statusCode, approve.body).toBe(204);

    // المزامنة على حدث الاعتماد نفسه — لا إعادة بناء يدوية
    await expect.poll(async () => (await list(q(word))).items.map((i) => i.id), { timeout: 15_000 }).toEqual([lamp.id]);
    const post = await before();
    expect(post.suggest).toEqual([`مصباح نحاسي ${word}`]);
    expect(post.page).toBe(200);
    expect(post.shop.vendor.isSuspended).toBe(false);
    expect(post.shop.products.map((p: { id: string }) => p.id)).toEqual([lamp.id]);
    expect(post.directory).toContain(v.id);
  });
});

// ================================================================= صفحة المنتج

describe('المنتج غير المرئي 404 في كل مسار (DISC-061)', () => {
  it('مسودّة وموقوف ومحذوف ومتغيّرات مؤرشفة ومتجر معلَّق وقيد المراجعة ومحظور: 404 برسالته، ولا في القائمة ولا البحث ولا الاقتراحات ولا المختارات', async () => {
    if (!dbUp) return;
    const word = token();
    const shop = await makeVendor('hidden');
    const suspended = await makeVendor('hidden-suspended');
    const review = await makeVendor('hidden-review');
    const banned = await makeVendor('hidden-banned');
    const cases = {
      draft: await makeProduct(shop.id, { nameAr: `${word} مسودّة` }),
      rejected: await makeProduct(shop.id, { nameAr: `${word} موقوف` }),
      deleted: await makeProduct(shop.id, { nameAr: `${word} محذوف` }),
      archivedVariants: await makeProduct(shop.id, { nameAr: `${word} بلا متغيّر` }),
      suspended: await makeProduct(suspended.id, { nameAr: `${word} معلَّق` }),
      review: await makeProduct(review.id, { nameAr: `${word} قيد المراجعة` }),
      banned: await makeProduct(banned.id, { nameAr: `${word} محظور` }),
    };
    await indexed(Object.values(cases).map((c) => c.id));
    expect((await list(q(word))).total).toBe(7);

    // كل تغيير بالقاعدة مباشرةً: الفهرس القديم لا يُنقذ المخفي
    await prisma.product.update({ where: { id: cases.draft.id }, data: { status: 'draft' } });
    await prisma.product.update({ where: { id: cases.rejected.id }, data: { status: 'rejected', rejectReason: 'موقوف' } });
    await prisma.product.update({ where: { id: cases.deleted.id }, data: { deletedAt: new Date() } });
    await prisma.productVariant.update({ where: { id: cases.archivedVariants.variantId }, data: { isActive: false, archivedAt: new Date() } });
    await prisma.vendor.update({ where: { id: suspended.id }, data: { status: 'suspended', suspendedAt: new Date() } });
    await prisma.vendor.update({ where: { id: review.id }, data: { status: 'in_review', approvedAt: null } });
    await prisma.vendor.update({ where: { id: banned.id }, data: { status: 'banned' } });

    const KEY = 'home_featured_product_ids';
    const saved = await prisma.setting.findUnique({ where: { key: KEY } });
    const hidden = Object.values(cases).map((c) => c.id);
    try {
      for (const [label, c] of Object.entries(cases)) {
        const res = await get(`/storefront/products/${c.slug}`);
        expect(res.statusCode, label).toBe(404);
        expect(res.json().message, label).toBe('المنتج غير موجود أو لم يعد معروضاً.');
      }
      for (const vendorId of [shop.id, suspended.id, review.id, banned.id]) {
        expect((await list(`vendorId=${vendorId}&pageSize=48`)).items.filter((i) => hidden.includes(i.id))).toEqual([]);
      }
      if (meiliUp) {
        expect((await list(q(word))).items).toEqual([]);
        expect((await get(`/storefront/suggest?q=${word}`)).json().suggestions).toEqual([]);
      }
      // المختارات والحملات بطاقات بقاعدة الرؤية نفسها (cardsByIds)
      await prisma.setting.upsert({ where: { key: KEY }, update: { valueJson: hidden }, create: { key: KEY, valueJson: hidden } });
      expect((await get('/storefront/featured')).json()).toEqual([]);
    } finally {
      if (saved) await prisma.setting.update({ where: { key: KEY }, data: { valueJson: saved.valueJson as never } });
      else await prisma.setting.delete({ where: { key: KEY } }).catch(() => undefined);
    }
  });
});

describe('رابط منتج عربي بأشكاله (DISC-063)', () => {
  it('المشفّر مرة 200، والمشفّر مرتين 404، و% المعطوبة 400 أو 404 بلا تفاصيل داخلية', async () => {
    if (!dbUp) return;
    const v = await makeVendor('slug');
    const slug = `قميص-قطني-أزرق-${token()}`;
    await makeProduct(v.id, { nameAr: 'قميص قطني أزرق', slug });

    const once = await get(`/storefront/products/${encodeURIComponent(slug)}`);
    expect(once.statusCode, once.body).toBe(200);
    expect(once.json().slug).toBe(slug);
    expect((await get(`/storefront/products/${encodeURIComponent(encodeURIComponent(slug))}`)).statusCode).toBe(404);

    const broken = await get('/storefront/products/%E0%A4%A');
    expect([400, 404]).toContain(broken.statusCode);
    expect(broken.body).not.toMatch(/prisma|stack|\bat \w+ \(/i);
  });
});
