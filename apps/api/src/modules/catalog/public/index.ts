/**
 * الواجهة العامة لوحدة الكتالوج — ADR-002.
 * الكتالوج يعتمد على المخزون لا العكس: المخزون لا يعرف المنتجات.
 */
export { CatalogModule } from '../catalog.module';
export { CategoryService, type CategoryView, type EffectiveAttribute } from '../application/category.service';
export {
  ProductService,
  PublishBlockedError,
  type CreateProductInput,
  type UpdateProductInput,
} from '../application/product.service';
export { ProductImportService, type ImportReport } from '../application/product-import.service';
export type { PriceView, ProductDetailView, VariantView } from '../application/views';
export {
  IMAGE_MAX_BYTES,
  UPLOADS_ROOT,
  UPLOADS_URL_PREFIX,
} from '../infrastructure/product-images';
export { IMPORT_COLUMNS, IMPORT_MAX_ROWS } from '../domain/import-plan';

export {
  StorefrontService,
  type StorefrontProductCard,
  type StorefrontListResult,
} from '../application/storefront.service';
