import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { ForbiddenActorError, vendorScopeOf, type Actor, type VendorScope } from '../../../common/security/actor';
import { CurrentActor, Roles } from '../../../common/security/decorators';
import { pageOf, termOf } from '../../../common/paging';
import { MessagingService, type ThreadQuery } from '../application/messaging.service';
import { BODY_MAX, BODY_MIN } from '../domain/messages';

/** معرّف غير صالح يُعامل كغير موجود — 404 لا 400، فلا يكشف الرد شكل المعرّفات */
const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('المحادثة غير موجودة.') });

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const BODY_MSG = `الرسالة من ${BODY_MIN} إلى ${BODY_MAX} حرف.`;

/** ?search= و?page= لصندوق الرسائل */
function threadQuery(search?: string, page?: string): ThreadQuery {
  const term = termOf(search);
  return { ...(term ? { search: term } : {}), page: pageOf(page) };
}

function scopeOf(actor: Actor): VendorScope {
  try {
    return vendorScopeOf(actor);
  } catch (err) {
    if (err instanceof ForbiddenActorError) throw new ForbiddenException(err.message);
    throw err;
  }
}

export class MessageDto {
  @Transform(trim)
  @IsString()
  @Length(BODY_MIN, BODY_MAX, { message: BODY_MSG })
  body!: string;
}

/** سياق واحد بالضبط: منتج أو رقم شحنة المتجر من طلبك — الخدمة تفرض «واحد» */
export class StartConversationDto extends MessageDto {
  @IsOptional()
  @IsUUID('all', { message: 'معرّف المنتج غير صالح.' })
  productId?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^[A-Za-z0-9-]{3,40}$/, { message: 'رقم الطلب غير صالح.' })
  orderNumber?: string;
}

/**
 * ST-09 و ST-28 — رسائل المستخدم الداخل مع المتاجر، أيّاً كان دوره.
 * لا مسار يأخذ معرّف مستخدم: المالك هو الفاعل دائماً.
 */
@ApiTags('my-conversations')
@ApiBearerAuth()
@Controller('me/conversations')
export class MyConversationsController {
  constructor(private readonly messaging: MessagingService) {}

  @Post()
  start(@CurrentActor() a: Actor, @Body() dto: StartConversationDto) {
    return this.messaging.start(a, dto);
  }

  @Get()
  list(@CurrentActor() a: Actor, @Query('search') search?: string, @Query('page') page?: string) {
    return this.messaging.listForCustomer(a.userId, threadQuery(search, page));
  }

  @Get(':id')
  open(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.messaging.openForCustomer(a.userId, id);
  }

  @Post(':id/messages')
  reply(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: MessageDto) {
    return this.messaging.replyAsCustomer(a.userId, id, dto.body);
  }
}

/**
 * VD-15 — رسائل المتجر. البائع يردّ ولا يبدأ: لا مسار إنشاء هنا.
 * النطاق من الرمز وحده؛ محادثة متجر آخر 404.
 */
@ApiTags('vendor-conversations')
@ApiBearerAuth()
@Roles('vendor_owner', 'vendor_staff')
@Controller('vendor/conversations')
export class VendorConversationsController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  list(@CurrentActor() a: Actor, @Query('search') search?: string, @Query('page') page?: string) {
    return this.messaging.listForVendor(scopeOf(a), threadQuery(search, page));
  }

  @Get(':id')
  open(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.messaging.openForVendor(scopeOf(a), id);
  }

  @Post(':id/messages')
  reply(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: MessageDto) {
    return this.messaging.replyAsVendor(scopeOf(a), a.userId, id, dto.body);
  }
}
