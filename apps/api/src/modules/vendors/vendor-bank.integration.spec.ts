/**
 * VD-20 · حسابات البائع البنكية وتفضيلات الإشعار — عبر الواجهة البرمجية الحيّة.
 *
 * التهديد: جلسة بائع مسروقة تضيف آيباناً وتجعله وجهة التحويل. ما يُثبَت:
 *   1. الإضافة بكلمة المرور (والرمز إن كان التحقق بخطوتين مفعَّلاً) — الجلسة
 *      وحدها تُرفض ولا يُكتب شيء، ويصل المالك بريد بكل إضافة ولو أطفأ كل شيء.
 *   2. الحساب الجديد لا يصير افتراضياً قبل توثيق مدير بصلاحية vendors.review،
 *      والتحويل يذهب إلى الافتراضي وحده.
 *   3. الافتراضي لا يُؤرشف، والمؤرشف لا يعود افتراضياً، والسقف والتكرار محروسان.
 *   4. العزل: الموظّف والعميل والمتجر الآخر لا يلمسون الحسابات.
 *   5. التفضيلات: الفئة المطفأة تصل داخل الموقع وحده، والمفتاح المجهول يُرفض.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { hashPassword } from '../identity/public';
import { NotificationsService } from '../notifications/public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let notifications: NotificationsService;
let dbUp = false;

const SUFFIX = `bank${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();
const totpNow = (secret: string) => generateSync({ strategy: 'totp', secret, crypto: totpCrypto, base32: totpBase32 });

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token?: string, body?: unknown): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  });
}

/** آيبان سعودي صحيح المجموع من 20 رقماً عشوائياً — ISO 13616 */
function iban(): string {
  const bban = Array.from(randomBytes(20), (b) => String(b % 10)).join('');
  const numeric = `${bban}2810` + '00'; // S=28 A=10 ثم 00 مكان الخانتين
  let r = 0;
  for (const d of numeric) r = (r * 10 + Number(d)) % 97;
  return `SA${String(98 - r).padStart(2, '0')}${bban}`;
}

const uniquePhone = () => `+9665${randomBytes(4).readUInt32BE(0).toString().padStart(10, '0').slice(-8)}`;

async function login(email: string, secret?: string): Promise<string> {
  const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD, ...(secret ? { totp: totpNow(secret) } : {}) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().tokens.accessToken as string;
}

async function makeUser(tag: string, role: 'customer' | 'vendor_owner' | 'vendor_staff' | 'admin', extra: Record<string, unknown> = {}) {
  const email = `${tag}.${SUFFIX}@basta.test`;
  const u = await prisma.user.create({
    data: { email, fullName: `مستخدم ${tag}`, phone: uniquePhone(), passwordHash: await hashPassword(PASSWORD), roles: { create: { role } }, ...extra },
  });
  return { userId: u.id, email };
}

async function makeVendor(tag: string, opts: { totpSecret?: string } = {}) {
  const owner = await makeUser(tag, 'vendor_owner', opts.totpSecret ? { totpSecretEnc: opts.totpSecret, totpEnabledAt: new Date() } : {});
  const v = await prisma.vendor.create({
    data: {
      ownerUserId: owner.userId, slug: `${tag}-${SUFFIX}`, nameAr: `متجر ${tag}`, status: 'approved', approvedAt: new Date(),
      settlementCurrency: 'SAR', country: 'SA',
      bankAccounts: { create: { holderName: `متجر ${tag}`, iban: iban(), bankName: 'البنك الأهلي', isDefault: true, verifiedAt: new Date() } },
    },
  });
  return { ...owner, vendorId: v.id, token: await login(owner.email, opts.totpSecret) };
}

const account = (extra: Record<string, unknown> = {}) => ({ holderName: 'متجر الاختبار', iban: iban(), bankName: 'مصرف الراجحي', password: PASSWORD, ...extra });

let owner: Awaited<ReturnType<typeof makeVendor>>;
let other: Awaited<ReturnType<typeof makeVendor>>;
let staffToken = '';
let customerToken = '';
let reviewer = { userId: '', token: '' };
let contentAdmin = { userId: '', token: '' };

