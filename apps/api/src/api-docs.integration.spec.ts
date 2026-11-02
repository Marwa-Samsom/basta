/**
 * توثيق الـ API مغلق في الإنتاج إلا بـ API_DOCS=true — SYS-058، موجة «يُؤتمت» الثالثة (2 نوفمبر 2026).
 * التطبيق نفسه (AppModule و configureApp) يُبنى في كل بيئة كما يبنيه main.ts، ثم يُطلب /api/docs.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { apiDocsEnabled, bootLine, setupApiDocs } from './api-docs';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function docsStatus(env: NodeJS.ProcessEnv): Promise<{ docs: boolean; status: number; json: number; title: string | null }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  try {
    await configureApp(app);
    const docs = setupApiDocs(app, env);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const page = await app.inject({ method: 'GET', url: '/api/docs' });
    // الصفحة تجلب خريطة المسارات من ملفها — العنوان هناك لا في HTML
    const map = await app.inject({ method: 'GET', url: '/api/docs-json' });
    const title = map.statusCode === 200 ? ((map.json() as { info?: { title?: string } }).info?.title ?? null) : null;
    return { docs, status: page.statusCode, json: map.statusCode, title };
  } finally {
    await app.close();
  }
}

describe('توثيق الـ API بحسب البيئة (SYS-058)', () => {
  it('القرار: يُفتح خارج الإنتاج، ويُغلق فيه إلا بـ API_DOCS=true بالضبط', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(apiDocsEnabled({})).toBe(true);
    expect(apiDocsEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(apiDocsEnabled({ NODE_ENV: 'production', API_DOCS: 'false' })).toBe(false);
    expect(apiDocsEnabled({ NODE_ENV: 'production', API_DOCS: '1' })).toBe(false);
    expect(apiDocsEnabled({ NODE_ENV: 'production', API_DOCS: 'true' })).toBe(true);
  });

  it('التطوير: صفحة «Basta API»، وسطر الإقلاع يذكر التوثيق', async () => {
    const dev = await docsStatus({ NODE_ENV: 'development' });
    expect(dev.docs).toBe(true);
    expect(dev.status).toBe(200);
    expect(dev.title).toBe('Basta API');
    expect(bootLine(4000, dev.docs)).toBe('API على http://localhost:4000/api/v1 · التوثيق /api/docs');
  }, 60_000);

  it('الإنتاج: 404 وسطر الإقلاع بلا ذكر التوثيق — ومع API_DOCS=true يُفتح صراحةً', async () => {
    const prod = await docsStatus({ NODE_ENV: 'production' });
    expect(prod.docs).toBe(false);
    expect(prod.status).toBe(404);
    expect(prod.json).toBe(404);
    expect(prod.title).toBeNull();
    expect(bootLine(4000, prod.docs)).toBe('API على http://localhost:4000/api/v1');

    const opened = await docsStatus({ NODE_ENV: 'production', API_DOCS: 'true' });
    expect(opened.docs).toBe(true);
    expect(opened.status).toBe(200);
    expect(opened.title).toBe('Basta API');
  }, 60_000);
});
