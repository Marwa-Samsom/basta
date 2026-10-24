/**
 * مدخل خاطئ خطأ المستخدم لا خلل الخادم: 400 أو 404 أو 409، لا 500.
 *
 * كان معرّف غير صالح أو NaN في الاستعلام، أو شهر 13، يصل Prisma فيرمي — فيرى
 * المستخدم «خلل غير متوقّع» ويُسجَّل خطأ خادم لما هو طلب مردود. هذا يمرّ على كل
 * مسار GET في التطبيق، بكل معامل مسار وبكل معامل استعلام خاطئ منفرداً، مديراً
 * بكل الصلاحيات وبائعاً ومشترياً — وأي 500 يُسقطه باسم مساره ومعامله.
 */
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { hashPassword } from './modules/identity/public';
import { PERMISSION_CODES } from './modules/admin/public';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;
const SUFFIX = `ih${Date.now()}`;
const PASSWORD = 'كلمة-مرور-اختبار-طويلة';
const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();
const tokens: Record<string, string> = {};
const routes: { method: string; path: string }[] = [];

/** كل معامل استعلام تقرؤه المسارات، بقيمة خاطئة — واحد في كل طلب */
const BAD_QUERY: Record<string, string> = {
  page: 'NaN',
  pageSize: 'NaN',
  limit: 'NaN',
  offset: 'abc',
  vendorId: 'not-a-uuid',
  category: 'not-a-uuid',
  storeCategory: 'not-a-uuid',
  brandId: 'not-a-uuid',
  productId: 'not-a-uuid',
  entityId: 'not-a-uuid',
  actor: 'not-a-uuid',
  cursor: 'not-a-uuid',
  attrs: 'bad,worse',
  from: '2026-13-01',
  to: '2026-02-30',
  month: '2026-13',
  minPrice: 'abc',
  maxPrice: 'NaN',
  currency: 'ZZZ',
  status: 'no_such_status',
  sort: 'sideways',
  placement: 'nowhere',
  q: '%00',
};

async function login(email: string, secret?: string): Promise<string> {
  const totp = secret ? generateSync({ strategy: 'totp', secret, crypto, base32 }) : undefined;
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD, ...(totp ? { totp } : {}) } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().tokens.accessToken as string;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const join = (...parts: (string | undefined)[]) => parts.flatMap((p) => (p ?? '').split('/')).filter(Boolean).join('/');
  for (const wrapper of moduleRef.get(DiscoveryService).getControllers()) {
    const cls = wrapper.metatype as (new (...a: never[]) => object) | undefined;
    if (!cls) continue;
    const base = Reflect.getMetadata(PATH_METADATA, cls) as string | string[] | undefined;
    for (const name of Object.getOwnPropertyNames(cls.prototype)) {
      const handler = (cls.prototype as Record<string, unknown>)[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      if (path === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      if (method !== 'GET') continue;
      routes.push({ method, path: join(Array.isArray(base) ? base[0] : base, Array.isArray(path) ? path[0] : path) });
    }
  }

  const secret = generateSecret();
  const admin = `admin.${SUFFIX}@basta.test`;
  await prisma.user.create({
    data: {
      email: admin, fullName: 'مدير المدخلات', passwordHash: await hashPassword(PASSWORD), totpSecretEnc: secret, totpEnabledAt: new Date(),
      roles: { create: { role: 'admin' } }, permissions: { create: PERMISSION_CODES.map((permission) => ({ permission })) },
    },
  });
  tokens['admin'] = await login(admin, secret);

  const seller = `vendor.${SUFFIX}@basta.test`;
  const owner = await prisma.user.create({ data: { email: seller, fullName: 'بائع المدخلات', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'vendor_owner' } } } });
  await prisma.vendor.create({ data: { ownerUserId: owner.id, slug: `in-${SUFFIX}`, nameAr: 'متجر المدخلات', status: 'approved', approvedAt: new Date(), settlementCurrency: 'JOD', country: 'JO' } });
  tokens['vendor'] = await login(seller);

  const buyer = `buyer.${SUFFIX}@basta.test`;
  await prisma.user.create({ data: { email: buyer, fullName: 'مشترٍ المدخلات', passwordHash: await hashPassword(PASSWORD), roles: { create: { role: 'customer' } } } });
  tokens['customer'] = await login(buyer);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('مدخل خاطئ لا يصير 500', () => {
  it('كل مسار GET بكل معامل خاطئ: 4xx لا 500', async () => {
    if (!dbUp) return;
    expect(routes.length).toBeGreaterThan(80);
    const failures: string[] = [];
    for (const [who, token] of Object.entries(tokens)) {
      for (const r of routes) {
        // /health/boom يُسقط الطلب عمداً (محجوب في الإنتاج) — ليس مدخلاً
        if (r.path === 'health/boom') continue;
        const path = `/api/v1/${r.path.replace(/:[A-Za-z]+/g, 'not-a-uuid')}`;
        for (const [key, value] of [['', ''], ...Object.entries(BAD_QUERY)] as [string, string][]) {
          const url = key ? `${path}?${key}=${encodeURIComponent(value)}` : path;
          const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
          if (res.statusCode >= 500) failures.push(`${who} GET ${url} → ${res.statusCode}`);
        }
      }
    }
    expect([...new Set(failures)], failures.slice(0, 40).join('\n')).toEqual([]);
  }, 300_000);

  it('رقم هاتف مستعمل في التسجيل: 409 برسالة لا 500', async () => {
    if (!dbUp) return;
    const phone = `+9627${Date.now().toString().slice(-8)}`;
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: `p1.${SUFFIX}@basta.test`, password: PASSWORD, fullName: 'الأول', phone } });
    expect(first.statusCode, first.body).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: `p2.${SUFFIX}@basta.test`, password: PASSWORD, fullName: 'الثاني', phone } });
    expect(second.statusCode, second.body).toBe(409);
  });
});