async function makeAdmin(tag: string, permissions: string[]) {
  const secret = generateSecret();
  const u = await makeUser(tag, 'admin', {
    totpSecretEnc: secret, totpEnabledAt: new Date(), permissions: { create: permissions.map((permission) => ({ permission })) },
  });
  return { userId: u.userId, token: await login(u.email, secret) };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات الحسابات البنكية متخطّاة.\n');
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  notifications = app.get(NotificationsService);
  await notifications.ensureDefaults();

  owner = await makeVendor('owner');
  other = await makeVendor('other');
  const staff = await makeUser('staff', 'vendor_staff');
  staffToken = await login(staff.email);
  const customer = await makeUser('buyer', 'customer');
  customerToken = await login(customer.email);
  reviewer = await makeAdmin('reviewer', ['vendors.review']);
  contentAdmin = await makeAdmin('content', ['content.manage']);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const liveAccounts = (vendorId: string) => prisma.vendorBankAccount.findMany({ where: { vendorId, archivedAt: null } });
const queued = (userId: string, code: string) =>
  prisma.notification.findMany({ where: { userId, templateCode: code }, select: { channel: true, payloadJson: true } });

describe('VD-20 · إضافة حساب بنكي', () => {
  it('الجلسة وحدها لا تكفي: بلا كلمة مرور 400، وبكلمة خاطئة 403 — ولا يُكتب حساب', async () => {
    if (!dbUp) return;
    const { password: _omit, ...noPassword } = account();
    expect((await call('POST', '/vendor/bank-accounts', owner.token, noPassword)).statusCode).toBe(400);
    const wrong = await call('POST', '/vendor/bank-accounts', owner.token, account({ password: 'ليست-كلمة-المرور' }));
    expect(wrong.statusCode, wrong.body).toBe(403);
    expect(await liveAccounts(owner.vendorId)).toHaveLength(1);
  });

  it('بكلمة المرور يُضاف غير موثَّق ولا افتراضي، بسطر تدقيق وبريد للمالك ولو أطفأ كل الفئات', async () => {
    if (!dbUp) return;
    const off = Object.fromEntries(['orders', 'products', 'stock', 'returns', 'payouts', 'messages'].map((k) => [k, false]));
    expect((await call('PUT', '/me/notifications/prefs', owner.token, { prefs: off })).statusCode).toBe(200);

    const body = account();
    const res = await call('POST', '/vendor/bank-accounts', owner.token, body);
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json();
    expect(created).toMatchObject({ verified: false, isDefault: false, ibanTail: body.iban.slice(-4) });
    // الآيبان لا يعود كاملاً للبائع
    expect(JSON.stringify(created)).not.toContain(body.iban);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'vendor.bank_account_add', entityId: created.id } });
    expect(audit?.actorUserId).toBe(owner.userId);
    const alerts = await queued(owner.userId, 'bank_account_added');
    expect(alerts.map((a) => a.channel).sort()).toEqual(['email', 'in_app']);

    await call('PUT', '/me/notifications/prefs', owner.token, { prefs: Object.fromEntries(Object.keys(off).map((k) => [k, true])) });
  });

  it('الآيبان الخاطئ والمكرّر يُرفضان قبل أي كتابة', async () => {
    if (!dbUp) return;
    const bad = await call('POST', '/vendor/bank-accounts', owner.token, account({ iban: 'SA0000000000000000000000' }));
    expect(bad.statusCode).toBe(400);
    const existing = (await liveAccounts(owner.vendorId))[0]!.iban;
    const dup = await call('POST', '/vendor/bank-accounts', owner.token, account({ iban: existing }));
    expect(dup.statusCode, dup.body).toBe(409);
  });

  it('السقف خمسة حسابات حيّة — والإضافات المتزامنة لا تتجاوزه', async () => {
    if (!dbUp) return;
    const before = (await liveAccounts(owner.vendorId)).length;
    const results = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/vendor/bank-accounts', owner.token, account())));
    const ok = results.filter((r) => r.statusCode === 201).length;
    expect(ok).toBe(5 - before);
    expect(await liveAccounts(owner.vendorId)).toHaveLength(5);
  });

  it('التحقق بخطوتين مفعَّل: كلمة المرور وحدها 403، ومعها رمز التطبيق تنجح', async () => {
    if (!dbUp) return;
    const secret = generateSecret();
    const guarded = await makeVendor('guarded', { totpSecret: secret });
    await prisma.user.update({ where: { id: guarded.userId }, data: { totpLastStep: null } });
    const alone = await call('POST', '/vendor/bank-accounts', guarded.token, account());
    expect(alone.statusCode, alone.body).toBe(403);
    const withCode = await call('POST', '/vendor/bank-accounts', guarded.token, account({ code: totpNow(secret) }));
    expect(withCode.statusCode, withCode.body).toBe(201);
  });
});

