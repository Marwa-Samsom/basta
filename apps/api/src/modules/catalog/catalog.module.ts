import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/public';
import { NotificationsModule } from '../notifications/public';
import { SearchModule } from '../search/public';
import { VendorsModule } from '../vendors/public';
import {
  AdminCatalogController,
  CategoriesController,
  VendorCatalogController,
} from './api/catalog.controllers';
import { StorefrontController } from './api/storefront.controller';
import { CategoryService } from './application/category.service';
import { LowStockNotifier } from './application/low-stock-notifier';
import { ProductImageService } from './application/product-image.service';
import { ProductImportService } from './application/product-import.service';
import { ProductService } from './application/product.service';
import { StorefrontService } from './application/storefront.service';
import { LocalImageStorage } from './infrastructure/product-images';

@Module({
  imports: [InventoryModule, VendorsModule, SearchModule, NotificationsModule],
  controllers: [
    CategoriesController,
    AdminCatalogController,
    VendorCatalogController,
    StorefrontController,
  ],
  providers: [
    CategoryService,
    ProductService,
    ProductImageService,
    ProductImportService,
    StorefrontService,
    LocalImageStorage,
    LowStockNotifier,
  ],
  exports: [CategoryService, ProductService, StorefrontService],
})
export class CatalogModule {}
