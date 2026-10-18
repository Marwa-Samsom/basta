import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/public';
import { PricingModule } from '../pricing/public';
import { MyWishlistController } from './api/wishlist.controller';
import { WishlistService } from './application/wishlist.service';

/**
 * المفضّلة — ST-23. تقرأ المنتجات من القاعدة المشتركة بقاعدة رؤية المتجر
 * (كما تفعل السلة والتسعير)، والمخزون عبر واجهة وحدته العامة.
 */
@Module({
  imports: [InventoryModule, PricingModule],
  controllers: [MyWishlistController],
  providers: [WishlistService],
  exports: [WishlistService],
})
export class WishlistModule {}
