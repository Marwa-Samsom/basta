import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BastaThrottlerGuard, THROTTLE } from './common/security/throttle';
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
import { AddressesModule } from './modules/addresses/public';
import { MessagingModule } from './modules/messaging/public';
import { WishlistModule } from './modules/wishlist/public';

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
     * تحديد المعدّل — حدّ عام واسع، وحدّ تخمين صارم على مسارات الدخول وحدها
     * (SRS C-01). التفصيل في common/security/throttle.ts. التخزين في الذاكرة:
     * نسخة واحدة من الخادم محلياً؛ تعدّد النسخ يحتاج مخزناً مشتركاً.
     */
    ThrottlerModule.forRoot([
      { name: 'default', ttl: THROTTLE.defaultTtl, limit: THROTTLE.defaultLimit },
      { name: 'auth', ttl: THROTTLE.authTtl, limit: THROTTLE.authLimit },
    ]),
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
    AddressesModule,
    MessagingModule,
    WishlistModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: BastaThrottlerGuard }],
})
export class AppModule {}
