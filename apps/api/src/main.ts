import 'reflect-metadata';
import { initSentry } from './common/observability/sentry';
import { loadEnv } from './common/config/env';

// قبل أي استيراد يُنشئ خدمة: الأدوات التي ترقب الأخطاء يجب أن تسبقها
// يرفض الإقلاع بمتغيّر ناقص — عطل صاخب أهون من ثغرة صامتة
loadEnv();
initSentry();

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  await configureApp(app);

  const config = new DocumentBuilder()
    .setTitle('Basta API')
    .setDescription('سوق إلكتروني متعدد البائعين')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  // خريطة كل المسارات هدية للمهاجم في الإنتاج — تُفتح هناك صراحةً فقط (المرحلة 12)
  const docs = process.env['NODE_ENV'] !== 'production' || process.env['API_DOCS'] === 'true';
  if (docs) SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: '0.0.0.0' });
  Logger.log(`API على http://localhost:${port}/api/v1${docs ? ' · التوثيق /api/docs' : ''}`, 'Bootstrap');
}

void bootstrap();
