import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InvalidInputError } from '../../../common/errors/domain-error';
import type { Actor } from '../../../common/security/actor';
import { CurrentActor, Public, RequirePermission, Roles } from '../../../common/security/decorators';
import { pageOf, sortOf, termOf } from '../../../common/paging';
import { BANNER_PLACEMENTS, ContentService, type CouponInput } from '../application/content.service';
import { OperationsService } from '../application/operations.service';
import { ReportsService, type Range } from '../application/reports.service';
import { PERMISSIONS } from '../domain/permissions';
import { NormalizeEmail } from '../../../common/email';
import { assertOneOf, isCalendarDate } from '../../../common/validation';
import { OrderStatus } from '@prisma/client';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('المورد غير موجود.') });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** لحظة دقيقة — لتقرير على نافذة مغلقة (مطابقة الدفتر حتى وقت محدّد) */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** الفترة: من بداية يوم «من» إلى نهاية يوم «إلى» (أو لحظة محدّدة)؛ افتراضياً آخر 30 يوماً */
function rangeOf(from?: string, to?: string): Range {
  // يوم حقيقي لا صيغته وحدها: 2026-13-01 كان Invalid Date يصل Prisma فيرمي 500
  const ok = (v?: string) => !v || (DATE.test(v) ? isCalendarDate(v) : INSTANT.test(v) && !Number.isNaN(Date.parse(v)));
  if (!ok(from) || !ok(to)) throw new InvalidInputError('التاريخ بصيغة YYYY-MM-DD.');
  const toDate = !to ? new Date() : INSTANT.test(to) ? new Date(to) : new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000);
  const fromDate = !from ? new Date(toDate.getTime() - 30 * 86_400_000) : INSTANT.test(from) ? new Date(from) : new Date(`${from}T00:00:00.000Z`);
  if (fromDate >= toDate) throw new InvalidInputError('بداية الفترة قبل نهايتها.');
  // كل تقرير يجمع سبعة جداول على الفترة: فترة بلا سقف (من 2000 مثلاً) تمسح القاعدة كلها
  // في طلب واحد، والتصدير يكرّرها. السنة تكفي للمقارنة السنوية
  if (toDate.getTime() - fromDate.getTime() > MAX_REPORT_DAYS * 86_400_000) {
    throw new InvalidInputError(`الفترة ${MAX_REPORT_DAYS} يوماً على الأكثر — للأطول صدّر سنة بسنة.`);
  }
  return { from: fromDate, to: toDate };
}

/** أطول فترة لتقرير أو لوحة أو تصدير */
const MAX_REPORT_DAYS = 366;

const BANNER_MAX_BYTES = 8 * 1024 * 1024;

export class GrantDto {
  @NormalizeEmail()
  @IsString()
  @MaxLength(200)
  email!: string;

  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

export class PermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

export class ReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SettingDto {
  @IsDefined()
  value!: unknown;
}

export class TaxDto {
  @IsInt()
  @Min(0)
  @Max(5000)
  rateBps!: number;

  @IsBoolean()
  isPriceInclusive!: boolean;
}

export class RateDto {
  @Matches(/^[A-Z]{3}$/)
  quote!: string;

  @Matches(/^\d+(\.\d{1,10})?$/)
  rate!: string;

  @IsString()
  @Length(2, 60)
  source!: string;
}

export class CouponDto implements CouponInput {
  @Matches(/^[A-Z0-9_-]{3,30}$/, { message: 'الرمز بأحرف لاتينية كبيرة وأرقام.' })
  code!: string;

  @IsIn(['platform', 'vendor'])
  scope!: 'platform' | 'vendor';

  @IsOptional()
  @IsUUID()
  vendorId?: string | null;

  @IsIn(['percent', 'fixed', 'free_shipping'])
  type!: 'percent' | 'fixed' | 'free_shipping';

  @IsOptional()
  @IsInt()
  valueBps?: number | null;

  @IsOptional()
  @Matches(/^\d{1,15}$/)
  valueMinorUnits?: string | null;

  @IsOptional()
  @Matches(/^\d{1,15}$/)
  maxDiscountMinorUnits?: string | null;

  @IsOptional()
  @Matches(/^\d{1,15}$/)
  minOrderMinorUnits?: string | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimitTotal?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimitPerUser?: number | null;

  @IsIn(['platform', 'vendor'])
  fundedBy!: 'platform' | 'vendor';

  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PageDto {
  // رسالة الخدمة الأوضح كانت لا تصل: هذا التحقق يسبقها فيقول «أحد الحقول: صيغة غير صحيحة.» (ACFG-056)
  @Matches(/^[a-z0-9-]{2,60}$/, { message: 'المسار من 2 إلى 60 حرفاً: أحرف لاتينية صغيرة وأرقام وشرطات.' })
  slug!: string;

  @IsString()
  @Length(2, 120)
  titleAr!: string;

  @IsString()
  @MaxLength(50_000)
  bodyAr!: string;

  @IsBoolean()
  isPublished!: boolean;
}

export class BannerDto {
  @IsIn([...BANNER_PLACEMENTS])
  placement!: string;

