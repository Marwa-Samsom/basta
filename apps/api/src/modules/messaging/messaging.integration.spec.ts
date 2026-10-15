/**
 * ST-09 · ST-28 · VD-15 — الرسائل بين المشتري والمتجر، عبر الواجهة البرمجية الحيّة.
 *
 * ما يُثبَت:
 *   1. سياق المنتج وسياق الطلب، والسياق نفسه يُكمل المحادثة نفسها.
 *   2. **العزل**: مشترٍ لا يفتح محادثة غيره ولا يكتب فيها، ومتجر لا يرى
 *      محادثة متجر آخر، ولا يفتح أحد محادثة عن طلب غيره — 404 كغير الموجود.
 *   3. البائع يردّ ولا يبدأ، وصاحب المتجر لا يراسل متجره.
 *   4. المقروء وغير المقروء من الطرفين، وعدّاد غير المقروء.
 *   5. **تنبيه واحد لكل دفعة غير مقروءة**: رسالتان متتاليتان → تنبيه واحد،
 *      وبعد أن يقرأ المستلم تنبّه الرسالة التالية من جديد.
 *   6. الرسائل للإضافة فقط في القاعدة نفسها، وحدود النصّ.
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

const SUFFIX = `msg${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const ADDRESS = { recipientName: 'مشترٍ', phone: '+966500000000', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'طريق الملك فهد 1' };

interface Shop {
  ownerId: string;
  token: string;
  vendorId: string;
  productId: string;
  variantId: string;
  nameAr: string;
}
const shops: Shop[] = [];
const alice = { userId: '', token: '' };
const bob = { userId: '', token: '' };
let draftProductId = '';
let subOrderNumber = '';
let orderNumber = '';

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
function call(method: 'GET' | 'POST', url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
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

async function makeCustomer(tag: string) {
  const email = `${tag}.${SUFFIX}@basta.test`;
  const u = await prisma.user.create({
    data: { email, fullName: `مشترٍ ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  return { userId: u.id, token: await login(email) };
}

/** مجموعة تنبيهات واحدة = صفّ لكل قناة مفعّلة للقالب */
async function notificationSets(code: string, userId: string, link: string): Promise<number> {
  const channels = await prisma.notificationTemplate.count({ where: { code, locale: 'ar', isEnabled: true } });
  expect(channels).toBeGreaterThan(0);
  const rows = await prisma.notification.count({
    where: { templateCode: code, userId, payloadJson: { path: ['link'], equals: link } },
  });
  expect(rows % channels).toBe(0);
  return rows / channels;
}
const vendorSets = (i: number, id: string) => notificationSets('message_to_vendor', shops[i]!.ownerId, `/vendor/messages?c=${id}`);
const customerSets = (userId: string, id: string) => notificationSets('message_to_customer', userId, `/account/messages?c=${id}`);

