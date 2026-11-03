/**
 * بوابة المرحلة 06 — البندان الأول والثاني، عبر الواجهة البرمجية الحيّة.
 *
 * 1. بائع يكمل الرحلة من التسجيل إلى نشر أول منتج بلا تدخّل يدوي إلا الاعتماد.
 * 2. بائع معلَّق لا يبيع: لا ينشر، ولا تظهر منتجاته المنشورة سابقاً.
 *
 * التطبيق يُقلع بتهيئة الخادم نفسها (configureApp)، فالطلبات تمرّ بالحارس
 * والتحقق ومرشّح الأخطاء كما تمرّ طلبات بائع حقيقي.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { StorefrontService } from '../catalog/public';
import { hashPassword } from '../identity/public';
import { SearchService } from '../search/public';
import { DOCUMENT_TYPES } from './domain/onboarding';
import { DOCUMENTS_ROOT } from './infrastructure/document-storage';
import { VendorOnboardingService } from './application/vendor-onboarding.service';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;

const SUFFIX = `vd${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const IBAN = 'JO94CBJO0010000000000131000302';

let sellerToken = '';
let sellerUserId = '';
let adminToken = '';
let vendorId = '';
let createdVendorIds: string[] = [];

const api = (url: string, token?: string) => ({
  url: `/api/v1${url}`,
  ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
});

/** طلب multipart بملف واحد — كما ترسله الشاشة من المتصفّح */
function multipart(
  fileName: string,
  content: Buffer,
  type = 'application/pdf',
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----basta${randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const pdf = (label: string): Buffer =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(label.padEnd(64, ' '))]);

/**
 * الإداري يدخل بتحقق ثنائي فعليّ لا بتخطّيه: 2FA إلزامي على الإدارة (SRS A-07)
 * ورمز الدخول بلا تحقق «محدود» لا يفتح مساراً إدارياً. الاختبار يسلك الطريق
 * نفسه الذي يسلكه مراجع حقيقي — ولذلك يثبت أن الطريق سالك.
 */
const totpCrypto = new NobleCryptoPlugin();
const totpBase32 = new ScureBase32Plugin();
let adminTotpSecret = '';

async function registerUser(email: string, roles: ('customer' | 'admin')[]): Promise<string> {
  const isAdmin = roles.includes('admin');
  if (isAdmin) adminTotpSecret = generateSecret();
  const user = await prisma.user.create({
    data: {
      email,
      fullName: 'مستخدم اختبار',
      passwordHash: await hashPassword(PASSWORD),
      roles: { create: roles.map((role) => ({ role })) },
      ...(isAdmin
        ? {
            permissions: { create: [{ permission: 'vendors.review' }, { permission: 'catalog.manage' }] },
            totpSecretEnc: adminTotpSecret,
            totpEnabledAt: new Date(),
          }
        : {}),
    },
  });
  return user.id;
}

const totpCode = (): string =>
  generateSync({ strategy: 'totp', secret: adminTotpSecret, crypto: totpCrypto, base32: totpBase32 });

async function login(email: string, totp?: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    ...api('/auth/login'),
    payload: { email, password: PASSWORD, ...(totp ? { totp } : {}) },
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().requiresTotpSetup).toBe(false);
  return res.json().tokens.accessToken;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    console.warn('\n⚠ لا قاعدة بيانات — اختبارات تأهيل البائع الحيّة متخطّاة.\n');
    return;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  sellerUserId = await registerUser(`seller.${SUFFIX}@basta.test`, ['customer']);
  sellerToken = await login(`seller.${SUFFIX}@basta.test`);

  await registerUser(`admin.${SUFFIX}@basta.test`, ['admin']);
  adminToken = await login(`admin.${SUFFIX}@basta.test`, totpCode());
}, 60_000);

