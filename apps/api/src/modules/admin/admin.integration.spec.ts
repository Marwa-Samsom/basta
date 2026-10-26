/**
 * بوابة المرحلة 11 — البنود الثلاثة، عبر الواجهة البرمجية الحيّة.
 *
 *   1. لا عملية تشغيلية يومية تتطلّب فتح قاعدة البيانات
 *   2. كل تقرير مالي يطابق دفتر الحركات من المرحلة 10
 *   3. كل إشعار له قالب عربي مراجَع لغوياً ووصل فعلياً في اختبار حي
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { DEFAULT_TEMPLATES, NotificationsService, REDACTED, eventOf } from '../notifications/public';
import { OperationsService } from './application/operations.service';
import { PERMISSION_CODES } from './public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let notifications: NotificationsService;
let dbUp = false;

const SUFFIX = `ad${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();

let admin = { userId: '', token: '' };
let limited = { userId: '', token: '' }; // مدير بلا صلاحيات مالية
let buyer = { userId: '', token: '', email: '' };
let vendor = { userId: '', vendorId: '', variantId: '', productId: '', token: '' };

/** أرقام هاتف لا تتكرّر بين تشغيلات الاختبار — الهاتف فريد في القاعدة */
const uniquePhone = () => `+9665${randomBytes(4).readUInt32BE(0).toString().padStart(10, '0').slice(-8)}`;

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
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
  return res.statusCode === 200 ? (res.json().tokens.accessToken as string) : '';
}

async function makeAdmin(tag: string, permissions: readonly string[]) {
  const secret = generateSecret();
  const email = `${tag}.${SUFFIX}@basta.test`;
  const u = await prisma.user.create({
    data: {
      email, fullName: `مدير ${tag}`, phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD),
      roles: { create: { role: 'admin' } },
      permissions: { create: permissions.map((permission) => ({ permission })) },
      totpSecretEnc: secret, totpEnabledAt: new Date(),
    },
  });
  return { userId: u.id, token: await login(email, secret) };
}

/**
 * الصندوق الصادر مشترك بين ملفات الاختبار الجارية معاً: dispatch يرسل الأقدم أولاً
 * بدفعات، فإشعارات هذا الملف قد تتأخّر عن دفعة واحدة. يُدار حتى تُرسل إشعارات هؤلاء.
 */
async function drain(...userIds: string[]): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await notifications.dispatch(500);
    const left = await prisma.notification.count({ where: { userId: { in: userIds }, status: { in: ['queued', 'sending'] } } });
    if (left === 0) return;
  }
}