describe('VD-20 · الافتراضي والتوثيق والأرشفة', () => {
  it('غير الموثَّق لا يصير افتراضياً، والتحويل يبقى إلى الافتراضي', async () => {
    if (!dbUp) return;
    const pending = (await liveAccounts(owner.vendorId)).find((b) => !b.verifiedAt)!;
    const res = await call('POST', `/vendor/bank-accounts/${pending.id}/default`, owner.token);
    expect(res.statusCode, res.body).toBe(409);
    const defaults = await prisma.vendorBankAccount.findMany({ where: { vendorId: owner.vendorId, isDefault: true, archivedAt: null } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.verifiedAt).not.toBeNull();
  });

  it('التوثيق لمن يملك vendors.review وحده، مرة واحدة، ويُبلَّغ المالك', async () => {
    if (!dbUp) return;
    const pending = (await liveAccounts(owner.vendorId)).find((b) => !b.verifiedAt)!;
    const url = `/admin/vendors/${owner.vendorId}/bank-accounts/${pending.id}/verify`;
    expect((await call('POST', url, contentAdmin.token)).statusCode).toBe(403);
    expect((await call('POST', url, owner.token)).statusCode).toBe(403);
    // معرّف متجر آخر في المسار لا يوثّق حساب هذا المتجر
    expect((await call('POST', `/admin/vendors/${other.vendorId}/bank-accounts/${pending.id}/verify`, reviewer.token)).statusCode).toBe(404);

    const list = await call('GET', `/admin/vendors/${owner.vendorId}/bank-accounts`, reviewer.token);
    expect(list.json().items.find((b: { id: string }) => b.id === pending.id).iban).toBe(pending.iban);

    expect((await call('POST', url, reviewer.token)).statusCode).toBe(204);
    expect((await call('POST', url, reviewer.token)).statusCode).toBe(409);
    const row = await prisma.vendorBankAccount.findUniqueOrThrow({ where: { id: pending.id } });
    expect(row.verifiedBy).toBe(reviewer.userId);
    expect((await queued(owner.userId, 'bank_account_verified')).length).toBeGreaterThan(0);
  });

  it('الموثَّق يصير افتراضياً ويبقى افتراضي واحد — والتبديل المتزامن لا يصنع اثنين', async () => {
    if (!dbUp) return;
    const verified = (await liveAccounts(owner.vendorId)).filter((b) => b.verifiedAt && !b.isDefault);
    const target = verified[0]!;
    const res = await call('POST', `/vendor/bank-accounts/${target.id}/default`, owner.token);
    expect(res.statusCode, res.body).toBe(200);
    const defaults = await prisma.vendorBankAccount.findMany({ where: { vendorId: owner.vendorId, isDefault: true, archivedAt: null } });
    expect(defaults.map((d) => d.id)).toEqual([target.id]);

    // كل الموثَّقين دفعة واحدة: الفهرس الجزئي الفريد يحرس «افتراضي واحد» ولو تسابقت المعاملات
    const all = (await liveAccounts(owner.vendorId)).filter((b) => b.verifiedAt);
    await Promise.all(all.map((b) => call('POST', `/vendor/bank-accounts/${b.id}/default`, owner.token)));
    expect(await prisma.vendorBankAccount.count({ where: { vendorId: owner.vendorId, isDefault: true, archivedAt: null } })).toBe(1);
  });

  it('الافتراضي لا يُؤرشف، وغيره يُؤرشف فيختفي ولا يعود افتراضياً', async () => {
    if (!dbUp) return;
    const accounts = await liveAccounts(owner.vendorId);
    const def = accounts.find((b) => b.isDefault)!;
    const spare = accounts.find((b) => !b.isDefault)!;
    expect((await call('DELETE', `/vendor/bank-accounts/${def.id}`, owner.token)).statusCode).toBe(409);
    const res = await call('DELETE', `/vendor/bank-accounts/${spare.id}`, owner.token);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items.some((b: { id: string }) => b.id === spare.id)).toBe(false);
    expect((await prisma.vendorBankAccount.findUniqueOrThrow({ where: { id: spare.id } })).archivedAt).not.toBeNull();
    expect((await call('POST', `/vendor/bank-accounts/${spare.id}/default`, owner.token)).statusCode).toBe(404);
  });

  it('العزل: الموظّف والعميل 403، والمتجر الآخر لا يرى الحساب ولا يلمسه (404)', async () => {
    if (!dbUp) return;
    const mine = (await liveAccounts(owner.vendorId)).find((b) => !b.isDefault) ?? (await liveAccounts(owner.vendorId))[0]!;
    expect((await call('GET', '/vendor/bank-accounts', staffToken)).statusCode).toBe(403);
    expect((await call('GET', '/vendor/bank-accounts', customerToken)).statusCode).toBe(403);
    const theirs = await call('GET', '/vendor/bank-accounts', other.token);
    expect(theirs.json().items.some((b: { id: string }) => b.id === mine.id)).toBe(false);
    expect((await call('POST', `/vendor/bank-accounts/${mine.id}/default`, other.token)).statusCode).toBe(404);
    expect((await call('DELETE', `/vendor/bank-accounts/${mine.id}`, other.token)).statusCode).toBe(404);
  });
});

