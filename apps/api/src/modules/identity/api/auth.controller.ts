import { Body, Controller, Get, Post, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../common/security/actor';
import { AuthService } from '../application/auth.service';
import { AllowLimited, CurrentActor, Public } from '../../../common/security/decorators';
import { AuthLimited } from '../../../common/security/throttle';
import { LoginDto, RefreshDto, RegisterDto, TotpCodeDto, TotpConfirmDto, TotpDisableDto } from './dto/auth.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/account.dto';
import { RecoveryService } from '../application/recovery.service';

interface RawReq {
  headers: Record<string, string | undefined>;
  ip?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly recovery: RecoveryService,
  ) {}

  /** بيانات الطلب للتدقيق — مشتركة مع متحكّم الحساب */
  static meta(req: RawReq) {
    return {
      userAgent: req.headers['user-agent'],
      // خلف وسيط عكسي، العنوان الحقيقي في X-Forwarded-For لا في ip
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.ip,
    };
  }

  @Public()
  @AuthLimited()
  @Post('register')
  @ApiOperation({ summary: 'إنشاء حساب عميل' })
  register(@Body() dto: RegisterDto, @Req() req: RawReq) {
    return this.auth.register(dto, AuthController.meta(req));
  }

  @Public()
  @AuthLimited()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الدخول — الإدارة تحتاج رمز تحقق ثنائي' })
  login(@Body() dto: LoginDto, @Req() req: RawReq) {
    return this.auth.login(dto, AuthController.meta(req));
  }

  /**
   * SH-04 — الرد واحد لكل بريد، مسجّلاً كان أو لا. والحدّ الصارم على العنوان
   * يمنع استعمال المسار لإغراق بريد أحد برموز.
   */
  @Public()
  @AuthLimited()
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'اطلب رمز استعادة كلمة المرور — لا يكشف وجود الحساب' })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: RawReq) {
    return this.recovery.forgotPassword(dto.email, AuthController.meta(req));
  }

  @Public()
  @AuthLimited()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'كلمة مرور جديدة بالرمز — تُنهى كل الجلسات' })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: RawReq) {
    return this.recovery.resetPassword(dto, AuthController.meta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تدوير رمز الجلسة — الرمز يُستعمل مرة واحدة' })
  refresh(@Body() dto: RefreshDto, @Req() req: RawReq) {
    return this.auth.refresh(dto.refreshToken, AuthController.meta(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'إنهاء الجلسة الحالية' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'إنهاء كل الجلسات على كل الأجهزة' })
  async logoutAll(@CurrentActor() actor: Actor): Promise<void> {
    await this.auth.logoutAll(actor.userId);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'الحساب الحالي' })
  me(@CurrentActor() actor: Actor) {
    return actor;
  }

  /**
   * المساران الوحيدان اللذان يفتحهما الرمز المحدود — بهما يفعّل الإداري
   * تحققه الثنائي، وبدونهما يعلق بلا سبيل للامتثال.
   */
  @ApiBearerAuth()
  @AllowLimited()
  @Post('totp/setup')
  @ApiOperation({ summary: 'بدء تهيئة التحقق الثنائي' })
  beginTotp(@CurrentActor() actor: Actor) {
    return this.auth.beginTotpSetup(actor.userId);
  }

  @ApiBearerAuth()
  @AllowLimited()
  @AuthLimited()
  @Post('totp/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تأكيد التهيئة — يُعيد رموز الاستعادة مرة واحدة ويُبطل الجلسات السابقة' })
  confirmTotp(@CurrentActor() actor: Actor, @Body() dto: TotpConfirmDto): Promise<{ recoveryCodes: string[] }> {
    return this.auth.confirmTotpSetup(actor.userId, dto.token);
  }

  @ApiBearerAuth()
  @AuthLimited()
  @Post('totp/recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'رموز استعادة جديدة تُبطل القديمة — بإثبات ثانٍ' })
  regenerateRecoveryCodes(
    @CurrentActor() actor: Actor,
    @Body() dto: TotpCodeDto,
    @Req() req: RawReq,
  ): Promise<{ recoveryCodes: string[] }> {
    return this.auth.regenerateRecoveryCodes(actor.userId, dto.code, AuthController.meta(req));
  }

  @ApiBearerAuth()
  @AuthLimited()
  @Post('totp/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'تعطيل التحقق الثنائي بكلمة المرور ورمز — ممنوع على الإدارة' })
  async disableTotp(@CurrentActor() actor: Actor, @Body() dto: TotpDisableDto, @Req() req: RawReq): Promise<void> {
    await this.auth.disableTotp(actor.userId, { password: dto.password, code: dto.code }, AuthController.meta(req));
  }
}