async function placeOrder(qty = 2, currency = 'SAR') {
  const cart = await call('POST', '/cart', undefined, { currency });
  const token = cart.json().token as string;
  await call('POST', '/cart/items', undefined, { variantId: vendor.variantId, qty }, { 'x-cart-token': token });
  const address = { recipientName: 'مشترٍ', phone: '+966500000001', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' };
  const shown = (await call('POST', '/checkout/quote', undefined, { country: address.country, region: address.region, city: address.city }, { 'x-cart-token': token })).json();
  const res = await call('POST', '/checkout', buyer.token, {
    address,
    paymentToken: 'tok_success',
    expectedTotal: shown.totals.total.minorUnits,
    expectedCurrency: shown.currency,
  }, { 'x-cart-token': token, 'idempotency-key': randomUUID() });
  expect(res.statusCode, res.body).toBe(200);
  return prisma.order.findUniqueOrThrow({ where: { id: res.json().orderId }, include: { subOrders: { include: { items: true } } } });
}

function multipart(file: Buffer, name: string, type: string) {
  const boundary = `----basta${randomBytes(8).toString('hex')}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات الإدارة الحيّة متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  notifications = app.get(NotificationsService);

  admin = await makeAdmin('root', PERMISSION_CODES);
  limited = await makeAdmin('content', ['content.manage']);

  const vEmail = `vendor.${SUFFIX}@basta.test`;
  const vu = await prisma.user.create({
    data: { email: vEmail, fullName: 'بائع الإدارة', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } },
  });
  const v = await prisma.vendor.create({
    data: {
      ownerUserId: vu.id, slug: `v-${SUFFIX}`, nameAr: `متجر ${SUFFIX}`, status: 'approved', approvedAt: new Date(), settlementCurrency: 'SAR', country: 'SA',
      shippingZones: { create: { nameAr: 'السعودية', regions: { create: { country: 'SA' } }, rates: { create: { method: 'flat', priceMinorUnits: 1_500n } } } },
      bankAccounts: { create: { holderName: 'بائع', iban: 'SA0380000000608010167519', bankName: 'بنك', isDefault: true } },
    },
  });
  const p = await prisma.product.create({
    data: { vendorId: v.id, slug: `p-${SUFFIX}`, nameAr: `منتج ${SUFFIX}`, status: 'active', publishedAt: new Date() },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: p.id, vendorId: v.id, sku: `SKU-${SUFFIX}`.toUpperCase(), priceMinorUnits: 15_000n, optionsKey: '', isActive: true },
  });
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: 100, reserved: 0 } });
  await prisma.inventoryMovement.create({ data: { variantId: variant.id, delta: 100, reason: 'import' } });
  vendor = { userId: vu.id, vendorId: v.id, variantId: variant.id, productId: p.id, token: await login(vEmail) };

  buyer.email = `buyer.${SUFFIX}@basta.test`;
  const bu = await prisma.user.create({
    data: { email: buyer.email, fullName: 'ليلى المشترية', phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } },
  });
  buyer = { ...buyer, userId: bu.id, token: await login(buyer.email) };
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

// ============================================================== البند 3

describe('بوابة 11 · البند 3 — كل إشعار: قالب عربي مراجَع، ووصل فعلاً', () => {
  it('كل قالب افتراضي موجود بالعربية ومراجَع، وكل قناة تسلّم رسالة كاملة بلا متغيّر خام', async () => {
    if (!dbUp) return;
    await notifications.ensureDefaults();
    // الإشعار للمتصفّح يحتاج اشتراكاً — اشتراك المدير التجريبي
    await call('POST', '/me/notifications/push-subscriptions', admin.token, {
      endpoint: `https://push.example.test/${SUFFIX}`,
      keys: { p256dh: 'test', auth: 'test' },
    });

    for (const t of DEFAULT_TEMPLATES) {
      const row = await prisma.notificationTemplate.findUniqueOrThrow({ where: { code_channel_locale: { code: t.code, channel: t.channel, locale: 'ar' } } });
      expect(row.reviewedAt, `${t.code}/${t.channel} غير مراجَع`).not.toBeNull();
      expect(row.body).toMatch(/[؀-ۿ]/);

      const res = await call('POST', `/admin/notifications/templates/${t.code}/${t.channel}/test`, admin.token);
      expect(res.statusCode, res.body).toBe(200);
      const n = res.json();
      expect(n.status, `${t.code}/${t.channel}: ${n.error}`).toBe('sent');
      expect(n.body).not.toMatch(/\{\{/);
      if (t.channel === 'email') expect(n.subject).not.toMatch(/\{\{/);

      if (t.channel === 'in_app') {
        expect(n.deliveryRef).toBe('in_app');
      } else {
        // وصل فعلاً: الملف في الصندوق المحلي بالنص نفسه — والسرّ وصل صاحبه ولم يبقَ في الصف
        const file = await readFile(n.deliveryRef, 'utf8');
        const ev = eventOf(t.code)!;
        let delivered: string = n.body;
        for (const s of ev.secret ?? []) {
          expect(n.body).not.toContain(ev.sample[s]!);
          delivered = delivered.replaceAll(REDACTED, ev.sample[s]!);
        }
        if (t.channel === 'email') {
          expect(file).toContain(`Message-ID: <${n.id}@basta.local>`);
          const b64 = file.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
          expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(delivered);
        } else {
          expect(JSON.parse(file).text).toBe(delivered);
        }
      }
    }
    // إرسال تجريبي لكل قالب بالتتابع: صارت القوالب أكثر من 60 (النزاع والإدارة، 19 أكتوبر
    // 2026) فتجاوزت المهلة الافتراضية (5 ث) تحت حمل التشغيل الكامل
  }, 30_000);

  it('أحداث حقيقية: طلب مدفوع يصل المشتري والبائع، وشحنه يصل المشتري', async () => {
    if (!dbUp) return;
    const order = await placeOrder();
    await drain(buyer.userId, vendor.userId);
    const mine = await prisma.notification.findMany({ where: { userId: buyer.userId, templateCode: 'order_placed' } });
    expect(mine.map((n) => n.channel).sort()).toEqual(['email', 'in_app', 'sms']);
    expect(mine.every((n) => n.status === 'sent')).toBe(true);
    expect(mine.find((n) => n.channel === 'in_app')!.body).toContain(order.orderNumber);
    const vend = await prisma.notification.findMany({ where: { userId: vendor.userId, templateCode: 'vendor_new_order' } });
    const byChannel = Object.fromEntries(vend.map((n) => [n.channel, n]));
    expect(byChannel['email']?.status).toBe('sent');
    expect(byChannel['in_app']?.status).toBe('sent');
    // البائع بلا هاتف: واتساب يُتخطّى بسببه المكتوب، لا يُفشل ولا يُسقط الطلب
    expect(byChannel['whatsapp']?.status).toBe('skipped');
    expect(byChannel['whatsapp']?.error).toMatch(/لا عنوان/);

    const sub = order.subOrders[0]!;
    for (const to of ['accepted', 'preparing', 'ready_to_ship']) {
      expect((await call('POST', `/vendor/orders/${sub.id}/transition`, vendor.token, { to })).statusCode).toBe(200);
    }
    expect((await call('POST', `/vendor/orders/${sub.id}/transition`, vendor.token, { to: 'shipped', tracking: 'SELF-1234' })).statusCode).toBe(200);
    await drain(buyer.userId);
    // إشعار الشحن يحمل المرجع، والتوصيل الذاتي لا يسمّيه «رقم تتبّع» (BUY-086)
    const shipped = await prisma.notification.findMany({ where: { userId: buyer.userId, templateCode: 'order_shipped' } });
    expect(shipped.find((n) => n.channel === 'in_app')?.body).toContain('مرجع التوصيل: SELF-1234');
    expect(shipped.find((n) => n.channel === 'email')?.body).toContain('مرجع التوصيل: SELF-1234');
    // المشتري بلا اشتراك متصفّح: القناة تُتخطّى بسببها، لا تفشل ولا تُسقط شيئاً
    expect(shipped.find((n) => n.channel === 'push')?.status).toBe('skipped');

    const inbox = await call('GET', '/me/notifications', buyer.token);
    expect(inbox.json().unread).toBeGreaterThanOrEqual(2);
    await call('POST', '/me/notifications/read', buyer.token);
    expect((await call('GET', '/me/notifications', buyer.token)).json().unread).toBe(0);
  }, 30_000);

  it('تعديل القالب: متغيّر غير معلن يُرفض، والتعديل يُسقط المراجعة حتى يُراجَع ثانية', async () => {
    if (!dbUp) return;
    const bad = await call('PUT', '/admin/notifications/templates/refund_issued/in_app', admin.token, { body: 'رددنا {{amount}} إلى {{iban}}' });
    expect(bad.statusCode).toBe(400);
    const ok = await call('PUT', '/admin/notifications/templates/refund_issued/in_app', admin.token, { body: 'أعدنا {{amount}} إلى وسيلة دفعك عن الطلب {{order_number}}.' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().reviewedAt).toBeNull();
    expect((await call('POST', '/admin/notifications/templates/refund_issued/in_app/review', admin.token, { reviewer: 'مدقّق اللغة' })).statusCode).toBe(204);
    const row = await prisma.notificationTemplate.findUniqueOrThrow({ where: { code_channel_locale: { code: 'refund_issued', channel: 'in_app', locale: 'ar' } } });
    expect(row.reviewedBy).toBe('مدقّق اللغة');
    const preview = await call('POST', '/admin/notifications/templates/refund_issued/preview', admin.token, { body: row.body });
    expect(preview.json().body).toContain('BST-260921-A1B2C3');
  });

  it('صلاحية المحتوى لا تستولي على حساب: قوالب الرموز مقفولة، والرمز لا يبقى في السجل', async () => {
    if (!dbUp) return;
    const editor = await makeAdmin('tpl-editor', ['content.manage']);
    const key = (code: string, channel: string) => ({ code_channel_locale: { code, channel, locale: 'ar' } });

    // ١. الطريق المباشر مسدود: لا تحرير، ولا قناة جديدة، ولا إيقاف
    const subj = await call('PUT', '/admin/notifications/templates/password_reset_code/email', editor.token, { subject: '{{code}}', body: 'رمزك {{code}} يا {{name}}' });
    expect(subj.statusCode).toBe(409);
    const inApp = await call('PUT', '/admin/notifications/templates/password_reset_code/in_app', editor.token, { body: 'رمز الاستعادة: {{code}}' });
    expect(inApp.statusCode).toBe(409);
    const off = await call('PUT', '/admin/notifications/templates/email_verify_code/email', editor.token, { subject: 'رمز', body: 'رمزك {{code}}', isEnabled: false });
    expect(off.statusCode).toBe(409);
    expect(await prisma.notificationTemplate.count({ where: { code: 'password_reset_code', channel: 'in_app' } })).toBe(0);
    // تنبيه الأمن يُحرَّر نصّه ولا يُوقف
    const hush = await call('PUT', '/admin/notifications/templates/recovery_code_used/email', editor.token, { subject: 'تنبيه', body: 'استُعمل رمز استعادة. الباقي: {{left}}.', isEnabled: false });
    expect(hush.statusCode).toBe(409);

    // ٢. عبث سابق في القاعدة لا يُرسَل: المقفول يُرسل بنصّ الكود، والإقلاع يعيده ويحذف المضاف
    await prisma.notificationTemplate.update({ where: key('password_reset_code', 'email'), data: { subject: 'رمزك {{code}}' } });
    await prisma.notificationTemplate.create({ data: { code: 'password_reset_code', channel: 'in_app', locale: 'ar', body: '{{code}}' } });
    await prisma.notificationTemplate.update({ where: key('recovery_code_used', 'email'), data: { isEnabled: false } });

    const forgot = await call('POST', '/auth/password/forgot', undefined, { email: buyer.email });
    expect(forgot.statusCode).toBe(200);
    await drain(buyer.userId);

    const rows = await prisma.notification.findMany({ where: { userId: buyer.userId, templateCode: 'password_reset_code' } });
    expect(rows.map((r) => r.channel)).toEqual(['email']);
    const sent = rows[0]!;
    expect(sent.status).toBe('sent');
    // الرمز وصل صاحبه — في بريده
    const mail = await readFile(sent.deliveryRef!, 'utf8');
    const mailBody = Buffer.from(mail.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8');
    const code = /\d{6}/.exec(mailBody)![0];
    // ولم يبقَ في الصف ولا في عنوانه ولا في السجل الذي يقرؤه المدير
    expect((sent.payloadJson as Record<string, string>)['code']).toBe(REDACTED);
    expect(sent.body).not.toContain(code);
    expect(sent.subject).not.toContain(code);
    const log = await call('GET', '/admin/notifications/log', editor.token);
    expect(log.statusCode).toBe(200);
    expect(log.body).not.toContain(code);

    await notifications.ensureDefaults();
    const email = await prisma.notificationTemplate.findUniqueOrThrow({ where: key('password_reset_code', 'email') });
    const seed = DEFAULT_TEMPLATES.find((t) => t.code === 'password_reset_code' && t.channel === 'email')!;
    expect(email.subject).toBe(seed.subject);
    expect(await prisma.notificationTemplate.count({ where: { code: 'password_reset_code', channel: 'in_app' } })).toBe(0);
    expect((await prisma.notificationTemplate.findUniqueOrThrow({ where: key('recovery_code_used', 'email') })).isEnabled).toBe(true);
  }, 30_000);

  it('إشعار معطوب لا يُسقط الحدث: متغيّر ناقص يُختم failed بسببه', async () => {
    if (!dbUp) return;
    await notifications.enqueue({ code: 'refund_issued', userId: buyer.userId, vars: { name: 'ليلى' } });
    await drain(buyer.userId);
    const failed = await prisma.notification.findFirst({ where: { userId: buyer.userId, templateCode: 'refund_issued', status: 'failed' } });
    expect(failed?.error).toMatch(/متغيّر ناقص/);
  });
});

// ============================================================== البند 2

describe('بوابة 11 · البند 2 — التقرير المالي يطابق الدفتر', () => {
  it('كل رقم في التقرير = مجموعه المستقل من جداول الدفتر، لكل عملة، وفي CSV و Excel', async () => {
    if (!dbUp) return;
    const order = await placeOrder(3);
    // إلغاء لينتج استرداد وعكس قيود
    await call('POST', `/me/orders/${order.orderNumber}/stores/${order.subOrders[0]!.id}/cancel`, buyer.token, {});

    // نافذة مغلقة تنتهي قبل خمس ثوانٍ: ملفات الاختبار الأخرى تكتب في الدفتر بالتوازي،
    // والمطابقة تكون على ماضٍ لا يتغيّر بين قراءة التقرير وقراءة الجداول
    await new Promise((r) => setTimeout(r, 5_200)); // ليدخل طلب هذا الاختبار نفسه النافذة
    const cut = new Date(Date.now() - 5_000);
    const to = cut.toISOString();
    // سنة تنتهي عند القطع — أطول فترة يقبلها التقرير، والمجاميع المستقلة على النافذة نفسها
    const since = new Date(cut.getTime() - 365 * 86_400_000);
    const from = since.toISOString();
    const res = await call('GET', `/admin/reports/financial?from=${from}&to=${to}`, admin.token);
    expect(res.statusCode, res.body).toBe(200);
    const report = res.json();

    const sign = (d: string, a: bigint) => (d === 'credit' ? a : -a);
    const platform = await prisma.platformLedgerEntry.findMany({ where: { createdAt: { gte: since, lt: cut } } });
    const ledger = await prisma.ledgerEntry.findMany({ where: { createdAt: { gte: since, lt: cut } } });
    for (const row of report.ledger) {
      const c = row.currency as string;
      const p = (t?: string) => platform.filter((e) => e.currency === c && (!t || e.entryType === t)).reduce((a, e) => a + sign(e.direction, e.amountMinorUnits), 0n);
      const l = (t: string) => ledger.filter((e) => e.currency === c && e.entryType === t).reduce((a, e) => a + sign(e.direction, e.amountMinorUnits), 0n);
      expect(BigInt(row.commissionMinorUnits), `عمولة ${c}`).toBe(p('commission'));
      expect(BigInt(row.taxHeldMinorUnits)).toBe(p('tax_held'));
      expect(BigInt(row.platformNetMinorUnits)).toBe(p());
      expect(BigInt(row.vendorSalesMinorUnits)).toBe(l('sale_credit') + l('shipping_credit'));
      expect(BigInt(row.vendorRefundsMinorUnits)).toBe(-l('refund_debit'));
    }
    const orders = await prisma.order.findMany({ where: { paidAt: { not: null, gte: since, lt: cut } } });
    for (const row of report.sales) {
      const mine = orders.filter((o) => o.currency === row.currency);
      expect(row.orders).toBe(mine.length);
      expect(BigInt(row.grossMinorUnits)).toBe(mine.reduce((a, o) => a + o.grandTotalMinorUnits, 0n));
    }
    // الدفتر نفسه سليم وقت التقرير
    expect(report.ledger.length).toBeGreaterThan(0);
    const drift = (await call('GET', '/admin/health/drift', admin.token)).json() as { rows: number }[];
    expect(drift.every((d) => d.rows === 0)).toBe(true);

    const csv = await call('GET', `/admin/reports/financial.csv?from=${from}&to=${to}`, admin.token);
    expect(csv.statusCode).toBe(200);
    const sar = report.ledger.find((r: { currency: string }) => r.currency === 'SAR');
    expect(csv.body).toContain(`"${sar.commissionMinorUnits}"`);

    const xlsx = await call('GET', `/admin/reports/financial.xlsx?from=${from}&to=${to}`, admin.token);
    expect(xlsx.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet('الدفتر')!;
    const head = (sheet.getRow(1).values as string[]).slice(1);
    const rowOf = [...Array(sheet.rowCount).keys()].map((i) => sheet.getRow(i + 1).values as unknown[]).find((v) => v[1] === 'SAR')!;
    expect(String(rowOf[head.indexOf('العمولة') + 1])).toBe(sar.commissionMinorUnits);
  }, 30_000);

  it('دخل فرق الصرف على هامش لحظة الدفع المحفوظ مع الفرعي، لا على الإعداد اليوم (ACFG-093)', async () => {
    if (!dbUp) return;
    // متجر بالريال ودفع بالدينار: الهامش يدخل السعر ويُحفظ على الفرعي كما كان نافذاً
    const order = await placeOrder(1, 'JOD');
    const live = Number((await prisma.setting.findUnique({ where: { key: 'fx_spread_bps' } }))?.valueJson ?? 200);
    const sub = await prisma.subOrder.findUniqueOrThrow({ where: { id: order.subOrders[0]!.id } });
    expect(sub.settlementCurrency).toBe('SAR');
    expect(sub.fxSpreadBpsSnapshot).toBe(live);

    // هامش لحظة الدفع غير الإعداد اليوم (كأن المدير غيّره بعد الدفع): التقرير يتبع الفرعي.
    // لا يُغيَّر الإعداد نفسه — ملفات أخرى تسعّر بالتوازي على القاعدة نفسها
    const then = live + 300;
    await prisma.subOrder.update({ where: { id: sub.id }, data: { fxSpreadBpsSnapshot: then } });
    const paidAt = order.paidAt!;
    const from = paidAt.toISOString();
    const to = new Date(paidAt.getTime() + 1).toISOString();
    const res = await call('GET', `/admin/reports/financial?from=${from}&to=${to}`, admin.token);
    expect(res.statusCode, res.body).toBe(200);
    const jod = res.json().sales.find((x: { currency: string }) => x.currency === 'JOD');
    const charge = Number(sub.chargeTotalMinorUnits);
    expect(jod.fxSpreadMinorUnits).toBe(String(charge - Math.round((charge * 10_000) / (10_000 + then))));
  });

  it('التقرير المالي يحتاج reports.view — مدير المحتوى يُمنع', async () => {
    if (!dbUp) return;
    expect((await call('GET', '/admin/reports/financial', limited.token)).statusCode).toBe(403);
    // الفترة لها سقف: سنة تمرّ، وأطول منها يُرفض قبل أن يُمسح شيء — في التقرير والتصدير
    expect((await call('GET', '/admin/reports/financial?from=2025-01-01&to=2025-12-31', admin.token)).statusCode).toBe(200);
    for (const path of ['/admin/reports/financial', '/admin/reports/financial.csv', '/admin/reports/financial.xlsx']) {
      const long = await call('GET', `${path}?from=2000-01-01&to=2026-01-01`, admin.token);
      expect(long.statusCode, path).toBe(400);
      expect(long.json().message).toMatch(/366 يوماً على الأكثر/);
    }
    expect((await call('GET', '/admin/finance/payouts', limited.token)).statusCode).toBe(403);
    const board = await call('GET', '/admin/dashboard', limited.token);
    expect(board.statusCode).toBe(200);
    // الطوابير نعم، والمال لا
    expect(board.json().queues).toBeTruthy();
    expect(board.json().sales).toBeNull();
    expect(board.json().ledger).toBeNull();
  });
});

// ============================================================== البند 1

describe('بوابة 11 · البند 1 — العمليات اليومية من الواجهة لا من القاعدة', () => {
  it('الإعدادات والضرائب وأسعار الصرف: تُحرَّر بحدودها، ولكل تغيير سطر تدقيق بقيمته قبل وبعد', async () => {
    if (!dbUp) return;
    const s = await call('GET', '/admin/settings', admin.token);
    const hold = s.json().settings.find((x: { key: string }) => x.key === 'hold_period_days');
    expect(hold.financial).toBeTruthy();
    expect((await call('PUT', '/admin/settings/hold_period_days', admin.token, { value: 999 })).statusCode).toBe(400);
    expect((await call('PUT', '/admin/settings/unknown_key', admin.token, { value: 1 })).statusCode).toBe(404);
    expect((await call('PUT', '/admin/settings/hold_period_days', admin.token, { value: hold.value })).statusCode).toBe(204);
    const trail = await call('GET', `/admin/audit?action=setting.update&entityId=hold_period_days`, admin.token);
    expect(trail.json().items[0].beforeJson).toEqual({ value: hold.value });

    // بيانات التحويل نصّ بصيغته: IBAN برمز بلده، والاسم المستعار لاتيني — الخطأ يُرفض قبل أن يراه مشترٍ
    expect((await call('PUT', '/admin/settings/transfer_iban', admin.token, { value: '1234' })).statusCode).toBe(400);
    expect((await call('PUT', '/admin/settings/transfer_cliq_alias', admin.token, { value: 'بسطة' })).statusCode).toBe(400);
    expect((await call('PUT', '/admin/settings/transfer_beneficiary', admin.token, { value: 42 })).statusCode).toBe(400);
    expect((await call('PUT', '/admin/settings/transfer_bank', admin.token, { value: 'x'.repeat(81) })).statusCode).toBe(400);
    const bank = s.json().settings.find((x: { key: string }) => x.key === 'transfer_bank');
    expect(bank.kind).toBe('text');
    expect((await call('PUT', '/admin/settings/transfer_bank', admin.token, { value: '  بنك الاختبار  ' })).statusCode).toBe(204);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'transfer_bank' } })).valueJson).toBe('بنك الاختبار');
    if (bank.value === null) await prisma.setting.delete({ where: { key: 'transfer_bank' } });
    else await prisma.setting.update({ where: { key: 'transfer_bank' }, data: { valueJson: bank.value } });

    expect((await call('PUT', '/admin/taxes/KW', admin.token, { rateBps: 0, isPriceInclusive: true })).statusCode).toBe(204);
    const kw = await prisma.taxRate.findMany({ where: { country: 'KW' } });
    expect(kw.filter((t) => t.effectiveTo === null)).toHaveLength(1);

    const fx = await call('POST', '/admin/fx-rates', admin.token, { quote: 'SAR', rate: '3.75', source: 'البنك المركزي' });
    expect(fx.statusCode, fx.body).toBe(201);
    const cur = (await call('GET', '/admin/currencies', admin.token)).json();
    expect(cur.currencies.find((c: { code: string }) => c.code === 'SAR').currentRate).toMatch(/^3\.75/);
  });

  it('العملاء: البحث والتعليق يُنهي الجلسة ويمنع الدخول، ثم الإعادة', async () => {
    if (!dbUp) return;
    const email = `cust.${SUFFIX}@basta.test`;
    const u = await prisma.user.create({ data: { email, fullName: 'عميل للتعليق', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } } });
    const found = await call('GET', `/admin/customers?q=cust.${SUFFIX}`, admin.token);
    expect(found.json().items.map((x: { id: string }) => x.id)).toContain(u.id);
    expect((await call('POST', `/admin/customers/${u.id}/suspend`, admin.token, { reason: 'احتيال مشتبه في الدفع' })).statusCode).toBe(204);
    expect(await login(email)).toBe('');
    expect((await call('POST', `/admin/customers/${u.id}/reinstate`, admin.token)).statusCode).toBe(204);
    expect(await login(email)).not.toBe('');
  });

  it('مستخدمو الإدارة: منح لحساب قائم، وتعديل الصلاحيات، ولا يسحب أحد من نفسه', async () => {
    if (!dbUp) return;
    const email = `newadmin.${SUFFIX}@basta.test`;
    await prisma.user.create({ data: { email, fullName: 'مدير جديد', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } } });
    const g = await call('POST', '/admin/users/grant', admin.token, { email, permissions: ['reports.view'] });
    expect(g.statusCode, g.body).toBe(201);
    expect((await call('POST', '/admin/users/grant', admin.token, { email, permissions: ['everything'] })).statusCode).toBe(400);
    const list = (await call('GET', '/admin/users', admin.token)).json();
    const mine = list.find((x: { email: string }) => x.email === email);
    expect(mine.twoFactor).toBe(false);
    expect(mine.permissions).toEqual(['reports.view']);
    expect((await call('PUT', `/admin/users/${admin.userId}/permissions`, admin.token, { permissions: ['reports.view'] })).statusCode).toBe(409);
    expect((await call('POST', `/admin/users/${mine.id}/revoke`, admin.token)).statusCode).toBe(204);
  });

  it('لا يمنح مدير ما لا يحمله ولا يسحبه، ولا يمسّ مالك المنصة', async () => {
    if (!dbUp) return;
    const perms = async (id: string) => (await prisma.adminPermission.findMany({ where: { userId: id } })).map((p) => p.permission).sort();
    // مدير يدير المستخدمين ويقرأ التقارير فقط
    const staff = await makeAdmin('staff', ['users.manage', 'reports.view']);
    const put = (id: string, permissions: string[]) => call('PUT', `/admin/users/${id}/permissions`, staff.token, { permissions });

    // لا يرفع نفسه
    const self = await put(staff.userId, ['users.manage', 'reports.view', 'payouts.approve']);
    expect(self.statusCode, self.body).toBe(403);
    expect(self.json().details).toEqual({ permissions: ['payouts.approve'] });
    expect(await perms(staff.userId)).toEqual(['reports.view', 'users.manage']);

    // يمنح غيره مما يحمل، ولا يمنحه غيره
    const email = `junior.${SUFFIX}@basta.test`;
    await prisma.user.create({ data: { email, fullName: 'مدير مبتدئ', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } } });
    expect((await call('POST', '/admin/users/grant', staff.token, { email, permissions: ['payouts.approve'] })).statusCode).toBe(403);
    const granted = await call('POST', '/admin/users/grant', staff.token, { email, permissions: ['reports.view'] });
    expect(granted.statusCode, granted.body).toBe(201);
    expect((await put(granted.json().userId, [])).statusCode).toBe(204);

    // ولا يجرّد مديراً أوسع منه مما لم يُعطَه، ولا يسحب إدارته
    const senior = await makeAdmin('senior', ['payouts.approve', 'reports.view']);
    expect((await put(senior.userId, ['reports.view'])).statusCode).toBe(403);
    expect((await call('POST', `/admin/users/${senior.userId}/revoke`, staff.token)).statusCode).toBe(403);
    expect(await perms(senior.userId)).toEqual(['payouts.approve', 'reports.view']);

    // مالك المنصة: لا يمسّه حتى مدير بكل الصلاحيات
    const owner = (await prisma.user.findFirst({ where: { isPlatformOwner: true }, select: { id: true } }))
      ?? (await prisma.user.create({
        data: { email: `owner.${SUFFIX}@basta.test`, fullName: 'المالك', isPlatformOwner: true, roles: { create: { role: 'admin' } }, permissions: { create: PERMISSION_CODES.map((permission) => ({ permission })) } },
        select: { id: true },
      }));
    const ownerBefore = await perms(owner.id);
    expect((await call('PUT', `/admin/users/${owner.id}/permissions`, admin.token, { permissions: ['reports.view'] })).statusCode).toBe(403);
    expect((await call('POST', `/admin/users/${owner.id}/revoke`, admin.token)).statusCode).toBe(403);
    expect(await perms(owner.id)).toEqual(ownerBefore);
    expect((await call('GET', '/admin/users', staff.token)).json().find((u: { id: string }) => u.id === owner.id).isOwner).toBe(true);

    // والمالك وحده فوق القاعدة: يمنح ما يشاء
    await app.get(OperationsService).setPermissions(owner.id, senior.userId, ['payouts.approve', 'reports.view', 'settings.edit']);
    expect(await perms(senior.userId)).toEqual(['payouts.approve', 'reports.view', 'settings.edit']);
  });

  it('الكوبون والصفحة والبانر والمميّز: من اللوحة إلى المتجر', async () => {
    if (!dbUp) return;
    const code = `SAVE${SUFFIX.slice(-6)}`.toUpperCase();
    const c = await call('POST', '/admin/coupons', admin.token, { code, scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform' });
    expect(c.statusCode, c.body).toBe(201);
    expect((await call('POST', '/admin/coupons', admin.token, { code, scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'platform' })).statusCode).toBe(409);
    expect((await call('POST', '/admin/coupons', admin.token, { code: `${code}X`, scope: 'platform', type: 'percent', valueBps: 1000, fundedBy: 'vendor' })).statusCode).toBe(400);

    const slug = `about-${SUFFIX}`;
    const page = await call('POST', '/admin/pages', admin.token, { slug, titleAr: 'من نحن', bodyAr: 'بسطة سوق للمتاجر المستقلة.', isPublished: false });
    expect(page.statusCode, page.body).toBe(201);
    expect((await call('GET', `/pages/${slug}`)).statusCode).toBe(404);
    await call('PUT', `/admin/pages/${page.json().id}`, admin.token, { slug, titleAr: 'من نحن', bodyAr: 'بسطة سوق للمتاجر المستقلة.', isPublished: true });
    expect((await call('GET', `/pages/${slug}`)).json().titleAr).toBe('من نحن');

    const png = await sharp({ create: { width: 1200, height: 400, channels: 3, background: { r: 120, g: 30, b: 40 } } }).png().toBuffer();
    const up = multipart(png, 'banner.png', 'image/png');
    const img = await app.inject({ method: 'POST', url: '/api/v1/admin/banners/image', headers: { authorization: `Bearer ${limited.token}`, ...up.headers }, payload: up.payload });
    expect(img.statusCode, img.body).toBe(201);
    // رابط لموقع آخر يلبس ثوب المسار: يُرفض عند الحفظ، ولا يُكتب صفّ
    for (const linkUrl of ['//evil.com', '/\\evil.com', '/\t/evil.com']) {
      const bad = await call('POST', '/admin/banners', limited.token, { placement: 'home_hero', imageKey: img.json().imageKey, linkUrl, titleAr: `خبيث ${SUFFIX}`, isActive: true });
      expect(bad.statusCode, `${JSON.stringify(linkUrl)} ${bad.body}`).toBe(400);
    }
    expect(await prisma.banner.count({ where: { titleAr: `خبيث ${SUFFIX}` } })).toBe(0);
    const banner = await call('POST', '/admin/banners', limited.token, { placement: 'home_hero', imageKey: img.json().imageKey, linkUrl: '/shops', titleAr: `تخفيضات ${SUFFIX}`, isActive: true });
    expect(banner.statusCode, banner.body).toBe(201);
    const live = (await call('GET', '/storefront/banners?placement=home_hero')).json();
    const b = live.find((x: { titleAr: string }) => x.titleAr === `تخفيضات ${SUFFIX}`);
    expect(b.imageUrl).toMatch(/^\/uploads\/banners\/.+\/full\.webp$/);
    expect((await app.inject({ method: 'GET', url: b.imageUrl })).statusCode).toBe(200);

    const before = ((await call('GET', '/admin/storefront/featured', limited.token)).json() as { id: string; active: boolean }[]).filter((p) => p.active).map((p) => p.id);
    expect((await call('PUT', '/admin/storefront/featured', limited.token, { productIds: [vendor.productId] })).statusCode).toBe(204);
    // المميّز يعود باسمه ومتجره — لا يُبحث عنه في أول مئة منتج
    expect((await call('GET', '/admin/storefront/featured', limited.token)).json()).toEqual([
      { id: vendor.productId, nameAr: expect.any(String), vendor: `متجر ${SUFFIX}`, active: true },
    ]);
    const featured = (await call('GET', '/storefront/featured')).json();
    expect(featured.map((p: { id: string }) => p.id)).toContain(vendor.productId);

    // الاختبار يعمل على قاعدة التطوير نفسها: لا يترك بانره ولا مميّزه في رئيسيتها
    await call('PATCH', `/admin/banners/${banner.json().id}`, limited.token, { placement: 'home_hero', imageKey: img.json().imageKey, isActive: false });
    expect((await call('GET', '/storefront/banners?placement=home_hero')).json().some((x: { id: string }) => x.id === banner.json().id)).toBe(false);
    await call('PUT', '/admin/storefront/featured', limited.token, { productIds: before.filter((id) => id !== vendor.productId) });
  });

  it('مراجعة منتج مسيئة تُخفى بسبب، وتختفي من صفحة المنتج', async () => {
    if (!dbUp) return;
    const order = await placeOrder(1);
    const sub = order.subOrders[0]!;
    for (const to of ['accepted', 'preparing', 'ready_to_ship']) await call('POST', `/vendor/orders/${sub.id}/transition`, vendor.token, { to });
    await call('POST', `/vendor/orders/${sub.id}/transition`, vendor.token, { to: 'shipped', tracking: 'SELF-9999' });
    await call('POST', `/vendor/orders/${sub.id}/transition`, vendor.token, { to: 'delivered' });
    const r = await call('POST', '/me/reviews', buyer.token, { orderItemId: sub.items[0]!.id, rating: 1, body: `كلام مسيء ${SUFFIX}` });
    expect(r.statusCode, r.body).toBe(201);
    expect((await call('POST', `/admin/reviews/${r.json().id}/moderate`, limited.token, { status: 'rejected' })).statusCode).toBe(400);
    const ratingOf = () => prisma.product.findUniqueOrThrow({ where: { id: vendor.productId }, select: { ratingCount: true } });
    const before = (await ratingOf()).ratingCount;
    expect((await call('POST', `/admin/reviews/${r.json().id}/moderate`, limited.token, { status: 'rejected', reason: 'ألفاظ مسيئة' })).statusCode).toBe(204);
    const visible = (await call('GET', `/products/${vendor.productId}/reviews`)).json();
    expect(JSON.stringify(visible)).not.toContain(`كلام مسيء ${SUFFIX}`);
    // المخفية لا تُحسب في تقييم المنتج، والمُعادة تُحسب (BUY-070)
    expect((await ratingOf()).ratingCount).toBe(before - 1);
    expect(visible.count).toBe(before - 1);
    expect((await call('POST', `/admin/reviews/${r.json().id}/moderate`, limited.token, { status: 'published' })).statusCode).toBe(204);
    expect((await ratingOf()).ratingCount).toBe(before);
    expect((await call('POST', `/admin/reviews/${r.json().id}/moderate`, limited.token, { status: 'rejected', reason: 'ألفاظ مسيئة' })).statusCode).toBe(204);
    // تُوجد بالبحث في نصّها داخل حالتها، ولا تظهر في المنشورة
    const hidden = (await call('GET', `/admin/reviews?status=rejected&search=${encodeURIComponent(`مسيء ${SUFFIX}`)}`, limited.token)).json();
    expect(hidden).toMatchObject({ total: 1 });
    expect(hidden.items[0].id).toBe(r.json().id);
    expect((await call('GET', `/admin/reviews?status=published&search=${encodeURIComponent(`مسيء ${SUFFIX}`)}`, limited.token)).json()).toMatchObject({ items: [], total: 0 });
  });

  it('الطلبات والمرتجعات والتدقيق: بحث من اللوحة، وكل إجراء إداري في السجل', async () => {
    if (!dbUp) return;
    const found = await call('GET', `/admin/orders?q=${encodeURIComponent(`متجر ${SUFFIX}`)}`, admin.token);
    expect(found.statusCode).toBe(200);
    expect(found.json().total).toBeGreaterThanOrEqual(1);
    // المبالغ المعادة باسم المتجر، كلها له؛ وبحث بلا مطابق فارغ
    const ret = await call('GET', `/admin/returns/refunds?search=${encodeURIComponent(`متجر ${SUFFIX}`)}`, admin.token);
    expect(ret.statusCode).toBe(200);
    expect(ret.json().total).toBeGreaterThanOrEqual(1);
    expect(ret.json().items.every((r: { subOrder: { vendor: { nameAr: string } } }) => r.subOrder.vendor.nameAr === `متجر ${SUFFIX}`)).toBe(true);
    expect((await call('GET', '/admin/returns/refunds?search=لا-مطابق-هنا', admin.token)).json()).toMatchObject({ items: [], total: 0 });
    expect((await call('GET', '/admin/returns?search=لا-مطابق-هنا', admin.token)).json()).toMatchObject({ items: [], total: 0 });

    const log = await call('GET', `/admin/audit?actor=root.${SUFFIX}`, admin.token);
    const actions = log.json().items.map((i: { action: string }) => i.action);
    // الترتيب: الأحدث أولاً افتراضياً، و?sort=oldest يعكسه من أوله، وغيرهما 400
    const times = (r: { json: () => { items: { createdAt: string }[] } }) => r.json().items.map((i) => Date.parse(i.createdAt));
    const newest = times(log);
    const oldest = times(await call('GET', `/admin/audit?actor=root.${SUFFIX}&sort=oldest`, admin.token));
    expect(newest.length).toBeGreaterThan(1);
    expect(newest).toEqual([...newest].sort((x, y) => y - x));
    expect(oldest).toEqual([...oldest].sort((x, y) => x - y));
    expect(oldest[0]).toBeLessThan(newest[0]!);
    expect((await call('GET', '/admin/orders?sort=bogus', admin.token)).statusCode).toBe(400);
    for (const a of ['setting.update', 'tax.set', 'fx.add', 'customer.suspend', 'admin.grant', 'coupon.create', 'page.save']) {
      expect(actions, a).toContain(a);
    }
    // السجل للقراءة: لا مسار يعدّله، والقاعدة ترفض
    const one = await prisma.auditLog.findFirstOrThrow({ where: { action: 'setting.update' } });
    await expect(prisma.auditLog.update({ where: { id: one.id }, data: { action: 'x' } })).rejects.toThrow();
  });

  it('«قاربت مهلة القبول»: البطاقة تفتح ما تعدّه وحده، بالقاعدة نفسها (J-03)', async () => {
    if (!dbUp) return;
    const near = await placeOrder(1);
    const fresh = await placeOrder(1);
    const sub = near.subOrders[0]!;
    const hours = Number((await prisma.setting.findUnique({ where: { key: 'vendor_accept_timeout_hours' } }))?.valueJson) || 48;
    // الاختبار يعمل على قاعدة التطوير نفسها: يرجّع طلبه هو وحده، ويعيده بعدها فلا يظهر
    // في لوحة من يجرّب يدوياً ولا تلغيه مهمة الطلبات الحيّة
    const placedAt = new Date(Date.now() - (hours - 8) * 3_600_000);
    await prisma.subOrder.update({ where: { id: sub.id }, data: { placedAt } });
    try {
      const list = await call('GET', '/admin/orders?due=acceptance', admin.token);
      expect(list.statusCode, list.body).toBe(200);
      type Item = { orderNumber: string; subOrders: { id: string; acceptBy: string | null; acceptanceDue: boolean }[] };
      const items = list.json().items as Item[];
      expect(items.map((o) => o.orderNumber)).toContain(near.orderNumber);
      expect(items.map((o) => o.orderNumber)).not.toContain(fresh.orderNumber);
      const mine = items.find((o) => o.orderNumber === near.orderNumber)!.subOrders.find((s) => s.id === sub.id)!;
      expect(mine.acceptanceDue).toBe(true);
      expect(new Date(mine.acceptBy!).getTime()).toBe(placedAt.getTime() + hours * 3_600_000);

      // البطاقة تعدّ الفرعيات نفسها التي تعرضها القائمة — لا رقم بلا قائمة. القائمة كلها لا صفحتها
      // الأولى: على قاعدة التطوير قد يقارب المهلة مئات الطلبات من تشغيلات سابقة (20 أكتوبر 2026)
      const all: Item[] = [...items];
      for (let page = 2; all.length < (list.json().total as number); page++) {
        const next = (await call('GET', `/admin/orders?due=acceptance&page=${page}`, admin.token)).json().items as Item[];
        if (next.length === 0) break;
        all.push(...next);
      }
      const queued = (await call('GET', '/admin/dashboard', admin.token)).json().queues.overdueAcceptance as number;
      expect(queued).toBe(all.flatMap((o) => o.subOrders).filter((s) => s.acceptanceDue).length);

      expect((await call('GET', '/admin/orders?due=late', admin.token)).statusCode).toBe(400);
    } finally {
      await prisma.subOrder.update({ where: { id: sub.id }, data: { placedAt: new Date() } });
    }
  });

  it('اللوحة: طوابير العمل وتنبيهات الانحراف في مكان واحد', async () => {
    if (!dbUp) return;
    const d = await call('GET', '/admin/dashboard', admin.token);
    expect(d.statusCode).toBe(200);
    expect(d.json().queues).toMatchObject({ vendors: expect.any(Number), payouts: expect.any(Number), disputes: expect.any(Number) });
    expect(d.json().alerts).toEqual([]);
  });
});
