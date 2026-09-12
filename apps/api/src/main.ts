import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({ origin: process.env.NEXT_PUBLIC_SITE_URL ?? true, credentials: true });

  // OpenAPI موثّق من اليوم الأول — ADR-002:
  // هو ما يجعل تطبيقات الموبايل لاحقاً عملية توصيل لا إعادة بناء
  const config = new DocumentBuilder()
    .setTitle('Basta API')
    .setDescription('سوق إلكتروني متعدد البائعين')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: '0.0.0.0' });
  Logger.log(`API على http://localhost:${port}/api/v1 · التوثيق /api/docs`, 'Bootstrap');
}

void bootstrap();