  @IsString()
  imageKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  linkUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleAr?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  endsAt?: string | null;

  @IsBoolean()
  isActive!: boolean;
}

export class FeaturedDto {
  @IsArray()
  @ArrayMaxSize(24)
  @IsUUID('all', { each: true })
  productIds!: string[];
}

export class ModerateDto {
  @IsIn(['published', 'rejected'])
  status!: 'published' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

// ============================================================ اللوحة والتقارير

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** اللوحة لكل مدير: الطوابير تخصّ الجميع، والأرقام المالية لمن يملك reports.view وحده */
  @Get('dashboard')
  dashboard(@CurrentActor() a: Actor, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.dashboard(rangeOf(from, to), a.permissions.includes('reports.view'));
  }

  @Get('reports/financial')
  @RequirePermission('reports.view')
  financial(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.financial(rangeOf(from, to));
  }

  @Get('reports/financial.csv')
  @RequirePermission('reports.view')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="basta-report.csv"')
  csv(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.csv(rangeOf(from, to));
  }

  @Get('reports/financial.xlsx')
  @RequirePermission('reports.view')
  async xlsx(@Res() res: FastifyReply, @Query('from') from?: string, @Query('to') to?: string) {
    const buf = await this.reports.xlsx(rangeOf(from, to));
    return res
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', 'attachment; filename="basta-report.xlsx"')
      .send(buf);
  }

  @Get('health/drift')
  @RequirePermission('reports.view')
  drift() {
    return this.reports.drift();
  }
}

// ================================================================ العمليات

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminOperationsController {
  constructor(private readonly ops: OperationsService) {}

  @Get('permissions')
  permissions() {
    return PERMISSIONS;
  }

  @Get('users')
  @RequirePermission('users.manage')
  admins() {
    return this.ops.admins();
  }

  @Post('users/grant')
  @RequirePermission('users.manage')
  grant(@CurrentActor() a: Actor, @Body() dto: GrantDto) {
    return this.ops.grantAdmin(a.userId, dto.email, dto.permissions);
  }

  @Put('users/:id/permissions')
  @RequirePermission('users.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  setPermissions(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: PermissionsDto) {
    return this.ops.setPermissions(a.userId, id, dto.permissions);
  }

  @Post('users/:id/revoke')
  @RequirePermission('users.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.ops.revokeAdmin(a.userId, id);
  }

  @Get('customers')
  @RequirePermission('customers.manage')
  customers(@Query('q') q?: string, @Query('page') page?: string, @Query('sort') sort?: string) {
    const order = sortOf(sort);
    return this.ops.customers({ ...(q ? { search: q } : {}), page: Number(page) || 1, ...(order ? { sort: order } : {}) });
  }

  @Get('customers/:id')
  @RequirePermission('customers.manage')
  customer(@Param('id', uuidParam) id: string) {
    return this.ops.customer(id);
  }

  @Post('customers/:id/suspend')
  @RequirePermission('customers.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  suspend(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: ReasonDto) {
    return this.ops.setCustomerStatus(a.userId, id, 'suspended', dto.reason ?? '');
  }

  @Post('customers/:id/reset-2fa')
  @RequirePermission('customers.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetTotp(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: ReasonDto) {
    return this.ops.resetCustomerTotp(a.userId, id, dto.reason ?? '');
  }

  @Post('customers/:id/reinstate')
  @RequirePermission('customers.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  reinstate(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.ops.setCustomerStatus(a.userId, id, 'active', '');
  }

  @Get('audit')
  @RequirePermission('audit.view')
  audit(
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('sort') sort?: string,
  ) {
    const r = from || to ? rangeOf(from, to) : null;
    const order = sortOf(sort);
    return this.ops.auditLog({
      ...(actor ? { actor } : {}),
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(r ? { from: r.from, to: r.to } : {}),
      page: Number(page) || 1,
      ...(order ? { sort: order } : {}),
    });
  }

  @Get('settings')
  @RequirePermission('settings.edit')
  settings() {
    return this.ops.settings();
  }

  @Put('settings/:key')
  @RequirePermission('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  setSetting(@CurrentActor() a: Actor, @Param('key') key: string, @Body() dto: SettingDto) {
    return this.ops.setSetting(a.userId, key, dto.value);
  }

  @Put('taxes/:country')
  @RequirePermission('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  setTax(@CurrentActor() a: Actor, @Param('country') country: string, @Body() dto: TaxDto) {
    return this.ops.setTax(a.userId, country.toUpperCase(), dto);
  }

  @Get('currencies')
  @RequirePermission('settings.edit')
  currencies() {
    return this.ops.currencies();
  }

  @Post('fx-rates')
  @RequirePermission('settings.edit')
  addRate(@CurrentActor() a: Actor, @Body() dto: RateDto) {
    return this.ops.addRate(a.userId, dto.quote, dto.rate, dto.source);
  }

  @Get('orders')
  @RequirePermission('orders.manage')
  orders(@Query('q') q?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('due') due?: string, @Query('sort') sort?: string) {
    const order = sortOf(sort);
    return this.ops.orders({
      ...(order ? { sort: order } : {}),
      ...(q ? { search: q } : {}),
      ...(status ? { status: assertOneOf(status, Object.values(OrderStatus), 'حالة الطلب') } : {}),
      ...(due ? { due: assertOneOf(due, ['acceptance'] as const, 'التصفية') } : {}),
      page: Number(page) || 1,
    });
  }

  @Get('returns')
  @RequirePermission('orders.manage')
  returns(@Query('status') status?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('sort') sort?: string) {
    const term = termOf(search);
    const order = sortOf(sort);
    return this.ops.returns({ ...(status ? { status } : {}), ...(term ? { search: term } : {}), page: pageOf(page), ...(order ? { sort: order } : {}) });
  }

  @Get('returns/refunds')
  @RequirePermission('orders.manage')
  refunds(@Query('search') search?: string, @Query('page') page?: string, @Query('sort') sort?: string) {
    const term = termOf(search);
    const order = sortOf(sort);
    return this.ops.refunds({ ...(term ? { search: term } : {}), page: pageOf(page), ...(order ? { sort: order } : {}) });
  }
}

// ================================================================= المحتوى

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminContentController {
  constructor(private readonly content: ContentService) {}

  @Get('coupons')
  @RequirePermission('coupons.manage')
  coupons() {
    return this.content.coupons();
  }

  @Post('coupons')
  @RequirePermission('coupons.manage')
  createCoupon(@CurrentActor() a: Actor, @Body() dto: CouponDto) {
    return this.content.createCoupon(a.userId, dto);
  }

  @Put('coupons/:id')
  @RequirePermission('coupons.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateCoupon(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: CouponDto) {
    return this.content.updateCoupon(a.userId, id, dto);
  }

  @Get('pages')
  @RequirePermission('content.manage')
  pages() {
    return this.content.pages();
  }

  @Post('pages')
  @RequirePermission('content.manage')
  createPage(@CurrentActor() a: Actor, @Body() dto: PageDto) {
    return this.content.savePage(a.userId, dto);
  }

  @Put('pages/:id')
  @RequirePermission('content.manage')
  updatePage(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: PageDto) {
    return this.content.savePage(a.userId, { ...dto, id });
  }

  @Get('banners')
  @RequirePermission('content.manage')
  banners() {
    return this.content.banners();
  }

  @Post('banners/image')
  @RequirePermission('content.manage')
  async bannerImage(@Req() req: FastifyRequest) {
    const part = await req.file({ limits: { fileSize: BANNER_MAX_BYTES, files: 1 } }).catch(() => undefined);
    if (!part) throw new InvalidInputError('أرفق الصورة في الحقل file.');
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch (err) {
      // كان يخرج 500 «حدث خلل غير متوقّع» — مسار صور المنتجات يترجمه ومسار البانر لا (ACFG-049)
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new InvalidInputError(`حجم صورة البانر أكبر من ${BANNER_MAX_BYTES / (1024 * 1024)} م.ب.`);
      }
      throw err;
    }
    return this.content.uploadBannerImage(buffer);
  }