/**
 * جسم لا يُقرأ يُرفض في Fastify قبل المسار (SYS-062). كان يصل بنصّ Fastify الإنجليزي
 * «Body is not valid JSON…» بلا رمز — حتى لجسم صحيح فيه مفتاح محظور.
 */
describe('جسم لا يُقرأ: رفض برمز ورسالة عربية', () => {
  const send = (url: string, payload: string, contentType = 'application/json') =>
    app.inject({ method: 'POST', url, headers: { 'content-type': contentType }, payload });

  it('__proto__ و constructor.prototype و JSON مكسور وجسم فارغ: 400، ولا شيء تلوّث', async () => {
    if (!dbUp) return;
    for (const [url, payload] of [
      ['/api/v1/auth/login', '{"email":"nobody@basta.test","password":"x","__proto__":{"isAdmin":true}}'],
      ['/api/v1/cart', '{"constructor":{"prototype":{"polluted":true}}}'],
      ['/api/v1/auth/login', '{"email":'],
      ['/api/v1/auth/login', ''],
    ] as const) {
      const res = await send(url, payload);
      expect(res.statusCode, `${url} ${payload}`).toBe(400);
      expect(res.json()).toEqual({ code: 'INVALID_INPUT', message: expect.stringMatching(/^تعذّرت قراءة الطلب/) });
    }
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('أكبر من الحدّ: 413، وصيغة غير مدعومة: 415 — بالعربية', async () => {
    if (!dbUp) return;
    const large = await send('/api/v1/auth/login', JSON.stringify({ email: 'x'.repeat(1_100_000) }));
    expect(large.statusCode).toBe(413);
    expect(large.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: expect.stringMatching(/^الطلب أكبر من الحدّ/) });
    const xml = await send('/api/v1/auth/login', '<login/>', 'application/xml');
    expect(xml.statusCode).toBe(415);
    expect(xml.json()).toEqual({ code: 'UNSUPPORTED_MEDIA_TYPE', message: expect.stringMatching(/^صيغة الطلب غير مدعومة/) });
  });
});
