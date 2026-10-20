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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { ForbiddenActorError, vendorScopeOf, type Actor } from '../../../common/security/actor';
import { CurrentActor, Public, RequirePermission, Roles } from '../../../common/security/decorators';
import { pageOf, termOf } from '../../../common/paging';
import { DisputesService, type Party } from '../application/disputes.service';
import { ReviewsService } from '../application/reviews.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('المورد غير موجود.') });

const DISPUTE_REASONS = ['not_received', 'damaged', 'not_as_described', 'return_refused', 'refund_missing', 'other'] as const;

function vendorParty(actor: Actor): Party {
  try {
    return { kind: 'vendor', userId: actor.userId, vendorId: vendorScopeOf(actor).vendorId };
  } catch (err) {
    if (err instanceof ForbiddenActorError) throw new ForbiddenException(err.message);
    throw err;
  }
}

export class OpenDisputeDto {
  @IsUUID()
  subOrderId!: string;

  @IsIn([...DISPUTE_REASONS], { message: 'سبب النزاع غير معروف.' })
  reasonCode!: string;

  @IsString()
  @Length(10, 2000, { message: 'اشرح المشكلة في 10 أحرف على الأقل.' })
  message!: string;
}

export class MessageDto {
  @IsString()
  @Length(1, 2000)
  body!: string;
}

export class ResolveDto {
  @IsIn(['customer', 'vendor'])
  outcome!: 'customer' | 'vendor';

  @IsString()
  @Length(5, 2000)
  resolution!: string;
}

export class ReviewDto {
  @IsUUID()
  orderItemId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;
}

@ApiTags('my-disputes')
@ApiBearerAuth()
@Controller('me/disputes')
export class CustomerDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@CurrentActor() a: Actor) {
    return this.disputes.list({ kind: 'customer', userId: a.userId });
  }

  @Post()
  open(@CurrentActor() a: Actor, @Body() dto: OpenDisputeDto) {
    return this.disputes.open(a.userId, dto.subOrderId, { reasonCode: dto.reasonCode, message: dto.message });
  }

  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.disputes.get({ kind: 'customer', userId: a.userId }, id);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.NO_CONTENT)
  message(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: MessageDto) {
    return this.disputes.message({ kind: 'customer', userId: a.userId }, id, dto.body);
  }

  @Post(':id/escalate')
  @HttpCode(HttpStatus.NO_CONTENT)
  escalate(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.disputes.escalate({ kind: 'customer', userId: a.userId }, id);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  withdraw(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.disputes.withdraw(a.userId, id);
  }
}

@ApiTags('vendor-disputes')
@ApiBearerAuth()
@Roles('vendor_owner', 'vendor_staff')
@Controller('vendor/disputes')
export class VendorDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@CurrentActor() a: Actor, @Query('status') status?: string) {
    return this.disputes.list(vendorParty(a), status);
  }

  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.disputes.get(vendorParty(a), id);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.NO_CONTENT)
  message(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: MessageDto) {
    return this.disputes.message(vendorParty(a), id, dto.body);
  }

  @Post(':id/escalate')
  @HttpCode(HttpStatus.NO_CONTENT)
  escalate(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.disputes.escalate(vendorParty(a), id);
  }
}

@ApiTags('admin-disputes')
@ApiBearerAuth()
@Roles('admin')
@RequirePermission('disputes.resolve')
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@Query('status') status?: string, @Query('search') search?: string, @Query('page') page?: string) {
    const term = termOf(search);
    return this.disputes.adminList({ status: status ?? 'escalated', ...(term ? { search: term } : {}), page: pageOf(page) });
  }

  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.disputes.get({ kind: 'admin', userId: a.userId }, id);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.NO_CONTENT)
  message(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: MessageDto) {
    return this.disputes.message({ kind: 'admin', userId: a.userId }, id, dto.body);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  resolve(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: ResolveDto) {
    return this.disputes.resolve(a.userId, id, dto);
  }
}

@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @ApiBearerAuth()
  @Post('me/reviews')
  create(@CurrentActor() a: Actor, @Body() dto: ReviewDto) {
    return this.reviews.create(a.userId, {
      orderItemId: dto.orderItemId,
      rating: dto.rating,
      title: dto.title ?? null,
      body: dto.body ?? null,
    });
  }

  @Public()
  @Get('products/:productId/reviews')
  forProduct(@Param('productId', uuidParam) productId: string, @Query('page') page?: string) {
    return this.reviews.forProduct(productId, Number(page) || 1);
  }
}
