import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Public } from '../../../common/security/decorators';
import { StorefrontService } from '../application/storefront.service';

export class StorefrontQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  /** فئة من فئات المتجر — مع vendorId */
  @IsOptional()
  @IsUUID('4', { message: 'الفئة غير صالحة.' })
  storeCategory?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  /** معرّفات قيم سمات مفصولة بفواصل — لون أحمر + مقاس M */
  /** معرّفات قيم سمات مفصولة بفاصلة — غير المعرّف كان يصل Prisma فيرمي 500 */
  @IsOptional()
  @MaxLength(500)
  @Matches(/^[0-9a-f-]{36}(,[0-9a-f-]{36})*,?$/i, { message: 'قيم التصفية معرّفات مفصولة بفاصلة.' })
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

export class ShopQueryDto {
  /** فئة من فئات المتجر — أزرار التصفية في صفحته */
  @IsOptional()
  @IsUUID('4', { message: 'الفئة غير صالحة.' })
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class ShopsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
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
  constructor(private readonly storefront: StorefrontService) {}

  @Public()
  @Get('storefront/products')
  @ApiOperation({ summary: 'تصفّح وبحث بأوجه تصفية — ST-03 و ST-04' })
  async list(@Query() query: StorefrontQueryDto) {
    return this.storefront.list({
      ...(query.q ? { q: query.q } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.storeCategory ? { storeCategoryId: query.storeCategory } : {}),
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
    return { suggestions: await this.storefront.suggest(q ?? '') };
  }

  @Public()
  @Get('storefront/products/:slug')
  @ApiOperation({ summary: 'صفحة المنتج — ST-07' })
  detail(@Param('slug') slug: string) {
    return this.storefront.bySlug(slug);
  }

  @Public()
  @Get('storefront/shops')
  @ApiOperation({ summary: 'دليل المتاجر المعتمدة التي لها منتج معروض' })
  shops(@Query() query: ShopsQueryDto) {
    return this.storefront.shops({ q: query.q, page: query.page });
  }

  @Public()
  @Get('storefront/shops/:slug')
  @ApiOperation({ summary: 'صفحة البائع بفئاته — ST-11، والمعلَّق يُعرض بحالته لا 404' })
  shop(@Param('slug') slug: string, @Query() query: ShopQueryDto) {
    return this.storefront.shopBySlug(slug, { category: query.category, page: query.page });
  }

  @Public()
  @Get('storefront/sitemap')
  @ApiOperation({ summary: 'روابط ما يُفهرس — لخريطة الموقع' })
  sitemap() {
    return this.storefront.sitemap();
  }

  @Public()
  @Get('storefront/featured')
  @ApiOperation({ summary: 'المنتجات المميّزة في الرئيسية بترتيب الإدارة — AD-19' })
  featured() {
    return this.storefront.featured();
  }
}