async function send(token: string, url: string, body: string): Promise<Res> {
  return call('POST', url, token, { body });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات الرسائل متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  for (const tag of ['x', 'y']) {
    const email = `shop${tag}.${SUFFIX}@basta.test`;
    const u = await prisma.user.create({
      data: { email, fullName: `بائع ${tag}`, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
    });
    const nameAr = `متجر رسائل ${tag} ${SUFFIX}`;
    const vendor = await prisma.vendor.create({
      data: {
        ownerUserId: u.id, slug: `msg-${tag}-${SUFFIX}`, nameAr, status: 'approved', approvedAt: new Date(),
        settlementCurrency: 'SAR', country: 'SA',
        shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 1_500n } } } },
      },
    });
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, slug: `msg-${tag}-${SUFFIX}`, nameAr: `عباءة ${tag}`, status: 'active', publishedAt: new Date() },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, vendorId: vendor.id, sku: `MSG-${tag}-${SUFFIX}`.toUpperCase(), priceMinorUnits: 10_000n, optionsKey: '', isActive: true },
    });
    await prisma.inventory.create({ data: { variantId: variant.id, onHand: 20, reserved: 0 } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 20, reason: 'import' } });
    shops.push({ ownerId: u.id, token: await login(email), vendorId: vendor.id, productId: product.id, variantId: variant.id, nameAr });
  }
  const draft = await prisma.product.create({
    data: { vendorId: shops[0]!.vendorId, slug: `msg-draft-${SUFFIX}`, nameAr: 'مسودّة', status: 'draft' },
  });
  draftProductId = draft.id;

  Object.assign(alice, await makeCustomer('alice'));
  Object.assign(bob, await makeCustomer('bob'));

  // أليس تشتري من المتجر س — طلب حقيقي بطريق الدفع كاملاً
  const cart = await call('POST', '/cart', undefined, { currency: 'SAR' });
  const cartToken = cart.json().token as string;
  const add = await call('POST', '/cart/items', undefined, { variantId: shops[0]!.variantId, qty: 1 }, { 'x-cart-token': cartToken });
  expect(add.statusCode, add.body).toBe(201);
  // الإجمالي كما يراه المشتري تحت «ادفع» — يُرسل مع الطلب ولا يُخصم غيره
  const shown = (await call('POST', '/checkout/quote', undefined, { country: ADDRESS.country, region: ADDRESS.region, city: ADDRESS.city }, { 'x-cart-token': cartToken })).json();
  const placed = await call('POST', '/checkout', alice.token, { address: ADDRESS, paymentToken: 'tok_success', expectedTotal: shown.totals.total.minorUnits, expectedCurrency: shown.currency }, {
    'x-cart-token': cartToken,
    'idempotency-key': randomUUID(),
  });
  expect(placed.statusCode, placed.body).toBe(200);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.json().orderId }, include: { subOrders: true } });
  orderNumber = order.orderNumber;
  subOrderNumber = order.subOrders[0]!.subOrderNumber;
}, 120_000);

