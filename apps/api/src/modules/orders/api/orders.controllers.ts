import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ForbiddenActorError,
  vendorScopeOf,
  type Actor,
} from '../../../common/security/actor';
import { CurrentActor, RequirePermission, Roles } from '../../../common/security/decorators';
import { loadEnv } from '../../../common/config/env';
import { InvalidInputError } from '../../../common/errors/domain-error';
import { pageOf, SORT_ORDERS, sortOf, termOf, type SortOrder } from '../../../common/paging';
import { OrderLifecycleService } from '../application/order-lifecycle.service';
import { OrderQueryService } from '../application/order-query.service';
import { missingAdminPermission } from '../domain/admin-permission';
import type { SubOrderStatus } from '../domain/state-machine';
import { SubOrderStatus as SubOrderStatuses } from '@prisma/client';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('الطلب غير موجود.') });

function vendorIdOf(actor: Actor): string {
  try {
    return vendorScopeOf(actor).vendorId;
  } catch (err) {
    if (err instanceof ForbiddenActorError) throw new ForbiddenException(err.message);
    throw err;
  }
}

export class TransitionDto {
  @IsString()
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @Length(4, 60)
  tracking?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  carrierCode?: string;

  @IsOptional()
  @IsUUID()
  returnRequestId?: string;
}

export class VendorOrdersQueryDto {
  /** حالة أو أكثر مفصولة بفاصلة — تبويب «ملغى أو مُسترَد» يجمع أربع حالات نهائية */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMaxSize(Object.values(SubOrderStatuses).length)
  @IsIn(Object.values(SubOrderStatuses), { each: true, message: 'حالة الطلب غير معروفة.' })
  status?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsIn(SORT_ORDERS, { message: 'الترتيب newest (الأحدث أولاً) أو oldest (الأقدم أولاً).' })
  sort?: SortOrder;
}

export class ReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReturnItemDto {
  @IsUUID()
  orderItemId!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

export const RETURN_REASONS = ['damaged', 'wrong_item', 'not_as_described', 'size_issue', 'changed_mind', 'other'] as const;

export class ReturnRequestDto {
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items!: ReturnItemDto[];

  @IsIn([...RETURN_REASONS], { message: 'سبب الإرجاع غير معروف.' })
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

/** طلبات المتجر — VD-12 · VD-13 · VD-14 · VD-16 */
@ApiTags('vendor-orders')
@ApiBearerAuth()
@Roles('vendor_owner', 'vendor_staff')
@Controller('vendor/orders')
export class VendorOrdersController {
  constructor(
    private readonly query: OrderQueryService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'طلبات المتجر مع عدّاد لكل حالة' })
  list(@CurrentActor() actor: Actor, @Query() q: VendorOrdersQueryDto) {
    return this.query.vendorList(vendorIdOf(actor), {
      ...(q.status?.length ? { status: q.status } : {}),
      ...(q.search ? { search: q.search } : {}),
      ...(q.page ? { page: q.page } : {}),
      ...(q.sort ? { sort: q.sort } : {}),
    });
  }

  @Get(':id')
  detail(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string) {
    return this.query.vendorDetail(vendorIdOf(actor), id);
  }

  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'قبول، رفض، تجهيز، شحن، تسليم، استلام مرتجع — الجدول يحكم' })
  async transition(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string, @Body() dto: TransitionDto) {
    const vendorId = vendorIdOf(actor);
    // بلا شركة موصولة لا شحنة باسم شركة: شاشة قديمة أو طلب مباشر كان ينشئ شحنة
    // «بسطة إكسبرس» لا تتقدّم ويُعرض رقمها في التتبّع العام كأن وراءه شركة
    if (dto.to === 'shipped' && loadEnv().shippingCarrier === 'none' && (dto.carrierCode ?? 'self') !== 'self') {
      throw new InvalidInputError('لا شركة شحن موصولة — التوصيل ذاتي: اكتب مرجع توصيلك وأكّد الشحن.', {
        carrierCode: dto.carrierCode,
      });
    }
    // الهدف خارج قائمة البائع يمرّ إلى الجدول فيُرفض هناك — مصدر رفض واحد
    await this.lifecycle.transition(
      id,
      dto.to as SubOrderStatus,
      { kind: 'vendor', userId: actor.userId, vendorId },
      {
        reason: dto.reason ?? null,
        tracking: dto.tracking ?? null,
        carrierCode: dto.carrierCode ?? null,
        returnRequestId: dto.returnRequestId ?? null,
      },
    );
    return this.query.vendorDetail(vendorId, id);
  }

  /** رفض طلب الإرجاع: يعود الفرعي «مسلَّماً» بسبب مكتوب */
  @Post(':id/return/deny')
  @HttpCode(HttpStatus.OK)
  async denyReturn(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string, @Body() dto: ReasonDto) {
    const vendorId = vendorIdOf(actor);
    await this.lifecycle.transition(id, 'delivered', { kind: 'vendor', userId: actor.userId, vendorId }, {
      reason: dto.reason ?? null,
    });
    return this.query.vendorDetail(vendorId, id);
  }
}

