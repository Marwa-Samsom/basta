import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * توثيق الـ API (Swagger على /api/docs). خريطة كل المسارات هدية للمهاجم في الإنتاج — تُفتح
 * هناك صراحةً فقط بـ API_DOCS=true (المرحلة 12). خارج main.ts ليُختبر: الإقلاع نفسه لا يُستورد
 * في اختبار لأنه يقلع عند استيراده (SYS-058، 2 نوفمبر 2026).
 */
export const apiDocsEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env['NODE_ENV'] !== 'production' || env['API_DOCS'] === 'true';

/** يركّب التوثيق إن سُمح به، ويعيد هل رُكّب — سطر الإقلاع يذكره */
export function setupApiDocs(app: INestApplication, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!apiDocsEnabled(env)) return false;
  const config = new DocumentBuilder()
    .setTitle('Basta API')
    .setDescription('سوق إلكتروني متعدد البائعين')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  return true;
}

export const bootLine = (port: number, docs: boolean): string =>
  `API على http://localhost:${port}/api/v1${docs ? ' · التوثيق /api/docs' : ''}`;
