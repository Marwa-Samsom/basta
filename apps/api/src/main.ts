import 'reflect-metadata';
import { initSentry } from './common/observability/sentry';
import { loadEnv } from './common/config/env';

// قبل أي استيراد يُنشئ خدمة: الأدوات التي ترقب الأخطاء يجب أن تسبقها
// يرفض الإقلاع بمتغيّر ناقص — عطل صاخب أهون من ثغرة صامتة
loadEnv();
initSentry();

import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp, createHttpAdapter } from './app.setup';

async function bootstrap() {
  const { trustProxy } = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createHttpAdapter(trustProxy));
  if (trustProxy === false && process.env['NODE_ENV'] === 'production') {
    // لا يُرفض: خادم مكشوف مباشرةً بلا وسيط صحيح هكذا. لكن خلف وسيط يشترك كل الزوار في عنوانه
    Logger.warn(
      'TRUST_PROXY غير مضبوط: كل عنوان يُقرأ من الاتصال نفسه. إن كان أمام الخادم وسيط عكسي فكل الزوار عنوان واحد لحدّ المعدّل والتدقيق — اضبطه بعدد الوسطاء أو عناوينهم.',
      'Bootstrap',
    );
  }

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
  // التطوير على «::» — IPv4 و IPv6 معاً: الواجهة تنادي الـ API باسم المضيف الذي
  // فُتحت به (localhost أو 127.0.0.1) ليكون كوكي الجلسة من «الموقع» نفسه، و
  // localhost يُترجم ::1 أولاً. الإنتاج باقٍ على IPv4: حاوية بلا IPv6 ترفض «::»
  await app.listen({ port, host: process.env['NODE_ENV'] === 'production' ? '0.0.0.0' : '::' });
  Logger.log(`API على http://localhost:${port}/api/v1${docs ? ' · التوثيق /api/docs' : ''}`, 'Bootstrap');
}

void bootstrap();
