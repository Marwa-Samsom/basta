import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthController } from './common/health.controller';

/**
 * Modular Monolith — ADR-002.
 *
 * الوحدات تُسجَّل هنا، وكل واحدة تصدّر واجهتها العامة من public/ فقط.
 * فحص eslint-plugin-boundaries في CI يرفض أي استيراد يتجاوز الحدّ.
 *
 * ترتيب الإضافة يتبع مراحل الخطة:
 *   04 identity · 05 currency, catalog, inventory · 06 vendors
 *   07 search, cart · 08 pricing, checkout, orders, payments
 *   09 shipping, aftersales · 10 finance · 11 notifications, admin
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [HealthController],
})
export class AppModule {}
