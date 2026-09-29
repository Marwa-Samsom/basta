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

async function placeOrder(qty = 2) {
  const cart = await call('POST', '/cart', undefined, { currency: 'SAR' });
  const token = cart.json().token as string;
  await call('POST', '/cart/items', undefined, { variantId: vendor.variantId, qty }, { 'x-cart-token': token });
  const res = await call('POST', '/checkout', buyer.token, {
    address: { recipientName: 'مشترٍ', phone: '+966500000001', country: 'SA', region: 'الرياض', city: 'الرياض', street: 'شارع 1' },
    paymentToken: 'tok_success',
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

  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'home' } });
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
    data: { vendorId: v.id, categoryId: category.id, slug: `p-${SUFFIX}`, nameAr: `منتج ${SUFFIX}`, status: 'active', publishedAt: new Date() },
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
  });

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
    const shipped = await prisma.notification.findMany({ where: { userId: buyer.userId, templateCode: 'order_status_changed' } });
    expect(shipped.some((n) => n.channel === 'in_app' && n.body?.includes('تم الشحن'))).toBe(true);
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

    const from = '2020-01-01';
    // نافذة مغلقة تنتهي قبل خمس ثوانٍ: ملفات الاختبار الأخرى تكتب في الدفتر بالتوازي،
    // والمطابقة تكون على ماضٍ لا يتغيّر بين قراءة التقرير وقراءة الجداول
    await new Promise((r) => setTimeout(r, 5_200)); // ليدخل طلب هذا الاختبار نفسه النافذة
    const cut = new Date(Date.now() - 5_000);
    const to = cut.toISOString();
    const res = await call('GET', `/admin/reports/financial?from=${from}&to=${to}`, admin.token);
    expect(res.statusCode, res.body).toBe(200);
    const report = res.json();

    const sign = (d: string, a: bigint) => (d === 'credit' ? a : -a);
    const platform = await prisma.platformLedgerEntry.findMany({ where: { createdAt: { lt: cut } } });
    const ledger = await prisma.ledgerEntry.findMany({ where: { createdAt: { lt: cut } } });
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
    const orders = await prisma.order.findMany({ where: { paidAt: { not: null, lt: cut } } });
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

  it('التقرير المالي يحتاج reports.view — مدير المحتوى يُمنع', async () => {
    if (!dbUp) return;
    expect((await call('GET', '/admin/reports/financial', limited.token)).statusCode).toBe(403);
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
    const banner = await call('POST', '/admin/banners', limited.token, { placement: 'home_hero', imageKey: img.json().imageKey, linkUrl: '/categories', titleAr: `تخفيضات ${SUFFIX}`, isActive: true });
    expect(banner.statusCode, banner.body).toBe(201);
    const live = (await call('GET', '/storefront/banners?placement=home_hero')).json();
    const b = live.find((x: { titleAr: string }) => x.titleAr === `تخفيضات ${SUFFIX}`);
    expect(b.imageUrl).toMatch(/^\/uploads\/banners\/.+\/full\.webp$/);
    expect((await app.inject({ method: 'GET', url: b.imageUrl })).statusCode).toBe(200);

    const before = (await call('GET', '/admin/storefront/featured', limited.token)).json() as string[];
    expect((await call('PUT', '/admin/storefront/featured', limited.token, { productIds: [vendor.productId] })).statusCode).toBe(204);
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
    expect((await call('POST', `/admin/reviews/${r.json().id}/moderate`, limited.token, { status: 'rejected', reason: 'ألفاظ مسيئة' })).statusCode).toBe(204);
    const visible = (await call('GET', `/products/${vendor.productId}/reviews`)).json();
    expect(JSON.stringify(visible)).not.toContain(`كلام مسيء ${SUFFIX}`);
  });

  it('الطلبات والمرتجعات والتدقيق: بحث من اللوحة، وكل إجراء إداري في السجل', async () => {
    if (!dbUp) return;
    const found = await call('GET', `/admin/orders?q=${encodeURIComponent(`متجر ${SUFFIX}`)}`, admin.token);
    expect(found.statusCode).toBe(200);
    expect(found.json().total).toBeGreaterThanOrEqual(1);
    const ret = await call('GET', '/admin/returns', admin.token);
    expect(ret.statusCode).toBe(200);
    expect(ret.json().refunds.length).toBeGreaterThanOrEqual(1);

    const log = await call('GET', `/admin/audit?actor=root.${SUFFIX}`, admin.token);
    const actions = log.json().items.map((i: { action: string }) => i.action);
    for (const a of ['setting.update', 'tax.set', 'fx.add', 'customer.suspend', 'admin.grant', 'coupon.create', 'page.save']) {
      expect(actions, a).toContain(a);
    }
    // السجل للقراءة: لا مسار يعدّله، والقاعدة ترفض
    const one = await prisma.auditLog.findFirstOrThrow({ where: { action: 'setting.update' } });
    await expect(prisma.auditLog.update({ where: { id: one.id }, data: { action: 'x' } })).rejects.toThrow();
  });

  it('اللوحة: طوابير العمل وتنبيهات الانحراف في مكان واحد', async () => {
    if (!dbUp) return;
    const d = await call('GET', '/admin/dashboard', admin.token);
    expect(d.statusCode).toBe(200);
    expect(d.json().queues).toMatchObject({ vendors: expect.any(Number), products: expect.any(Number), payouts: expect.any(Number), disputes: expect.any(Number) });
    expect(d.json().alerts).toEqual([]);
  });
});
