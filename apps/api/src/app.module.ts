import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthController } from './common/health.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/public';
import { CartModule } from './modules/cart/public';
import { CheckoutModule } from './modules/checkout/public';
import { InventoryModule } from './modules/inventory/public';
import { VendorsModule } from './modules/vendors/public';
import { OrdersModule } from './modules/orders/public';
import { ShippingModule } from './modules/shipping/public';
import { AftersalesModule } from './modules/aftersales/public';
import { FinanceModule } from './modules/finance/public';
import { NotificationsModule } from './modules/notifications/public';
import { AdminModule } from './modules/admin/public';

/**
 * Modular Monolith — ADR-002.
 * كل وحدة تصدّر واجهتها من public/ فقط، وفحص CI يرفض ما عداه.
 *
 * ترتيب الإضافة يتبع مراحل الخطة:
 *   04 identity ✓ · 05 catalog ✓, inventory ✓, vendors (القراءة وحدها) · 06 vendors
 *   ‏currency مؤجَّلة: الكتالوج يحتاج خانات العملة فقط وتأتي من نواة money،
 *   وأسعار الصرف تُلقط لأول مرة عند الطلب في المرحلة 08
 *   07 search, cart · 08 pricing, checkout, orders, payments
 *   09 shipping, aftersales · 10 finance · 11 notifications, admin
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    /**
     * تحديد المعدّل — SRS C-01: عشر محاولات من عنوان واحد خلال 15 دقيقة.
     * التخزين في الذاكرة الآن لغياب Redis على هذا الجهاز؛ يُستبدل بمخزن
     * Redis عند توفّره، وإلا لم يسرِ الحدّ عبر أكثر من نسخة من التطبيق.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: 900_000, limit: 100 }]),
    PrismaModule,
    IdentityModule,
    VendorsModule,
    InventoryModule,
    CatalogModule,
    CartModule,
    CheckoutModule,
    OrdersModule,
    ShippingModule,
    AftersalesModule,
    FinanceModule,
    NotificationsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
