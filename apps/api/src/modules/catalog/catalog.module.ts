import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/public';
import { InventoryModule } from '../inventory/public';
import { NotificationsModule } from '../notifications/public';
import { PricingModule } from '../pricing/public';
import { SearchModule } from '../search/public';
import { VendorsModule } from '../vendors/public';
import {
  AdminCatalogController,
  AttributesController,
  VendorCatalogController,
} from './api/catalog.controllers';
import { StorefrontController } from './api/storefront.controller';
import { AttributeService } from './application/attribute.service';
import { LowStockNotifier } from './application/low-stock-notifier';
import { ProductImageService } from './application/product-image.service';
import { ProductImportService } from './application/product-import.service';
import { ProductService } from './application/product.service';
import { StorefrontService } from './application/storefront.service';
import { VendorCategoryService } from './application/vendor-category.service';
import { LocalImageStorage } from './infrastructure/product-images';
import { ProductImageGate } from './infrastructure/product-image-gate';

@Module({
  imports: [IdentityModule, InventoryModule, VendorsModule, SearchModule, NotificationsModule, PricingModule],
  controllers: [
    AttributesController,
    AdminCatalogController,
    VendorCatalogController,
    StorefrontController,
  ],
  providers: [
    ProductImageGate,
    AttributeService,
    VendorCategoryService,
    ProductService,
    ProductImageService,
    ProductImportService,
    StorefrontService,
    LocalImageStorage,
    LowStockNotifier,
  ],
  exports: [AttributeService, ProductService, StorefrontService, ProductImageGate],
})
export class CatalogModule {}
