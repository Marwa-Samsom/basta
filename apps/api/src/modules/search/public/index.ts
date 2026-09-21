/**
 * الواجهة العامة لوحدة البحث — ADR-002 و ADR-014.
 *
 * الوحدة تعيد **معرّفات** لا منتجات: الفهرس مشتقّ وقاعدة البيانات مصدر
 * الحقيقة، فالكتالوج يسأل «من المرشّحون؟» ثم يقرأ تفاصيلهم بنفسه.
 */
export { SearchModule } from '../search.module';
export { SearchService, type SearchResult } from '../application/search.service';
export {
  MAX_PAGE_SIZE,
  type SearchDocument,
  type SearchInput,
  type SortKey,
} from '../domain/search-query';
