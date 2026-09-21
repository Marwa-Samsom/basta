import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Public } from '../../../common/security/decorators';
import { SearchService } from '../../search/public';
import { CategoryService } from '../application/category.service';
import { StorefrontService } from '../application/storefront.service';

export class StorefrontQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /** رابط الفئة (slug) — يشمل كل الفروع تحته */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  /** معرّفات قيم سمات مفصولة بفواصل — لون أحمر + مقاس M */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  attrs?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  inStock?: boolean;

  @IsOptional()
  @IsIn(['relevance', 'price_asc', 'price_desc', 'newest'])
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  pageSize?: number;
}

/**
 * المتجر — مسارات عامة بلا مصادقة (المرحلة 07).
 *
 * كلها `@Public` صراحةً: الأصل في المشروع أن المسار محميّ، والاستثناء يُكتب.
 * وكلها تمرّ بقاعدة الرؤية الواحدة في `StorefrontService` — لا استعلام هنا.
 */
@ApiTags('storefront')
@Controller()
export class StorefrontController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly categories: CategoryService,
    private readonly search: SearchService,
  ) {}

  @Public()
  @Get('storefront/products')
  @ApiOperation({ summary: 'تصفّح وبحث بأوجه تصفية — ST-03 و ST-04' })
  async list(@Query() query: StorefrontQueryDto) {
    // فئة مجهولة تُترجم إلى مسار لا يطابق شيئاً: نتيجة فارغة لا 400
    const categoryPath = query.category
      ? ((await this.storefront.categoryPathOf(query.category)) ?? '/__none__/')
      : undefined;
    return this.storefront.list({
      ...(query.q ? { q: query.q } : {}),
      ...(categoryPath ? { categoryPath } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.attrs ? { attributeValueIds: query.attrs.split(',').filter(Boolean) } : {}),
      ...(query.minPrice !== undefined ? { minPriceMinor: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { maxPriceMinor: query.maxPrice } : {}),
      ...(query.inStock ? { inStockOnly: true } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
      ...(query.page ? { page: query.page } : {}),
      ...(query.pageSize ? { pageSize: query.pageSize } : {}),
    });
  }

  @Public()
  @Get('storefront/suggest')
  @ApiOperation({ summary: 'اقتراحات أثناء الكتابة — ST-06' })
  async suggest(@Query('q') q: string) {
    return { suggestions: await this.search.suggest(q ?? '') };
  }

  @Public()
  @Get('storefront/products/:slug')
  @ApiOperation({ summary: 'صفحة المنتج — ST-07' })
  detail(@Param('slug') slug: string) {
    return this.storefront.bySlug(slug);
  }

  @Public()
  @Get('storefront/shops/:slug')
  @ApiOperation({ summary: 'صفحة البائع — ST-11، والمعلَّق يُعرض بحالته لا 404' })
  shop(@Param('slug') slug: string) {
    return this.storefront.shopBySlug(slug);
  }

  @Public()
  @Get('storefront/featured')
  @ApiOperation({ summary: 'المنتجات المميّزة في الرئيسية بترتيب الإدارة — AD-19' })
  featured() {
    return this.storefront.featured();
  }

  @Public()
  @Get('storefront/categories')
  @ApiOperation({ summary: 'شجرة الفئات — ST-02' })
  tree() {
    return this.categories.tree();
  }
}
