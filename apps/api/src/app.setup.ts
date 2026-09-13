import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdirSync } from 'node:fs';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IMAGE_MAX_BYTES, UPLOADS_ROOT, UPLOADS_URL_PREFIX } from './modules/catalog/public';

/**
 * تهيئة التطبيق المشتركة بين الإقلاع واختبارات الواجهة البرمجية.
 * اختبار يُقلع تطبيقاً مهيّأً بطريقة أخرى يثبت سلوك تطبيق آخر.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: process.env.NEXT_PUBLIC_SITE_URL ?? true, credentials: true });

  // الحد العام أعلى حدود المسارات؛ كل مسار يضيّقه لنفسه (الاستيراد 5 م.ب)
  await app.register(multipart as never, {
    limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 10, fieldSize: 16 * 1024 },
  });

  // صور المنتجات محتوى عام لا يمرّ بحارس المصادقة — كصفحة المنتج نفسها
  mkdirSync(UPLOADS_ROOT, { recursive: true });
  await app.register(fastifyStatic as never, {
    root: UPLOADS_ROOT,
    prefix: UPLOADS_URL_PREFIX,
    decorateReply: false,
    index: false,
    dotfiles: 'deny',
  });
}
