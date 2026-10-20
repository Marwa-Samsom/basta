import {
  Body,
  Controller,
  createParamDecorator,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../common/security/actor';
import { CurrentActor } from '../../../common/security/decorators';
import { AuthLimited } from '../../../common/security/throttle';
import { AccountService } from '../application/account.service';
import { RecoveryService } from '../application/recovery.service';
import { AuthController } from './auth.controller';
import { ChangePasswordDto, CurrencyPreferenceDto, UpdateProfileDto, VerifyCodeDto } from './dto/account.dto';

/** معرّف الجلسة الحالية — يضعه حارس المصادقة من الرمز الموقَّع */
const CurrentSessionId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | null =>
    ctx.switchToHttp().getRequest<{ sessionId?: string | null }>().sessionId ?? null,
);

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('الجلسة غير موجودة.') });

interface RawReq {
  headers: Record<string, string | undefined>;
  ip?: string;
}

/**
 * ST-25 و SH-03 — حساب المستخدم نفسه. لا مسار هنا يقبل معرّف مستخدم: الفاعل
 * من رمزه، فلا طريق إلى حساب غيره ولو بتعديل الطلب.
 */
@ApiTags('account')
@ApiBearerAuth()
@Controller('me/account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly recovery: RecoveryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ملفي الشخصي وحالة التوثيق والتحقق الثنائي' })
  profile(@CurrentActor() actor: Actor) {
    return this.account.profile(actor.userId);
  }

  @Patch()
  @ApiOperation({ summary: 'تعديل الاسم والجوال' })
  update(@CurrentActor() actor: Actor, @Body() dto: UpdateProfileDto, @Req() req: RawReq) {
    return this.account.updateProfile(actor.userId, dto, AuthController.meta(req));
  }

  @Put('currency')
  @ApiOperation({ summary: 'عملة العرض والدفع التي اختارها — تتبعه بين أجهزته' })
  currency(@CurrentActor() actor: Actor, @Body() dto: CurrencyPreferenceDto) {
    return this.account.setCurrency(actor.userId, dto.currency);
  }

  @Post('password')
  @AuthLimited()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تغيير كلمة المرور — تُنهى الجلسات الأخرى' })
  changePassword(
    @CurrentActor() actor: Actor,
    @CurrentSessionId() sessionId: string | null,
    @Body() dto: ChangePasswordDto,
    @Req() req: RawReq,
  ) {
    return this.account.changePassword(actor.userId, sessionId, dto, AuthController.meta(req));
  }

  // ------------------------------------------------------------ الجلسات

  @Get('sessions')
  @ApiOperation({ summary: 'الجلسات النشطة — الحالية معلَّمة' })
  async sessions(@CurrentActor() actor: Actor, @CurrentSessionId() sessionId: string | null) {
    return { items: await this.account.sessions(actor.userId, sessionId) };
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إنهاء كل الجلسات عدا الحالية' })
  revokeOthers(@CurrentActor() actor: Actor, @CurrentSessionId() sessionId: string | null, @Req() req: RawReq) {
    return this.account.revokeOthers(actor.userId, sessionId, AuthController.meta(req));
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'إنهاء جلسة واحدة من جلساتي' })
  async revoke(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string, @Req() req: RawReq): Promise<void> {
    await this.account.revokeSession(actor.userId, id, AuthController.meta(req));
  }

  // ------------------------------------------------------- تأكيد البريد

  @Get('email-verification')
  @ApiOperation({ summary: 'حالة تأكيد البريد والرمز الحيّ إن وُجد' })
  verification(@CurrentActor() actor: Actor) {
    return this.recovery.verificationStatus(actor.userId);
  }

  @Post('email-verification')
  @AuthLimited()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'أرسل رمز تأكيد إلى بريدي — مهلة دقيقة بين رمزين' })
  requestVerification(@CurrentActor() actor: Actor, @Req() req: RawReq) {
    return this.recovery.requestEmailVerification(actor.userId, AuthController.meta(req));
  }

  @Post('email-verification/confirm')
  @AuthLimited()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'أكّد البريد بالرمز' })
  confirmVerification(@CurrentActor() actor: Actor, @Body() dto: VerifyCodeDto, @Req() req: RawReq) {
    return this.recovery.confirmEmail(actor.userId, dto.code, AuthController.meta(req));
  }
}
