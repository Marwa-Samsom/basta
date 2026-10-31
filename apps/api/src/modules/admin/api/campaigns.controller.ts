import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { Actor } from '../../../common/security/actor';
import { CurrentActor, Public, RequirePermission, Roles } from '../../../common/security/decorators';
import { CAMPAIGN_MAX_PRODUCTS, CAMPAIGN_PLACEMENTS, CampaignsService, type CampaignInput } from '../application/campaigns.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('المورد غير موجود.') });

export class CreateCampaignDto implements CampaignInput {
  @IsString()
  @Length(3, 80, { message: 'اسم الحملة من 3 أحرف إلى 80.' })
  nameAr!: string;

  @IsIn(CAMPAIGN_PLACEMENTS, { message: 'موضع غير معروف.' })
  placement!: string;

  @IsDateString({}, { message: 'البداية تاريخ صالح.' })
  startsAt!: string;

  @IsDateString({}, { message: 'النهاية تاريخ صالح.' })
  endsAt!: string;

  @IsOptional()
  @IsUUID('all', { message: 'الكوبون غير صالح.' })
  couponId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCampaignDto implements CampaignInput {
  @IsOptional()
  @IsString()
  @Length(3, 80, { message: 'اسم الحملة من 3 أحرف إلى 80.' })
  nameAr?: string;

  @IsOptional()
  @IsIn(CAMPAIGN_PLACEMENTS, { message: 'موضع غير معروف.' })
  placement?: string;

  @IsOptional()
  @IsDateString({}, { message: 'البداية تاريخ صالح.' })
  startsAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'النهاية تاريخ صالح.' })
  endsAt?: string;

  @IsOptional()
  @IsUUID('all', { message: 'الكوبون غير صالح.' })
  couponId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CampaignProductsDto {
  @IsArray()
  @ArrayMaxSize(CAMPAIGN_MAX_PRODUCTS, { message: `الحملة حتى ${CAMPAIGN_MAX_PRODUCTS} منتجاً.` })
  @IsUUID('all', { each: true, message: 'معرّف منتج غير صالح.' })
  productIds!: string[];
}

/** AD-17 — الحملات والمنتجات المميّزة. لا حذف: الحملة تُوقف (انظر الخدمة) */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/campaigns')
export class AdminCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission('content.manage')
  list() {
    return this.campaigns.list();
  }

  @Get('product-search')
  @RequirePermission('content.manage')
  @ApiOperation({ summary: 'منتجات منشورة للإضافة إلى حملة — بالاسم أو المتجر' })
  searchProducts(@Query('q') q?: string) {
    return this.campaigns.searchProducts(typeof q === 'string' ? q.slice(0, 100) : undefined);
  }

  @Get('coupon-options')
  @RequirePermission('content.manage')
  @ApiOperation({ summary: 'كوبونات مفعّلة غير منتهية لإعلانها مع حملة — بحث برمزها وأوّل عشرين' })
  couponOptions(@Query('q') q?: string) {
    const term = typeof q === 'string' ? q.trim().slice(0, 40) : '';
    return this.campaigns.couponOptions(term || undefined);
  }

  @Get(':id')
  @RequirePermission('content.manage')
  get(@Param('id', uuidParam) id: string) {
    return this.campaigns.get(id);
  }

  @Post()
  @RequirePermission('content.manage')
  create(@CurrentActor() a: Actor, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(a.userId, dto);
  }

  @Patch(':id')
  @RequirePermission('content.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  update(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaigns.update(a.userId, id, dto);
  }

  @Put(':id/products')
  @RequirePermission('content.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  setProducts(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: CampaignProductsDto) {
    return this.campaigns.setProducts(a.userId, id, dto.productIds);
  }
}

/** ما تقرؤه الرئيسية — الحملات الجارية الآن بمنتجاتها الظاهرة */
@ApiTags('storefront')
@Controller()
export class PublicCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Public()
  @Get('storefront/campaigns')
  @ApiOperation({ summary: 'الحملات الجارية في الرئيسية بمواضعها — AD-17' })
  live(@Query('currency') currency?: string) {
    // عملة العرض — المجهولة تسقط إلى افتراضية الإدارة داخل الكتالوج
    return this.campaigns.publicCampaigns(new Date(), currency && /^[A-Za-z]{3}$/.test(currency) ? currency : undefined);
  }
}