describe('المتجر المعتمد لا يمرّ من مسار التسجيل، والسحب إلى الموثَّق وحده', () => {
  /** ملف PDF صغير في multipart — كما ترسله صفحة الوثائق */
  function upload(url: string, token: string): Promise<Res> {
    const boundary = `----basta${Date.now()}`;
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cr.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
  }

  it('الاسم والرابط والوثائق والآيبان مثبّتة بعد الاعتماد — ولا يُمسّ شيء', async () => {
    if (!dbUp) return;
    const v = await makeVendor('frozen');
    await prisma.vendorDocument.create({
      data: { vendorId: v.vendorId, type: 'commercial_register', fileKey: `${v.vendorId}/cr/original`, mimeType: 'application/pdf', sizeBytes: 10, status: 'accepted' },
    });
    const before = await prisma.vendor.findUniqueOrThrow({ where: { id: v.vendorId } });
    const [bankBefore] = await liveAccounts(v.vendorId);

    const rename = await app.inject({
      method: 'PATCH', url: '/api/v1/vendor/onboarding/shop',
      headers: { authorization: `Bearer ${v.token}` }, payload: { nameAr: 'اسم آخر تماماً', slug: `stolen-${SUFFIX}` },
    });
    expect(rename.statusCode, rename.body).toBe(409);
    expect(rename.json().message).toMatch(/معتمد/);

    const bank = await call('PUT', '/vendor/onboarding/bank', v.token, { holderName: 'المهاجم', iban: iban(), bankName: 'بنك المهاجم' });
    expect(bank.statusCode, bank.body).toBe(409);

    const doc = await upload('/vendor/onboarding/documents/commercial_register', v.token);
    expect(doc.statusCode, doc.body).toBe(409);

    const after = await prisma.vendor.findUniqueOrThrow({ where: { id: v.vendorId } });
    expect(after.nameAr).toBe(before.nameAr);
    expect(after.slug).toBe(before.slug);
    const accounts = await liveAccounts(v.vendorId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.iban).toBe(bankBefore!.iban);
    expect(accounts[0]!.verifiedAt).not.toBeNull();
    const docs = await prisma.vendorDocument.findMany({ where: { vendorId: v.vendorId } });
    expect(docs.map((d) => [d.fileKey, d.status])).toEqual([[`${v.vendorId}/cr/original`, 'accepted']]);

    // الوصف والسياسات محتوى حيّ — تبقى متاحة
    const profile = await app.inject({
      method: 'PATCH', url: '/api/v1/vendor/onboarding/profile',
      headers: { authorization: `Bearer ${v.token}` }, payload: { descriptionAr: 'وصف جديد للمتجر' },
    });
    expect(profile.statusCode, profile.body).toBe(200);
  });

  it('السحب: الافتراضي غير الموثَّق يُرفض، والمتجر الموقوف لا يسحب', async () => {
    if (!dbUp) return;
    const v = await makeVendor('payout');
    const payout = () => call('POST', '/vendor/finance/payouts', v.token, { currency: 'SAR', amountMinorUnits: '100' });

    // آيبان كُتب فوق الافتراضي من المسار القديم: بقي افتراضياً بلا توثيق
    await prisma.vendorBankAccount.updateMany({ where: { vendorId: v.vendorId, isDefault: true }, data: { iban: iban(), verifiedAt: null } });
    const unverified = await payout();
    expect(unverified.statusCode, unverified.body).toBe(409);
    expect(unverified.json().message).toMatch(/لم يوثّقه/);

    await prisma.vendorBankAccount.updateMany({ where: { vendorId: v.vendorId, isDefault: true }, data: { verifiedAt: new Date() } });
    await prisma.vendor.update({ where: { id: v.vendorId }, data: { status: 'suspended' } });
    const suspended = await payout();
    expect(suspended.statusCode, suspended.body).toBe(409);
    expect(suspended.json().message).toMatch(/موقوف/);

    expect(await prisma.payoutRequest.count({ where: { vendorId: v.vendorId } })).toBe(0);
  });
});