afterAll(async () => {
  for (const id of createdVendorIds) {
    await rm(`${DOCUMENTS_ROOT}/${id}`, { recursive: true, force: true }).catch(() => undefined);
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('بوابة 06 · البند الأول — الرحلة كاملة بلا تدخّل يدوي', () => {
  it('VD-01: عميل يسجّل متجراً فيصير بائعاً بطلب واحد', async () => {
    if (!dbUp) return;
    const res = await app.inject({
      method: 'POST',
      ...api('/vendor/onboarding/apply', sellerToken),
      payload: {
        nameAr: 'دار القطن',
        nameEn: `Dar AlQutn ${SUFFIX}`,
        country: 'JO',
        businessType: 'company',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const view = res.json().vendor;
    // الرمز القديم صدر لعميل بلا متجر: الرحلة تكمل بالرمز الجديد لا بخروج وعودة
    expect(res.json().tokens.accessToken).toBeTruthy();
    // ورمز التحديث الجديد كوكي HttpOnly كما في الدخول — لا في الجسم
    expect(res.json().tokens).not.toHaveProperty('refreshToken');
    expect(String(res.headers['set-cookie'])).toMatch(/^basta_rt=[\w-]+;.*HttpOnly/);
    sellerToken = res.json().tokens.accessToken;
    vendorId = view.id;
    createdVendorIds.push(vendorId);

    expect(view.status).toBe('pending');
    expect(view.slug).toBe(`dar-alqutn-${SUFFIX}`);
    // العملة تُقترح من البلد ولا تُترك فارغة — ADR-013. لكنها اقتراح لا اختيار:
    // الإرسال ممنوع حتى يختارها البائع صراحةً (VD-04)
    expect(view.settlementCurrency).toBe('JOD');
    expect(view.settlementCurrencyLocked).toBe(false);
    expect(view.settlementCurrencyChosen).toBe(false);
    // العملة، وأربع وثائق، والحساب البنكي
    expect(view.blockers).toHaveLength(6);
    expect(view.blockers[0].code).toBe('currency_unchosen');
    expect(view.canSubmit).toBe(false);

    const roles = await prisma.userRole.findMany({ where: { userId: sellerUserId } });
    expect(roles.map((r) => r.role)).toContain('vendor_owner');
  });

  it('VD-04: العملة تتغيّر في التأهيل ما دام لا شيء مسعَّراً بها — ADR-013', async () => {
    if (!dbUp) return;
    const put = (payload: object) => app.inject({ method: 'PUT', ...api('/vendor/onboarding/settlement-currency', sellerToken), payload });
    const sar = await put({ currency: 'SAR' });
    expect(sar.statusCode, sar.body).toBe(200);
    expect(sar.json().settlementCurrency).toBe('SAR');
    // الاختيار يرفع مانع العملة — ما بقي الوثائق والحساب
    expect(sar.json().settlementCurrencyChosen).toBe(true);
    expect(sar.json().blockers.map((b: { code: string }) => b.code)).not.toContain('currency_unchosen');
    expect((await put({ currency: 'JOD' })).statusCode).toBe(200);

    // سعر شحن مكتوب بالدينار: تغيير العملة يغيّر معناه — يُمنع
    const zone = await prisma.shippingZone.create({
      data: { vendorId, nameAr: 'الأردن', regions: { create: { country: 'JO' } }, rates: { create: { method: 'flat', priceMinorUnits: 2_500n } } },
    });
    const priced = await put({ currency: 'SAR' });
    expect(priced.statusCode).toBe(409);
    expect(priced.json().message).toMatch(/مكتوبة بالعملة الحالية/);
    // والعملة نفسها لا تغيّر معنى شيء
    expect((await put({ currency: 'JOD' })).statusCode).toBe(200);
    await prisma.shippingZone.delete({ where: { id: zone.id } });
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } })).settlementCurrency).toBe('JOD');
  });

  it('VD-01: الرابط المستعمَل يُقترح له بديل لا يُرفض جافاً', async () => {
    if (!dbUp) return;
    const res = await app.inject({
      method: 'GET',
      ...api(`/vendor/onboarding/slug-available?value=Dar AlQutn ${SUFFIX}`, sellerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      slug: `dar-alqutn-${SUFFIX}`,
      available: false,
      suggestion: `dar-alqutn-${SUFFIX}-2`,
    });
  });

  it('VD-01: عملة يختارها عند التسجيل تُحفظ اختياراً — ولا مانع عملة بعدها', async () => {
    if (!dbUp) return;
    const email = `chooser.${SUFFIX}@basta.test`;
    await registerUser(email, ['customer']);
    const token = await login(email);
    const res = await app.inject({
      method: 'POST',
      ...api('/vendor/onboarding/apply', token),
      payload: { nameAr: 'متجر يختار عملته', nameEn: `Chooser ${SUFFIX}`, country: 'QA', settlementCurrency: 'SAR' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const view = res.json().vendor;
    createdVendorIds.push(view.id);
    // قطر بلا عملة تسوية خاصة بها — كانت تُفرض عليه الدولار بصمت
    expect(view.settlementCurrency).toBe('SAR');
    expect(view.settlementCurrencyChosen).toBe(true);
    expect(view.blockers.map((b: { code: string }) => b.code)).not.toContain('currency_unchosen');

    const bad = await app.inject({
      method: 'POST',
      ...api('/vendor/onboarding/apply', await login(`seller.${SUFFIX}@basta.test`)),
      payload: { nameAr: 'عملة مجهولة', nameEn: `Unknown Currency ${SUFFIX}`, country: 'JO', settlementCurrency: 'XYZ' },
    });
    expect(bad.statusCode).toBe(400);
  });

  // موجة «يُؤتمت» الثالثة (2 نوفمبر 2026): لا تعيين جماعي في التسجيل — VON-009
  it('حقل غير معروف في جسم التسجيل يُرفض بلا متجر: الحالة والمالك وقفل العملة لا تُسند من الطلب', async () => {
    if (!dbUp) return;
    const email = `massassign.${SUFFIX}@basta.test`;
    const userId = await registerUser(email, ['customer']);
    const victimId = await registerUser(`massvictim.${SUFFIX}@basta.test`, ['customer']);
    const token = await login(email);
    const body = { nameAr: 'متجر الإسناد الجماعي', nameEn: `Mass Assign ${SUFFIX}`, country: 'JO' };
    const apply = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', ...api('/vendor/onboarding/apply', token), payload });

    for (const extra of [{ status: 'approved' }, { ownerUserId: victimId }, { settlementCurrencyLockedAt: new Date().toISOString() }]) {
      const res = await apply({ ...body, ...extra });
      expect(res.statusCode, `${Object.keys(extra)[0]}: ${res.body}`).toBe(400);
      expect([res.json().message].flat()).toContain('في الطلب حقل غير معروف — حدّث الصفحة وأعد المحاولة.');
    }
    expect(await prisma.vendor.count({ where: { ownerUserId: { in: [userId, victimId] } } })).toBe(0);

    const ok = await apply(body);
    expect(ok.statusCode, ok.body).toBe(201);
    createdVendorIds.push(ok.json().vendor.id);
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: ok.json().vendor.id } });
    expect(vendor.status).toBe('pending');
    expect(vendor.ownerUserId).toBe(userId);
    expect(vendor.settlementCurrencyLockedAt).toBeNull();
  });

  it('اسم المتجر يُحفظ بمسافة واحدة بين كلماته — في التسجيل والتعديل (VON-014، 28 أكتوبر 2026)', async () => {
    if (!dbUp) return;
    // كان القصّ للطرفين وحدهما: «ركن␣␣الصوف» حُفظ بمسافتين لا تراهما الصفحة ويظهران في البريد النصي
    const email = `spaces.${SUFFIX}@basta.test`;
    await registerUser(email, ['customer']);
    const res = await app.inject({
      method: 'POST',
      ...api('/vendor/onboarding/apply', await login(email)),
      payload: { nameAr: '  ركن   الصوف  ', nameEn: ` Wool   Corner ${SUFFIX} `, country: 'JO' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const view = res.json().vendor;
    createdVendorIds.push(view.id);
    expect(view.nameAr).toBe('ركن الصوف');
    expect(view.nameEn).toBe(`Wool Corner ${SUFFIX}`);

    // التعديل بالرمز الجديد الذي يحمل دور البائع
    const shop = await app.inject({
      method: 'PATCH',
      ...api('/vendor/onboarding/shop', res.json().tokens.accessToken),
      payload: { nameAr: 'دار  القطن   والكتان', nameEn: ` Cotton  House ${SUFFIX}` },
    });
    expect(shop.statusCode, shop.body).toBe(200);
    expect(shop.json().nameAr).toBe('دار القطن والكتان');
    expect(shop.json().nameEn).toBe(`Cotton House ${SUFFIX}`);
  });

  it('الاسم الإنجليزي إجباري بحروف إنجليزية: التسجيل بدونه أو بالعربية يُرفض بلا متجر، والتعديل لا يمسحه (3 نوفمبر 2026)', async () => {
    if (!dbUp) return;
    const email = `english.${SUFFIX}@basta.test`;
    const userId = await registerUser(email, ['customer']);
    const token = await login(email);
    const apply = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', ...api('/vendor/onboarding/apply', token), payload });

    for (const [nameEn, message] of [
      [undefined, 'اسم المتجر بالإنجليزية مطلوب.'],
      ['   ', 'اسم المتجر بالإنجليزية مطلوب.'],
      ['ركن الصوف', 'اسم المتجر بالإنجليزية يُكتب بحروف إنجليزية.'],
    ] as const) {
      const res = await apply({ nameAr: 'ركن الصوف', ...(nameEn === undefined ? {} : { nameEn }), country: 'JO' });
      expect(res.statusCode, `${String(nameEn)}: ${res.body}`).toBe(400);
      expect([res.json().message].flat()).toContain(message);
    }
    expect(await prisma.vendor.count({ where: { ownerUserId: userId } })).toBe(0);

    const ok = await apply({ nameAr: 'ركن الصوف', nameEn: `English Only ${SUFFIX}`, country: 'JO' });
    expect(ok.statusCode, ok.body).toBe(201);
    createdVendorIds.push(ok.json().vendor.id);
    const seller = ok.json().tokens.accessToken;

    for (const nameEn of [null, '', 'ركن الصوف']) {
      const shop = await app.inject({ method: 'PATCH', ...api('/vendor/onboarding/shop', seller), payload: { nameEn } });
      expect(shop.statusCode, `${String(nameEn)}: ${shop.body}`).toBe(400);
    }
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: ok.json().vendor.id } });
    expect(vendor.nameEn).toBe(`English Only ${SUFFIX}`);
  });

  it('لا متجرين على حساب واحد', async () => {
    if (!dbUp) return;
    const res = await app.inject({
      method: 'POST',
      ...api('/vendor/onboarding/apply', sellerToken),
      payload: { nameAr: 'متجر ثانٍ', nameEn: `Second Store ${SUFFIX}`, country: 'JO' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('DUPLICATE');
  });

  it('خمسة طلبات «افتح متجراً» متزامنة: متجر واحد، والبقية «لديك متجر مسجَّل بالفعل.» (VON-011)', async () => {
    if (!dbUp) return;
    const email = `racer.${SUFFIX}@basta.test`;
    const userId = await registerUser(email, ['customer']);
    const token = await login(email);
    // كانت تمرّ كلها من سؤال «للحساب متجر؟» قبل أن يُكتب أيّها: ثلاثة متاجر من خمسة طلبات.
    // الخدمة مباشرةً تُبقي الطلبات متداخلة فعلاً (inject يقرّبها من التتالي)، وواحد عبر الواجهة
    const onboarding = app.get(VendorOnboardingService);
    const actor = { userId, roles: ['customer'] as const, permissions: [] };
    const payload = (i: number) => ({ nameAr: `متجر السباق ${i}`, nameEn: `Racer ${i} ${SUFFIX}`, slug: `racer-${i}-${SUFFIX}`.toLowerCase(), country: 'SA', settlementCurrency: 'SAR' });
    const direct = await Promise.allSettled([1, 2, 3, 4].map((i) => onboarding.apply(actor, payload(i))));
    const viaApi = await app.inject({ method: 'POST', ...api('/vendor/onboarding/apply', token), payload: payload(5) });
    const results = [
      ...direct.map((d) => (d.status === 'fulfilled' ? { statusCode: 201, body: '', json: () => ({}) } : { statusCode: (d.reason as { httpStatus?: number }).httpStatus ?? 500, body: String((d.reason as Error).message), json: () => ({ code: (d.reason as { code?: string }).code, message: (d.reason as Error).message }) })),
      viaApi,
    ];
    const won = results.filter((r) => r.statusCode === 201);
    expect(won, results.map((r) => `${r.statusCode} ${r.body.slice(0, 80)}`).join('\n')).toHaveLength(1);
    for (const lost of results.filter((r) => r.statusCode !== 201)) {
      expect(lost.statusCode).toBe(409);
      expect(lost.json()).toMatchObject({ code: 'DUPLICATE', message: 'لديك متجر مسجَّل بالفعل.' });
    }
    const vendors = await prisma.vendor.findMany({ where: { ownerUserId: userId } });
    expect(vendors).toHaveLength(1);
    createdVendorIds.push(vendors[0]!.id);
  });

  it('VD-02: الإرسال قبل اكتمال النواقص مرفوض، والموانع تُعاد مجتمعة', async () => {
    if (!dbUp) return;
    const res = await app.inject({ method: 'POST', ...api('/vendor/onboarding/submit', sellerToken) });
    expect(res.statusCode).toBe(409);
    expect(res.json().details.blockers).toHaveLength(5);
  });

  it('VD-02: ملف ليس PDF ولا صورة يُرفض بمحتواه لا بامتداده', async () => {
    if (!dbUp) return;
    const fake = multipart('hack.pdf', Buffer.from('<?php system($_GET[0]); ?>'));
    const res = await app.inject({
      method: 'POST',
      ...api('/vendor/onboarding/documents/commercial_register', sellerToken),
      headers: {
        authorization: `Bearer ${sellerToken}`,
        ...fake.headers,
      },
      payload: fake.payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/PDF/);
  });

  it('VD-02: رفع الوثائق الأربع والحساب البنكي يُفرغ قائمة الموانع', async () => {
    if (!dbUp) return;
    for (const type of DOCUMENT_TYPES) {
      const file = multipart(`${type}.pdf`, pdf(type));
      const res = await app.inject({
        method: 'POST',
        ...api(`/vendor/onboarding/documents/${type}`, sellerToken),
        headers: { authorization: `Bearer ${sellerToken}`, ...file.headers },
        payload: file.payload,
      });
      expect(res.statusCode, res.body).toBe(201);
    }

    const bad = await app.inject({
      method: 'PUT',
      ...api('/vendor/onboarding/bank', sellerToken),
      payload: { holderName: 'مروة سمسوم', iban: 'JO00WRONG000000000000', bankName: 'البنك العربي' },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PUT',
      ...api('/vendor/onboarding/bank', sellerToken),
      payload: { holderName: 'مروة سمسوم', iban: IBAN, bankName: 'البنك العربي' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().blockers).toHaveLength(0);
    expect(ok.json().canSubmit).toBe(true);
  });

  it('الوثيقة لا تُخدَم برابط عام، وتنزيلها مصادَق', async () => {
    if (!dbUp) return;
    const view = await app.inject({ method: 'GET', ...api('/vendor/onboarding', sellerToken) });
    const doc = view.json().documents[0];
    expect(doc.downloadPath).toMatch(/^\/vendor\/onboarding\/documents\//);

    const anonymous = await app.inject({ method: 'GET', ...api(doc.downloadPath) });
    expect(anonymous.statusCode).toBe(401);

    const owner = await app.inject({ method: 'GET', ...api(doc.downloadPath, sellerToken) });
    expect(owner.statusCode).toBe(200);
    expect(owner.headers['content-type']).toBe('application/pdf');
    expect(owner.headers['content-disposition']).toMatch(/^attachment/);
    expect(owner.headers['x-content-type-options']).toBe('nosniff');
  });

  it('VD-03: الإرسال ينقل الطلب إلى قيد المراجعة ويجمّد التعديل', async () => {
    if (!dbUp) return;
    const res = await app.inject({ method: 'POST', ...api('/vendor/onboarding/submit', sellerToken) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('in_review');
    expect(res.json().submittedAt).not.toBeNull();

    const edit = await app.inject({
      method: 'PATCH',
      ...api('/vendor/onboarding/shop', sellerToken),
      payload: { nameAr: 'اسم جديد أثناء المراجعة' },
    });
    expect(edit.statusCode).toBe(409);
  });

  it('AD-04: الطلب يظهر في طابور المراجعة بالأقدم أولاً', async () => {
    if (!dbUp) return;
    // الطابور صفحات بالأقدم أولاً، وقاعدة التطوير تراكم فيه طلبات التشغيلات السابقة — يُوصل إلى الطلب برابطه
    const res = await app.inject({ method: 'GET', ...api(`/admin/vendors?status=in_review&search=dar-alqutn-${SUFFIX}`, adminToken) });
    expect(res.statusCode, res.body).toBe(200);
    const mine = res.json().items.find((v: { id: string }) => v.id === vendorId);
    expect(mine).toBeDefined();
    expect(mine.documentsTotal).toBe(4);
  });

  // كانت الصفحة أول مئة بالأقدم بلا بحث ولا ما بعدها — متجر بين آلاف لا يُوصل إليه (J-11، 20 أكتوبر 2026)
  it('AD-04/06: البحث بالاسم أو الرابط أو بريد صاحبه داخل الحالة، والصفحة التالية بالإزاحة', async () => {
    if (!dbUp) return;
    const list = (q: string) => app.inject({ method: 'GET', ...api(`/admin/vendors?${q}`, adminToken) });
    for (const term of [`Dar AlQutn ${SUFFIX}`, `dar-alqutn-${SUFFIX}`, `SELLER.${SUFFIX}@basta.test`]) {
      const res = await list(`status=in_review&search=${encodeURIComponent(term)}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().items.map((v: { id: string }) => v.id), term).toEqual([vendorId]);
      expect(res.json().total, term).toBe(1);
    }
    // داخل الحالة المختارة: بانتظار المراجعة لا يظهر في «معتمد»
    expect((await list(`status=approved&search=${encodeURIComponent(`dar-alqutn-${SUFFIX}`)}`)).json().total).toBe(0);

    // الصفحة الثانية تكمل الأولى بلا تكرار، والإجمالي واحد للصفحتين
    const first = (await list('status=in_review&limit=1')).json();
    if (first.total > 1) {
      const second = (await list('status=in_review&limit=1&offset=1')).json();
      expect(second.total).toBe(first.total);
      expect(second.items[0].id).not.toBe(first.items[0].id);
    }
  });

  it('AD-05: الرفض يعيد الطلب قابلاً للإصلاح بسبب يقرأه البائع', async () => {
    if (!dbUp) return;
    const empty = await app.inject({
      method: 'POST',
      ...api(`/admin/vendors/${vendorId}/reject`, adminToken),
      payload: { reason: 'قصير' },
    });
    expect(empty.statusCode).toBe(400);

    const reason = 'صورة السجل التجاري غير واضحة — أعد تصويرها كاملة بإضاءة جيدة.';
    const res = await app.inject({
      method: 'POST',
      ...api(`/admin/vendors/${vendorId}/reject`, adminToken),
      payload: { reason },
    });
    expect(res.statusCode, res.body).toBe(204);

    const view = await app.inject({ method: 'GET', ...api('/vendor/onboarding', sellerToken) });
    expect(view.json().status).toBe('rejected');
    expect(view.json().rejectionReason).toBe(reason);
    // ويستطيع الإصلاح: التعديل مفتوح ثانيةً
    expect(view.json().canSubmit).toBe(true);
  });

  it('البائع يصلح ويرسل ثانيةً، والإدارة تعتمد', async () => {
    if (!dbUp) return;
    const file = multipart('commercial_register.pdf', pdf('نسخة واضحة'));
    const upload = await app.inject({
      method: 'POST',
      ...api('/vendor/onboarding/documents/commercial_register', sellerToken),
      headers: { authorization: `Bearer ${sellerToken}`, ...file.headers },
      payload: file.payload,
    });
    expect(upload.statusCode).toBe(201);

    const resubmit = await app.inject({ method: 'POST', ...api('/vendor/onboarding/submit', sellerToken) });
    expect(resubmit.statusCode, resubmit.body).toBe(200);
    expect(resubmit.json().status).toBe('in_review');
    expect(resubmit.json().rejectionReason).toBeNull();
    // ومن يراجع المتاجر يعرف أنه أعاد الإرسال (19 أكتوبر 2026)
    const reviewer = await prisma.user.findUniqueOrThrow({ where: { email: `admin.${SUFFIX}@basta.test` } });
    const told = await prisma.notification.findFirst({
      where: { userId: reviewer.id, templateCode: 'admin_vendor_submitted', channel: 'in_app', payloadJson: { path: ['link'], equals: `/admin/vendors/${vendorId}` } },
      orderBy: { createdAt: 'desc' },
    });
    expect(told?.payloadJson).toMatchObject({ kind: 'أعاد إرسال طلبه بعد الرفض' });

    const approve = await app.inject({
      method: 'POST',
      ...api(`/admin/vendors/${vendorId}/approve`, adminToken),
    });
    expect(approve.statusCode, approve.body).toBe(204);

    const view = await app.inject({ method: 'GET', ...api('/vendor/onboarding', sellerToken) });
    expect(view.json().status).toBe('approved');
    expect(view.json().approvedAt).not.toBeNull();
    // وثائق بقيت «قيد المراجعة» تُقبل ضمناً بالاعتماد
    const stuck = view.json().documents.filter((d: { status: string }) => d.status === 'pending');
    expect(stuck).toHaveLength(0);
  });

  it('اعتماد ثانٍ على الطلب نفسه يُرفض بلا أثر', async () => {
    if (!dbUp) return;
    const res = await app.inject({
      method: 'POST',
      ...api(`/admin/vendors/${vendorId}/approve`, adminToken),
    });
    expect(res.statusCode).toBe(409);
  });

  it('VD-04: الاعتماد يثبّت العملة ولا رجعة — ADR-013', async () => {
    if (!dbUp) return;
    const put = (payload: object) => app.inject({ method: 'PUT', ...api('/vendor/onboarding/settlement-currency', sellerToken), payload });
    // لم يثبّتها البائع قط (القيمة الافتراضية من البلد)، والاعتماد ثبّتها
    const view = await app.inject({ method: 'GET', ...api('/vendor/onboarding', sellerToken) });
    expect(view.json().settlementCurrencyLocked).toBe(true);
    const after = await put({ currency: 'USD' });
    expect(after.statusCode).toBe(409);
    expect(after.json().message).toMatch(/مثبَّتة/);

    // متجر اعتُمد قبل التثبيت التلقائي ولم يثبّتها: يبيع — فلا تتغيّر أيضاً
    const locked = (await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } })).settlementCurrencyLockedAt;
    await prisma.vendor.update({ where: { id: vendorId }, data: { settlementCurrencyLockedAt: null } });
    const legacy = await put({ currency: 'USD' });
    expect(legacy.statusCode).toBe(409);
    expect(legacy.json().message).toMatch(/قبل إرسال الطلب/);
    await prisma.vendor.update({ where: { id: vendorId }, data: { settlementCurrencyLockedAt: locked } });
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } })).settlementCurrency).toBe('JOD');
  });

  it('VD-05: ملف المتجر يُحفظ بعد الاعتماد', async () => {
    if (!dbUp) return;
    const res = await app.inject({
      method: 'PATCH',
      ...api('/vendor/onboarding/profile', sellerToken),
      payload: {
        descriptionAr: 'أقمشة قطنية من الأردن.',
        shippingPolicyAr: 'الشحن خلال ثلاثة أيام عمل.',
        returnPolicyAr: 'الإرجاع خلال 14 يوماً.',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().descriptionAr).toBe('أقمشة قطنية من الأردن.');
  });

  it('VD-07: البائع المعتمَد ينشر أول منتج — الرحلة اكتملت', async () => {
    if (!dbUp) return;
    // «الخامة» سمة إلزامية على فرع الأزياء — بلا ملئها يرفض النشر، وهذا مقصود
    const material = await prisma.attribute.findFirstOrThrow({ where: { code: 'material' } });
    const create = await app.inject({
      method: 'POST',
      ...api('/vendor/products', sellerToken),
      payload: {
        // المتجر يبدأ بالفئات الثماني المقترحة، ولا منتج بلا فئة
        vendorCategoryId: (await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId }, orderBy: { sort: 'asc' } })).id,
        nameAr: 'قميص قطني',
        nameEn: 'Cotton shirt',
        attributes: [{ attributeId: material.id, text: 'قطن 100%' }],
        variants: [{ sku: `SH-${SUFFIX}`, price: '19.900', stock: 5 }],
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    const productId = create.json().id;

    // الصورة شرط النشر — يرفعها من المحرّر كما يرفعها المتصفّح
    const png = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 140, g: 30, b: 50 } } }).png().toBuffer();
    const photo = multipart('shirt.png', png, 'image/png');
    const uploaded = await app.inject({
      method: 'POST',
      ...api(`/vendor/products/${productId}/images`, sellerToken),
      headers: { authorization: `Bearer ${sellerToken}`, ...photo.headers },
      payload: photo.payload,
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);

    const publish = await app.inject({
      method: 'POST',
      ...api(`/vendor/products/${productId}/publish`, sellerToken),
    });
    expect(publish.statusCode, publish.body).toBe(200);
    // لا مراجعة (15 أكتوبر 2026): المتجر المعتمد ينشر فيظهر منتجه مباشرةً
    expect(publish.json().status).toBe('active');
  });
});

describe('بوابة 06 · البند الثاني — المعلَّق لا يبيع', () => {
  it('التعليق يمنع النشر فوراً', async () => {
    if (!dbUp) return;
    const suspend = await app.inject({
      method: 'POST',
      ...api(`/admin/vendors/${vendorId}/suspend`, adminToken),
      payload: { reason: 'شكاوى متكرّرة على عدم الشحن خلال المدة المعلنة.' },
    });
    expect(suspend.statusCode, suspend.body).toBe(204);

    const material = await prisma.attribute.findFirstOrThrow({ where: { code: 'material' } });
    const create = await app.inject({
      method: 'POST',
      ...api('/vendor/products', sellerToken),
      payload: {
        vendorCategoryId: (await prisma.vendorCategory.findFirstOrThrow({ where: { vendorId }, orderBy: { sort: 'asc' } })).id,
        nameAr: 'قميص آخر',
        attributes: [{ attributeId: material.id, text: 'كتّان' }],
        variants: [{ sku: `SH2-${SUFFIX}`, price: '22.000', stock: 3 }],
      },
    });
    expect(create.statusCode, create.body).toBe(201);

    const publish = await app.inject({
      method: 'POST',
      ...api(`/vendor/products/${create.json().id}/publish`, sellerToken),
    });
    expect(publish.statusCode).toBe(409);
    /**
     * السبب هو التعليق لا نقص في المنتج. بلا هذا التأكيد يمرّ الاختبار
     * على منتج ناقص السمات ويبدو أن التعليق يحرس وهو لم يُستدعَ أصلاً.
     */
    expect(publish.json().details.reasons.join(' ')).toMatch(/المتجر معلَّق/);
  });

  it('التعليق يمنع تعديل بيانات المتجر كذلك', async () => {
    if (!dbUp) return;
    const res = await app.inject({
      method: 'PATCH',
      ...api('/vendor/onboarding/shop', sellerToken),
      payload: { nameAr: 'اسم بعد التعليق' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('رفع التعليق يعيد البيع', async () => {
    if (!dbUp) return;
    const res = await app.inject({
      method: 'POST',
      ...api(`/admin/vendors/${vendorId}/reinstate`, adminToken),
    });
    expect(res.statusCode, res.body).toBe(204);

    const view = await app.inject({ method: 'GET', ...api('/vendor/onboarding', sellerToken) });
    expect(view.json().status).toBe('approved');
  });
});

/**
 * وثيقة تُرفض والطلب قيد المراجعة (ADM-030 و ADM-034، 30 أكتوبر 2026): كانت رسالة المراجع
 * تقول «أُبلغ البائع» ولا يصله شيء، وبطاقته تقول «ارفعها من جديد» وزرّها مقفل، والاعتماد
 * يمرّ فوق الوثيقة المرفوضة فيصير المتجر معتمداً بها.
 */
describe('وثيقة مرفوضة والطلب قيد المراجعة', () => {
  it('البائع يُبلَّغ ويستبدلها وحدها، والاعتماد ممنوع حتى تُقبل', async () => {
    if (!dbUp) return;
    const email = `docs.${SUFFIX}@basta.test`;
    const userId = await registerUser(email, ['customer']);
    const apply = await app.inject({
      method: 'POST',
      ...api('/vendor/onboarding/apply', await login(email)),
      payload: { nameAr: 'دار الوثائق', nameEn: `Docs ${SUFFIX}`, country: 'JO', businessType: 'company' },
    });
    expect(apply.statusCode, apply.body).toBe(201);
    const id: string = apply.json().vendor.id;
    createdVendorIds.push(id);
    const token: string = apply.json().tokens.accessToken;
    const upload = (type: string, label: string) => {
      const file = multipart(`${type}.pdf`, pdf(label));
      return app.inject({
        method: 'POST',
        ...api(`/vendor/onboarding/documents/${type}`, token),
        headers: { authorization: `Bearer ${token}`, ...file.headers },
        payload: file.payload,
      });
    };

    try {
      const currency = await app.inject({ method: 'PUT', ...api('/vendor/onboarding/settlement-currency', token), payload: { currency: 'JOD' } });
      expect(currency.statusCode, currency.body).toBe(200);
      for (const type of DOCUMENT_TYPES) expect((await upload(type, type)).statusCode).toBe(201);
      const bank = await app.inject({
        method: 'PUT',
        ...api('/vendor/onboarding/bank', token),
        payload: { holderName: 'دار الوثائق', iban: IBAN, bankName: 'البنك العربي' },
      });
      expect(bank.statusCode, bank.body).toBe(200);
      const submit = await app.inject({ method: 'POST', ...api('/vendor/onboarding/submit', token) });
      expect(submit.json().status, submit.body).toBe('in_review');

      const taxCard = await prisma.vendorDocument.findUniqueOrThrow({ where: { vendorId_type: { vendorId: id, type: 'tax_card' } } });
      const reason = 'الختم غير ظاهر في الصورة';
      const reject = await app.inject({
        method: 'POST',
        ...api(`/admin/vendors/${id}/documents/${taxCard.id}/decision`, adminToken),
        payload: { accept: false, reason },
      });
      expect(reject.statusCode, reject.body).toBe(204);

      // يصل صاحب المتجر باسم الوثيقة وسببها ورابط صفحتها
      const told = await prisma.notification.findFirst({ where: { userId, templateCode: 'vendor_document_rejected', channel: 'in_app' } });
      expect(told?.payloadJson).toMatchObject({ document: 'الشهادة الضريبية', reason, link: '/vendor/onboarding/documents' });

      // الاعتماد ممنوع باسم الوثيقة، والطلب باقٍ قيد المراجعة والمعلّق معلّق
      const blocked = await app.inject({ method: 'POST', ...api(`/admin/vendors/${id}/approve`, adminToken) });
      expect(blocked.statusCode, blocked.body).toBe(409);
      expect(blocked.json().message).toContain('الشهادة الضريبية');
      const still = await prisma.vendor.findUniqueOrThrow({ where: { id } });
      expect(still.status).toBe('in_review');
      expect(still.settlementCurrencyLockedAt).toBeNull();
      expect(await prisma.vendorDocument.count({ where: { vendorId: id, status: 'pending' } })).toBe(3);

      // غير المرفوضة مقفلة كما كانت، والمرفوضة تُستبدل وحدها فتعود إلى المراجعة
      expect((await upload('national_id', 'بديل')).statusCode).toBe(409);
      const replaced = await upload('tax_card', 'نسخة واضحة');
      expect(replaced.statusCode, replaced.body).toBe(201);
      expect(replaced.json().status).toBe('in_review');
      expect(replaced.json().documents.find((d: { type: string }) => d.type === 'tax_card')).toMatchObject({ status: 'pending', rejectReason: null });

      const approve = await app.inject({ method: 'POST', ...api(`/admin/vendors/${id}/approve`, adminToken) });
      expect(approve.statusCode, approve.body).toBe(204);
    } finally {
      // قاعدة التطوير مشتركة: متجر الاختبار لا يبقى في دليل المتاجر
      await prisma.vendor.update({ where: { id }, data: { status: 'suspended', suspendedAt: new Date() } });
    }
  });
});

describe('عزل البيانات — بائع لا يرى طلب بائع آخر', () => {
  it('بائع آخر لا يصل إلى وثائق غيره', async () => {
    if (!dbUp) return;
    const otherEmail = `other.${SUFFIX}@basta.test`;
    await registerUser(otherEmail, ['customer']);
    const otherToken = await login(otherEmail);

    const apply = await app.inject({
      method: 'POST',
      ...api('/vendor/onboarding/apply', otherToken),
      payload: { nameAr: 'متجر آخر', nameEn: `Other ${SUFFIX}`, country: 'SA' },
    });
    expect(apply.statusCode).toBe(201);
    createdVendorIds.push(apply.json().vendor.id);
    const otherVendorToken = apply.json().tokens.accessToken;

    const view = await app.inject({ method: 'GET', ...api('/vendor/onboarding', sellerToken) });
    const doc = view.json().documents[0];

    const res = await app.inject({ method: 'GET', ...api(doc.downloadPath, otherVendorToken) });
    expect(res.statusCode).toBe(404);
  });

  it('حساب عميل لا يدخل طابور المراجعة الإداري', async () => {
    if (!dbUp) return;
    const res = await app.inject({ method: 'GET', ...api('/admin/vendors', sellerToken) });
    expect(res.statusCode).toBe(403);
  });
});

describe('التعليق يصل إلى البحث — الاقتراحات والفهرس', () => {
  it('منتجات المعلَّق تخرج من الاقتراحات ومن الفهرس فوراً، وتعود برفع التعليق', async () => {
    if (!dbUp) return;
    const search = app.get(SearchService);
    if (!(await search.stats()).up) return console.warn('⚠ محرّك البحث غير شغّال — اختبار الاقتراحات متخطّى.');
    const storefront = app.get(StorefrontService);

    // منتج منشور للمتجر باسم لا يشاركه فيه شيء في الفهرس
    const word = `zq${SUFFIX}`.toLowerCase();
    const product = await prisma.product.findFirstOrThrow({ where: { vendorId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    await prisma.product.update({ where: { id: product.id }, data: { nameAr: `قميص ${word}`, status: 'active', publishedAt: new Date() } });
    await storefront.syncIndex([product.id]);
    expect(await search.idle()).toBe(true);

    const suggest = async () => (await app.inject({ method: 'GET', url: `/api/v1/storefront/suggest?q=${word}` })).json().suggestions as string[];
    const indexed = async () => (await search.search({ q: word, page: 1, pageSize: 10 }))?.ids ?? [];
    expect(await suggest()).toContain(`قميص ${word}`);
    expect(await indexed()).toContain(product.id);

    const suspend = await app.inject({
      method: 'POST',
      ...api(`/admin/vendors/${vendorId}/suspend`, adminToken),
      payload: { reason: 'شكاوى متكرّرة على عدم الشحن خلال المدة المعلنة.' },
    });
    expect(suspend.statusCode, suspend.body).toBe(204);
    expect(await search.idle()).toBe(true);
    expect(await suggest()).not.toContain(`قميص ${word}`);
    expect(await indexed()).not.toContain(product.id);

    const reinstate = await app.inject({ method: 'POST', ...api(`/admin/vendors/${vendorId}/reinstate`, adminToken) });
    expect(reinstate.statusCode, reinstate.body).toBe(204);
    expect(await search.idle()).toBe(true);
    expect(await suggest()).toContain(`قميص ${word}`);
    expect(await indexed()).toContain(product.id);
  });

  it('فهرس متأخّر لا يُظهر في الاقتراحات منتجاً لم يعد مرئياً', async () => {
    if (!dbUp) return;
    const search = app.get(SearchService);
    if (!(await search.stats()).up) return;
    const storefront = app.get(StorefrontService);
    const word = `zr${SUFFIX}`.toLowerCase();
    const product = await prisma.product.findFirstOrThrow({ where: { vendorId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    await prisma.product.update({ where: { id: product.id }, data: { nameAr: `قميص ${word}`, status: 'active', publishedAt: new Date() } });
    await storefront.syncIndex([product.id]);
    expect(await search.idle()).toBe(true);

    // المنتج يختفي في القاعدة دون أن يسمع الفهرس (محرّك نائم وقت التغيير، أو كتابة مباشرة)
    await prisma.product.update({ where: { id: product.id }, data: { status: 'draft' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/storefront/suggest?q=${word}` });
    expect(res.json().suggestions).not.toContain(`قميص ${word}`);
  });
});
