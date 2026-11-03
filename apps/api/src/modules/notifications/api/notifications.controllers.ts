import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Actor } from '../../../common/security/actor';
import { CurrentActor, RequirePermission, Roles } from '../../../common/security/decorators';
import { NotificationsService } from '../application/notifications.service';
import type { Channel } from '../domain/templates';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('المورد غير موجود.') });

export class TemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @Length(5, 4000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class PreviewDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  body!: string;
}

export class ReviewDto {
  @IsString()
  @Length(2, 80)
  reviewer!: string;
}

/** تصفّح الصندوق — كل الحقول اختيارية، وبلاها يعود الرد كما كان (آخر 30) */
export class InboxQueryDto {
  @IsOptional()
  @IsUUID()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsIn(['1', 'true'])
  unread?: string;

  /** رموز القوالب مفصولة بفواصل — «الطلبات» أو «المال» في صندوق اللوحة تصفيةً من الخادم */
  @IsOptional()
  @Matches(/^[a-z0-9_]{1,60}(,[a-z0-9_]{1,60}){0,49}$/, { message: 'رموز الإشعارات بأحرف لاتينية صغيرة وأرقام وشرطة سفلية، مفصولة بفواصل.' })
  codes?: string;

  /** عدد إشعارات كل رمز في الصندوق كله — لعدّادات التصفية */
  @IsOptional()
  @IsIn(['1', 'true'])
  counts?: string;
}

/** { orders: false, … } — المفاتيح تُفحص في الخدمة مقابل قائمة الفئات */
export class PrefsDto {
  @IsObject()
  prefs!: Record<string, boolean>;
}

export class PushDto {
  @IsUrl({ require_tld: false })
  endpoint!: string;

  @IsObject()
  keys!: Record<string, string>;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me/notifications')
export class MyNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  inbox(@CurrentActor() a: Actor, @Query() q: InboxQueryDto) {
    return this.notifications.inbox(a.userId, {
      ...(q.before ? { before: q.before } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.unread ? { unreadOnly: true } : {}),
      ...(q.codes ? { codes: q.codes.split(',') } : {}),
      ...(q.counts ? { counts: true } : {}),
    });
  }

  /** VD-20 — تفضيلات البريد لكل فئة */
  @Get('prefs')
  prefs(@CurrentActor() a: Actor) {
    return this.notifications.preferences(a.userId);
  }

  @Put('prefs')
  setPrefs(@CurrentActor() a: Actor, @Body() dto: PrefsDto) {
    return this.notifications.setPreferences(a.userId, dto.prefs);
  }

  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  readAll(@CurrentActor() a: Actor) {
    return this.notifications.markRead(a.userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.notifications.markRead(a.userId, id);
  }

  @Post('push-subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribe(@CurrentActor() a: Actor, @Body() dto: PushDto) {
    return this.notifications.subscribePush(a.userId, { endpoint: dto.endpoint, keys: dto.keys });
  }
}

/** AD-20 — القوالب: حدث × قناة، بمعاينة وإرسال تجربة ومراجعة لغوية موقّعة */
@ApiTags('admin-notifications')
@ApiBearerAuth()
@Roles('admin')
@RequirePermission('content.manage')
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('templates')
  matrix() {
    return this.notifications.matrix();
  }

  @Put('templates/:code/:channel')
  save(@CurrentActor() a: Actor, @Param('code') code: string, @Param('channel') channel: string, @Body() dto: TemplateDto) {
    return this.notifications.saveTemplate(a.userId, code, channel as Channel, {
      subject: dto.subject ?? null,
      body: dto.body,
      ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
    });
  }

  @Post('templates/:code/preview')
  @HttpCode(HttpStatus.OK)
  preview(@Param('code') code: string, @Body() dto: PreviewDto) {
    return this.notifications.preview(code, dto.subject ?? null, dto.body);
  }

  @Post('templates/:code/:channel/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  review(@CurrentActor() a: Actor, @Param('code') code: string, @Param('channel') channel: string, @Body() dto: ReviewDto) {
    return this.notifications.markReviewed(a.userId, code, channel as Channel, dto.reviewer);
  }

  @Post('templates/:code/:channel/test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentActor() a: Actor, @Param('code') code: string, @Param('channel') channel: string) {
    return this.notifications.sendTest(a.userId, code, channel as Channel);
  }

  @Get('log')
  log(@Query('status') status?: string, @Query('channel') channel?: string) {
    return this.notifications.log({ ...(status ? { status } : {}), ...(channel ? { channel } : {}) });
  }
}
