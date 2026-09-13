import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/public';
import { VendorsModule } from '../vendors/public';
import {
  AdminCatalogController,
  CategoriesController,
  VendorCatalogController,
} from './api/catalog.controllers';
import { CategoryService } from './application/category.service';
import { ProductImageService } from './application/product-image.service';
import { ProductImportService } from './application/product-import.service';
import { ProductService } from './application/product.service';
import { LocalImageStorage } from './infrastructure/product-images';

@Module({
  imports: [InventoryModule, VendorsModule],
  controllers: [CategoriesController, AdminCatalogController, VendorCatalogController],
  providers: [
    CategoryService,
    ProductService,
    ProductImageService,
    ProductImportService,
    LocalImageStorage,
  ],
  exports: [CategoryService, ProductService],
})
export class CatalogModule {}
