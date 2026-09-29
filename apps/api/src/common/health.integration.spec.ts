import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { PrismaService } from './prisma/prisma.service';

/**
 * فحص الجاهزية يقول الحقيقة برمزه: الموازن والمراقبة لا يقرآن الجسم. قاعدة ساقطة أو
 * معلّقة = 503 فيخرج الخادم من الدوران؛ وفحص الحياة لا يسأل القاعدة أصلاً.
 */
let app: NestFastifyApplication;
let prisma: PrismaService;
let dbUp = false;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  prisma = app.get(PrismaService);
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    // بلا قاعدة يُختبر الساقط وحده
  }
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await app?.close();
});

const health = (path = '') => app.inject({ method: 'GET', url: `/api/v1/health${path}` });

describe('فحص الصحة', () => {
  it('القاعدة تجيب: 200 و ok', async () => {
    if (!dbUp) return;
    const res = await health();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('القاعدة ساقطة: 503 و degraded — لا 200', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));
    const res = await health();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', database: 'down' });
  });

  it('القاعدة معلّقة: 503 خلال ثانيتين لا انتظار بلا نهاية', async () => {
    vi.spyOn(prisma, '$queryRaw').mockReturnValueOnce(new Promise(() => undefined) as never);
    const started = Date.now();
    const res = await health();
    expect(res.statusCode).toBe(503);
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it('فحص الحياة لا يسأل القاعدة: 200 ولو سقطت', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('down'));
    const res = await health('/live');
    expect(res.statusCode).toBe(200);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