describe('VD-20 · تفضيلات الإشعار', () => {
  it('الفئة المطفأة تصل داخل الموقع وحده، والمشغَّلة بكل قنواتها', async () => {
    if (!dbUp) return;
    const put = await call('PUT', '/me/notifications/prefs', other.token, { prefs: { stock: false } });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().items.find((i: { key: string }) => i.key === 'stock').email).toBe(false);
    expect(put.json().items.find((i: { key: string }) => i.key === 'orders').email).toBe(true);

    await notifications.enqueueVendor({ code: 'low_stock', vendorId: other.vendorId, vars: { items: 'قطعة', link: '/vendor/inventory' } });
    expect((await queued(other.userId, 'low_stock')).map((n) => n.channel)).toEqual(['in_app']);

    await notifications.enqueueVendor({ code: 'vendor_new_order', vendorId: other.vendorId, vars: { order_number: 'X-1', amount: '1', deadline_hours: '48', link: '/vendor/orders' } });
    expect((await queued(other.userId, 'vendor_new_order')).length).toBeGreaterThan(1);
  });

  it('التحديث جزئي لا يمحو ما قبله، والمفتاح المجهول والقيمة غير المنطقية تُرفضان', async () => {
    if (!dbUp) return;
    await call('PUT', '/me/notifications/prefs', other.token, { prefs: { payouts: false } });
    const got = await call('GET', '/me/notifications/prefs', other.token);
    const email = Object.fromEntries(got.json().items.map((i: { key: string; email: boolean }) => [i.key, i.email]));
    expect(email).toMatchObject({ stock: false, payouts: false, orders: true });

    expect((await call('PUT', '/me/notifications/prefs', other.token, { prefs: { security: false } })).statusCode).toBe(400);
    expect((await call('PUT', '/me/notifications/prefs', other.token, { prefs: { orders: 'no' } })).statusCode).toBe(400);
  });
});