  @Post('banners')
  @RequirePermission('content.manage')
  createBanner(@CurrentActor() a: Actor, @Body() dto: BannerDto) {
    return this.content.saveBanner(a.userId, dto);
  }

  @Patch('banners/:id')
  @RequirePermission('content.manage')
  updateBanner(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: BannerDto) {
    return this.content.saveBanner(a.userId, { ...dto, id });
  }

  @Get('storefront/featured')
  @RequirePermission('content.manage')
  featured() {
    return this.content.featured();
  }

  @Put('storefront/featured')
  @RequirePermission('content.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  setFeatured(@CurrentActor() a: Actor, @Body() dto: FeaturedDto) {
    return this.content.setFeatured(a.userId, dto.productIds);
  }

  @Get('reviews')
  @RequirePermission('content.manage')
  reviews(@Query('status') status?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('sort') sort?: string) {
    const term = termOf(search);
    const order = sortOf(sort);
    return this.content.reviews({ ...(status ? { status } : {}), ...(term ? { search: term } : {}), page: pageOf(page), ...(order ? { sort: order } : {}) });
  }

  @Post('reviews/:id/moderate')
  @RequirePermission('content.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  moderate(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: ModerateDto) {
    return this.content.moderateReview(a.userId, id, dto.status, dto.reason ?? null);
  }
}

/** ما يقرؤه المتجر من إدارة المحتوى — عام */
@ApiTags('storefront')
@Controller()
export class PublicContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('pages/:slug')
  page(@Param('slug') slug: string) {
    return this.content.publicPage(slug);
  }

  @Public()
  @Get('storefront/banners')
  banners(@Query('placement') placement?: string) {
    return this.content.publicBanners(placement ?? 'home_hero');
  }
}