afterAll(async () => {
  /*
   * المحادثات ورسائلها لا تُحذف (للإضافة فقط، ومفاتيحها RESTRICT) فيبقى
   * المستخدمون. لكن ما يظهر للزوار يُخفى: المنتجات تُؤرشف.
   */
  if (dbUp && shops.length) {
    const now = new Date();
    await prisma.productVariant.updateMany({ where: { id: { in: shops.map((s) => s.variantId) } }, data: { archivedAt: now, isActive: false } });
    await prisma.product.updateMany({
      where: { id: { in: [...shops.map((s) => s.productId), draftProductId].filter(Boolean) } },
      data: { deletedAt: now, status: 'archived' },
    });
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('ST-09 · بدء محادثة', () => {
  it('بلا دخول: 401', async () => {
    if (!dbUp) return;
    expect((await call('GET', '/me/conversations')).statusCode).toBe(401);
    expect((await call('POST', '/me/conversations', undefined, { productId: shops[0]!.productId, body: 'سؤال' })).statusCode).toBe(401);
    expect((await call('GET', '/vendor/conversations')).statusCode).toBe(401);
  });

  it('سياق المنتج: محادثة مع متجر المنتج، والسؤال الثاني يُكمل المحادثة نفسها', async () => {
    if (!dbUp) return;
    const first = await call('POST', '/me/conversations', alice.token, { productId: shops[0]!.productId, body: '  هل يتوفّر مقاس XL؟  ' });
    expect(first.statusCode, first.body).toBe(201);
    const id = first.json().id as string;

    const c = await prisma.conversation.findUniqueOrThrow({ where: { id }, include: { messages: true } });
    expect(c).toMatchObject({
      customerId: alice.userId,
      vendorId: shops[0]!.vendorId,
      contextKey: `product:${shops[0]!.productId}`,
      productId: shops[0]!.productId,
      subOrderId: null,
      lastSenderSide: 'customer',
      lastPreview: 'هل يتوفّر مقاس XL؟',
      vendorReadAt: null,
    });
    expect(c.messages.map((m) => m.body)).toEqual(['هل يتوفّر مقاس XL؟']); // مشذَّبة
    expect(await vendorSets(0, id)).toBe(1);

    const again = await call('POST', '/me/conversations', alice.token, { productId: shops[0]!.productId, body: 'وهل القطن مصري؟' });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json().id).toBe(id);
    expect(await prisma.conversationMessage.count({ where: { conversationId: id } })).toBe(2);
    expect(await prisma.conversation.count({ where: { customerId: alice.userId, vendorId: shops[0]!.vendorId, productId: shops[0]!.productId } })).toBe(1);
  });

  it('سياق الطلب: برقم شحنة المتجر من طلبي، والسياق نفسه يُكمل محادثته', async () => {
    if (!dbUp) return;
    const r = await call('POST', '/me/conversations', alice.token, { orderNumber: subOrderNumber, body: 'متى يُشحن طلبي؟' });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as string;
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(c.vendorId).toBe(shops[0]!.vendorId);
    expect(c.productId).toBeNull();
    expect(c.contextKey).toBe(`order:${c.subOrderId}`);

    const again = await call('POST', '/me/conversations', alice.token, { orderNumber: subOrderNumber, body: 'وهل يصل قبل الخميس؟' });
    expect(again.json().id).toBe(id);

    const opened = await call('GET', `/me/conversations/${id}`, alice.token);
    expect(opened.statusCode).toBe(200);
    expect(opened.json().context).toEqual({ kind: 'order', label: `طلب ${subOrderNumber}`, subOrderNumber, orderNumber });
    const vendorView = await call('GET', `/vendor/conversations/${id}`, shops[0]!.token);
    expect(vendorView.json().context).toEqual({ kind: 'order', label: `طلب ${subOrderNumber}`, subOrderNumber, subOrderId: c.subOrderId });
  });

  it('منتج غير منشور أو غير موجود: 404، وسياقان معاً أو بلا سياق: 400', async () => {
    if (!dbUp) return;
    expect((await call('POST', '/me/conversations', alice.token, { productId: draftProductId, body: 'سؤال عن المسودة' })).statusCode).toBe(404);
    expect((await call('POST', '/me/conversations', alice.token, { productId: randomUUID(), body: 'سؤال' })).statusCode).toBe(404);
    expect((await call('POST', '/me/conversations', alice.token, { productId: shops[0]!.productId, orderNumber: subOrderNumber, body: 'كلاهما' })).statusCode).toBe(400);
    expect((await call('POST', '/me/conversations', alice.token, { body: 'بلا سياق' })).statusCode).toBe(400);
    expect((await call('POST', '/me/conversations', alice.token, { productId: 'not-a-uuid', body: 'سؤال' })).statusCode).toBe(400);
    expect(await prisma.conversation.count({ where: { productId: draftProductId } })).toBe(0);
  });

  it('حدود النصّ: فارغ أو فراغات أو أطول من 1000 يُرفض، و 1000 بالضبط تُقبل، والمعاينة 140 حرفاً', async () => {
    if (!dbUp) return;
    const p = shops[1]!.productId;
    for (const body of ['', '    ', 'x'.repeat(1001)]) {
      const r = await call('POST', '/me/conversations', bob.token, { productId: p, body });
      expect(r.statusCode, `${body.length}: ${r.body}`).toBe(400);
    }
    expect(await prisma.conversation.count({ where: { customerId: bob.userId } })).toBe(0);
    const long = 'ب'.repeat(1000);
    const ok = await call('POST', '/me/conversations', bob.token, { productId: p, body: long });
    expect(ok.statusCode, ok.body).toBe(201);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: ok.json().id } });
    expect(c.lastPreview).toBe('ب'.repeat(140));
    const reply = await send(bob.token, `/me/conversations/${c.id}/messages`, '   ');
    expect(reply.statusCode).toBe(400);
  });
});

describe('VD-15 · البائع يردّ ولا يبدأ', () => {
  it('لا مسار لبدء محادثة من البائع، وصاحب المتجر لا يراسل متجره من حساب المشتري', async () => {
    if (!dbUp) return;
    const x = shops[0]!;
    expect((await call('POST', '/vendor/conversations', x.token, { body: 'عرض خاص لك!' })).statusCode).toBe(404);
    const own = await call('POST', '/me/conversations', x.token, { productId: x.productId, body: 'أسأل متجري' });
    expect(own.statusCode, own.body).toBe(400);
    expect(await prisma.conversation.count({ where: { customerId: x.ownerId } })).toBe(0);
  });

  it('مشترٍ لا يدخل مسارات البائع', async () => {
    if (!dbUp) return;
    expect((await call('GET', '/vendor/conversations', alice.token)).statusCode).toBe(403);
  });
});

