import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';

/**
 * زرّ اللغة من جهة الخادم (2 نوفمبر 2026): `accept-language: en` من المتصفّح أو `?lang=en` من
 * صفحات الخادم — الرسائل والمبالغ المنسّقة بالإنجليزية. وبلا شيء من ذلك كل شيء عربي كما كان.
 */
const prisma = new PrismaClient();
let app: NestFastifyApplication;
let dbUp = false;
const ARABIC = /[؀-ۿ]/;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    return;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers });

describe('لغة الردّ تتبع زرّ اللغة', () => {
  it('خطأ المجال: العربية بلا رأس، والإنجليزية بـ accept-language أو ?lang=en — والرمز واحد', async () => {
    if (!dbUp) return;
    const ar = await get('/storefront/products/no-such-product-xyz');
    expect(ar.statusCode).toBe(404);
    expect(ar.json().message).toMatch(ARABIC);

    for (const en of [await get('/storefront/products/no-such-product-xyz', { 'accept-language': 'en' }), await get('/storefront/products/no-such-product-xyz?lang=en')]) {
      expect(en.statusCode).toBe(404);
      expect(en.json().code).toBe(ar.json().code);
      expect(en.json().message).not.toMatch(ARABIC);
    }
  });

  it('رسائل التحقق بأسماء حقولها بالإنجليزية، ولا messageEn يخرج للعميل', async () => {
    if (!dbUp) return;
    const body = { email: 'not-an-email', password: 'short', fullName: 'س' };
    const ar = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: body });
    expect(ar.statusCode).toBe(400);
    expect((ar.json().message as string[]).every((m) => ARABIC.test(m))).toBe(true);
    expect(ar.json().messageEn).toBeUndefined();

    const en = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: body, headers: { 'accept-language': 'en' } });
    expect(en.statusCode).toBe(400);
    const messages = en.json().message as string[];
    expect(messages.length).toBe((ar.json().message as string[]).length);
    expect(messages.some((m) => ARABIC.test(m))).toBe(false);
    expect(messages).toContain('Invalid email format.');
    expect(en.json().messageEn).toBeUndefined();
  });

  it('المبالغ المنسّقة في بطاقات المتجر: «د.أ.» بالعربية و«JOD» بالإنجليزية للمبلغ نفسه', async () => {
    if (!dbUp) return;
    const ar = (await get('/storefront/products?pageSize=5&currency=JOD')).json();
    const en = (await get('/storefront/products?pageSize=5&currency=JOD&lang=en')).json();
    // المنتج نفسه بمعرّفه: ملفات أخرى تنشئ منتجات بين الطلبين فيتغيّر أوّل القائمة
    type Item = { id: string; nameAr: string; price: { minorUnits: string; formatted: string }; vendor: { nameAr: string } };
    const a = (ar.items as Item[]).find((x) => (en.items as Item[]).some((y) => y.id === x.id));
    if (!a) return;
    const e = (en.items as Item[]).find((y) => y.id === a.id)!;
    expect(e.price.minorUnits).toBe(a.price.minorUnits);
    expect(a.price.formatted).toMatch(ARABIC);
    expect(e.price.formatted).toMatch(/JOD/);
    expect(e.price.formatted).not.toMatch(ARABIC);
    // اسم المنتج والمتجر بيانات البائع — لا تُمسّ
    expect(e.nameAr).toBe(a.nameAr);
    expect(e.vendor.nameAr).toBe(a.vendor.nameAr);
  });
});