/** طلباتي — ST-18 · ST-19 · ST-20 */
@ApiTags('my-orders')
@ApiBearerAuth()
@Controller('me/orders')
export class CustomerOrdersController {
  constructor(
    private readonly query: OrderQueryService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query('page') page?: string) {
    return this.query.customerList(actor.userId, Number(page) || 1);
  }

  @Get(':number')
  detail(@CurrentActor() actor: Actor, @Param('number') number: string) {
    return this.query.customerDetail(actor.userId, number);
  }

  /** إلغاء متجر واحد من الطلب — إخوته لا يُمسّون (بوابة 09 البند 3) */
  @Post(':number/stores/:subOrderId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('number') number: string,
    @Param('subOrderId', uuidParam) subOrderId: string,
    @Body() dto: ReasonDto,
  ) {
    await this.lifecycle.transition(subOrderId, 'canceled_by_customer', { kind: 'customer', userId: actor.userId }, {
      reason: dto.reason ?? null,
    });
    return this.query.customerDetail(actor.userId, number);
  }

  @Post(':number/stores/:subOrderId/return')
  @HttpCode(HttpStatus.CREATED)
  async requestReturn(
    @CurrentActor() actor: Actor,
    @Param('number') number: string,
    @Param('subOrderId', uuidParam) subOrderId: string,
    @Body() dto: ReturnRequestDto,
  ) {
    const id = await this.lifecycle.requestReturn(subOrderId, actor.userId, {
      items: dto.items.map((i) => ({ orderItemId: i.orderItemId, qty: i.qty })),
      reasonCode: dto.reasonCode,
      description: dto.description ?? null,
    });
    return { returnRequestId: id, order: await this.query.customerDetail(actor.userId, number) };
  }
}

export class RefundTransferDto {
  /** مرجع التحويل الصادر كما في كشف البنك — يصل المشتري معه، وبه يتتبّع ماله */
  @IsString()
  @Length(3, 80, { message: 'اكتب مرجع التحويل كما في كشف البنك (3 أحرف على الأقل).' })
  reference!: string;
}

/**
 * الردود بتحويل يدوي — ما لا يخرج آلياً تحوّله الإدارة وتسجّل مرجعه. صلاحية السحوبات
 * نفسها: كلاهما مال يخرج من حساب المنصة.
 */
@ApiTags('admin-refunds')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/refunds')
export class AdminRefundsController {
  constructor(
    private readonly query: OrderQueryService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  @Get('awaiting-transfer')
  @RequirePermission('payouts.approve')
  awaiting(@Query('search') search?: string, @Query('page') page?: string, @Query('sort') sort?: string) {
    const term = termOf(search);
    const order = sortOf(sort);
    return this.query.awaitingRefunds({ ...(term ? { search: term } : {}), page: pageOf(page), ...(order ? { sort: order } : {}) });
  }

  @Post(':id/transfer')
  @RequirePermission('payouts.approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'سُجّل تحويل الردّ — يصير «تمّ» ويُبلَّغ المشتري بالمرجع' })
  async record(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('الاسترداد غير موجود.') })) id: string,
    @Body() dto: RefundTransferDto,
  ) {
    await this.lifecycle.recordRefundTransfer(id, actor.userId, dto.reference);
    return { ok: true };
  }
}

/** الإدارة: الإلغاء بصلاحية orders.cancel وحدها — AD-10 */
@ApiTags('admin-orders')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly query: OrderQueryService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  /**
   * التفاصيل بالصلاحية نفسها التي تفتح قائمتها (orders.manage): عنوان الشحن
   * وحالة الدفع والمبالغ بيانات مشترٍ. كانت بالدور وحده، فمدير التسويق أو
   * المحتوى يقرأ عنوان أي مشترٍ برقم طلبه.
   */
  @Get(':number')
  @RequirePermission('orders.manage')
  detail(@CurrentActor() actor: Actor, @Param('number') number: string) {
    return this.query.adminDetail(number, actor.permissions);
  }

  @Post('stores/:subOrderId/cancel')
  @RequirePermission('orders.cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentActor() actor: Actor, @Param('subOrderId', uuidParam) subOrderId: string, @Body() dto: ReasonDto) {
    await this.lifecycle.transition(subOrderId, 'canceled_by_admin', { kind: 'admin', userId: actor.userId }, {
      reason: dto.reason ?? null,
    });
    return { ok: true };
  }

  @Post('stores/:subOrderId/transition')
  @RequirePermission('orders.manage')
  @HttpCode(HttpStatus.OK)
  async transition(
    @CurrentActor() actor: Actor,
    @Param('subOrderId', uuidParam) subOrderId: string,
    @Body() dto: TransitionDto,
  ) {
    // الانتقال العام بـ orders.manage كان يقبل «canceled_by_admin» فيلغي ويردّ المال من لا يحمل orders.cancel
    const missing = missingAdminPermission(dto.to as SubOrderStatus, actor.permissions);
    if (missing) throw new ForbiddenException(`تحتاج صلاحية «${missing}» لهذا الإجراء.`);
    await this.lifecycle.transition(subOrderId, dto.to as SubOrderStatus, { kind: 'admin', userId: actor.userId }, {
      reason: dto.reason ?? null,
      returnRequestId: dto.returnRequestId ?? null,
    });
    return { ok: true };
  }
}