describe('ST-28 · VD-15 · العزل', () => {
  it('مشترٍ آخر لا يفتح محادثتي ولا يكتب فيها، ومتجر آخر لا يراها — 404', async () => {
    if (!dbUp) return;
    const created = await call('POST', '/me/conversations', alice.token, { productId: shops[0]!.productId, body: 'سرّ بيني وبين المتجر' });
    const id = created.json().id as string;
    const before = await prisma.conversationMessage.count({ where: { conversationId: id } });

    const attempts = [
      await call('GET', `/me/conversations/${id}`, bob.token),
      await send(bob.token, `/me/conversations/${id}/messages`, 'اختطاف المحادثة'),
      await call('GET', `/vendor/conversations/${id}`, shops[1]!.token),
      await send(shops[1]!.token, `/vendor/conversations/${id}/messages`, 'ردّ من متجر آخر'),
    ];
    for (const r of attempts) {
      expect(r.statusCode, r.body).toBe(404);
      expect(r.body).not.toContain('سرّ بيني');
    }
    expect(await prisma.conversationMessage.count({ where: { conversationId: id } })).toBe(before);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(c.vendorReadAt).toBeNull(); // فتح المتجر الآخر لم يعلّمها مقروءة

    const bobList = (await call('GET', '/me/conversations', bob.token)).json().items as { id: string }[];
    expect(bobList.map((i) => i.id)).not.toContain(id);
    const yList = (await call('GET', '/vendor/conversations', shops[1]!.token)).json().items as { id: string }[];
    expect(yList.map((i) => i.id)).not.toContain(id);

    // معرّف غير موجود أو غير صالح — 404 مثله
    expect((await call('GET', `/me/conversations/${randomUUID()}`, alice.token)).statusCode).toBe(404);
    expect((await call('GET', '/me/conversations/nope', alice.token)).statusCode).toBe(404);
  });

  it('لا محادثة عن طلب غيري — رقم شحنة أليس من حساب بوب 404 ولا يُنشأ شيء', async () => {
    if (!dbUp) return;
    const r = await call('POST', '/me/conversations', bob.token, { orderNumber: subOrderNumber, body: 'أين طلبي؟' });
    expect(r.statusCode, r.body).toBe(404);
    expect(await prisma.conversation.count({ where: { customerId: bob.userId, subOrderId: { not: null } } })).toBe(0);
    // ورقم الطلب الأب ليس رقم شحنة
    expect((await call('POST', '/me/conversations', alice.token, { orderNumber, body: 'بالرقم الأب' })).statusCode).toBe(404);
  });
});

describe('ST-28 · VD-15 · المقروء والتنبيه', () => {
  it('رسالتان متتاليتان → تنبيه واحد؛ بعد أن يقرأ المتجر تنبّه التالية؛ والمقروء من الطرفين', async () => {
    if (!dbUp) return;
    const carol = await makeCustomer('carol');
    const x = shops[0]!;
    const start = await call('POST', '/me/conversations', carol.token, { productId: x.productId, body: 'السؤال الأول' });
    const id = start.json().id as string;
    expect(await vendorSets(0, id)).toBe(1);

    // الثانية قبل أن يقرأ المتجر: لا تنبيه جديد
    expect((await send(carol.token, `/me/conversations/${id}/messages`, 'السؤال الثاني')).statusCode).toBe(201);
    expect(await vendorSets(0, id)).toBe(1);

    // المتجر يرى محادثة غير مقروءة
    let list = (await call('GET', '/vendor/conversations', x.token)).json() as {
      unread: number;
      items: { id: string; unread: boolean; customer: { fullName: string }; context: { kind: string; label: string; productSlug: string }; lastPreview: string }[];
    };
    const row = list.items.find((i) => i.id === id)!;
    expect(row).toMatchObject({ unread: true, customer: { fullName: 'مشترٍ carol' }, lastPreview: 'السؤال الثاني' });
    expect(row.context).toMatchObject({ kind: 'product', label: 'منتج: عباءة x', productSlug: `msg-x-${SUFFIX}` });
    const unreadBefore = list.unread;
    expect(unreadBefore).toBeGreaterThanOrEqual(1);

    // يفتحها: الرسائل بالترتيب، وتصير مقروءة
    const opened = await call('GET', `/vendor/conversations/${id}`, x.token);
    expect(opened.statusCode, opened.body).toBe(200);
    const thread = opened.json() as { customer: { fullName: string }; messages: { body: string; side: string; mine: boolean }[] };
    expect(thread.customer.fullName).toBe('مشترٍ carol');
    expect(thread.messages.map((m) => [m.body, m.side, m.mine])).toEqual([
      ['السؤال الأول', 'customer', false],
      ['السؤال الثاني', 'customer', false],
    ]);
    expect(JSON.stringify(thread)).not.toContain(carol.userId); // لا معرّف المرسِل
    list = (await call('GET', '/vendor/conversations', x.token)).json();
    expect(list.items.find((i) => i.id === id)!.unread).toBe(false);
    expect(list.unread).toBe(unreadBefore - 1);

    // الثالثة بعد القراءة: دفعة جديدة، تنبيه جديد
    expect((await send(carol.token, `/me/conversations/${id}/messages`, 'السؤال الثالث')).statusCode).toBe(201);
    expect(await vendorSets(0, id)).toBe(2);

    // المتجر يردّ مرتين قبل أن تقرأ المشترية: تنبيه واحد لها
    expect((await send(x.token, `/vendor/conversations/${id}/messages`, 'نعم متوفّر')).statusCode).toBe(201);
    expect((await send(x.token, `/vendor/conversations/${id}/messages`, 'ونشحنه غداً')).statusCode).toBe(201);
    expect(await customerSets(carol.userId, id)).toBe(1);
    // ردّ المتجر لا ينبّه المتجر، ويُحسب قراءةً له
    expect(await vendorSets(0, id)).toBe(2);
    expect((await call('GET', '/vendor/conversations', x.token)).json().items.find((i: { id: string }) => i.id === id).unread).toBe(false);

    // المشترية ترى غير المقروء، ثم تفتح
    const mine = (await call('GET', '/me/conversations', carol.token)).json() as {
      unread: number;
      items: { id: string; unread: boolean; shop: { nameAr: string; slug: string }; lastPreview: string }[];
    };
    expect(mine.unread).toBe(1);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ id, unread: true, shop: { nameAr: x.nameAr, slug: `msg-x-${SUFFIX}` }, lastPreview: 'ونشحنه غداً' });
    expect(mine.items[0]).not.toHaveProperty('customer');

    const view = (await call('GET', `/me/conversations/${id}`, carol.token)).json() as { messages: { body: string; mine: boolean }[] };
    expect(view.messages.map((m) => [m.body, m.mine])).toEqual([
      ['السؤال الأول', true],
      ['السؤال الثاني', true],
      ['السؤال الثالث', true],
      ['نعم متوفّر', false],
      ['ونشحنه غداً', false],
    ]);
    const after = (await call('GET', '/me/conversations', carol.token)).json();
    expect(after.unread).toBe(0);
    expect(after.items[0].unread).toBe(false);

    // بعد قراءتها، ردّ المتجر التالي ينبّهها من جديد
    expect((await send(x.token, `/vendor/conversations/${id}/messages`, 'شُحن الآن')).statusCode).toBe(201);
    expect(await customerSets(carol.userId, id)).toBe(2);

    // التنبيه يحمل سياق المحادثة ونصّها
    // الأول بالترتيب: للمتجر تنبيهان على المحادثة (السؤال الأول ثم الثالث بعد قراءته)،
    // وبلا ترتيب تعيد القاعدة أيّهما شاءت
    const n = await prisma.notification.findFirstOrThrow({
      where: { templateCode: 'message_to_vendor', userId: x.ownerId, payloadJson: { path: ['link'], equals: `/vendor/messages?c=${id}` } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(n.payloadJson).toMatchObject({ customer_name: 'مشترٍ carol', context: 'منتج: عباءة x', preview: 'السؤال الأول', store_name: x.nameAr });
  });
});

describe('الرسائل للإضافة فقط', () => {
  it('UPDATE و DELETE على conversation_messages ترفضهما القاعدة', async () => {
    if (!dbUp) return;
    const m = await prisma.conversationMessage.findFirstOrThrow({ where: { conversation: { customerId: alice.userId } } });
    await expect(prisma.$executeRaw`UPDATE "conversation_messages" SET "body" = 'مزوَّرة' WHERE "id" = ${m.id}::uuid`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM "conversation_messages" WHERE "id" = ${m.id}::uuid`).rejects.toThrow();
    expect((await prisma.conversationMessage.findUniqueOrThrow({ where: { id: m.id } })).body).toBe(m.body);
  });
});
