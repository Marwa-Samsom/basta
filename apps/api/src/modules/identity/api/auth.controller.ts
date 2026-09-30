import { Body, Controller, Get, Post, Req, Res, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { Actor } from '../../../common/security/actor';
import { AuthService } from '../application/auth.service';
import { AllowLimited, CurrentActor, Public } from '../../../common/security/decorators';
import { AuthLimited } from '../../../common/security/throttle';
import { LoginDto, RegisterDto, TotpCodeDto, TotpConfirmDto, TotpDisableDto, TotpSetupDto } from './dto/auth.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/account.dto';
import { RecoveryService } from '../application/recovery.service';
import { clearedRefreshCookie, readRefreshCookie } from './session-cookie';

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
      // req.ip يحسبه Fastify من X-Forwarded-For عبر الوسطاء الموثوقين وحدهم (TRUST_PROXY).
      // قراءة الترويسة باليد كانت تسجّل في التدقيق أي عنوان يكتبه الطالب
      ip: req.ip,
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

  /**
   * رمز التحديث من الكوكي وحده (session-cookie.ts) — لا يُقبل في الجسم: رمز
   * يصل في الجسم مصدره سكربت قرأه، وهذا ما أُغلق. الرمز الجديد يعود كوكياً.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'تدوير رمز الجلسة — الرمز يُستعمل مرة واحدة، ويصل ويعود كوكياً' })
  refresh(@Req() req: RawReq) {
    const presented = readRefreshCookie(req.headers['cookie']);
    if (!presented) throw new UnauthorizedException('انتهت جلستك. سجّل الدخول من جديد.');
    return this.auth.refresh(presented, AuthController.meta(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'إنهاء الجلسة الحالية ومسح كوكيها' })
  async logout(@Req() req: RawReq, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const presented = readRefreshCookie(req.headers['cookie']);
    if (presented) await this.auth.logout(presented);
    reply.header('set-cookie', clearedRefreshCookie());
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
  @AuthLimited()
  @Post('totp/setup')
  @ApiOperation({ summary: 'بدء تهيئة التحقق الثنائي — أو تغيير الجهاز بكلمة المرور ورمز حالي' })
  beginTotp(@CurrentActor() actor: Actor, @Body() dto: TotpSetupDto, @Req() req: RawReq) {
    return this.auth.beginTotpSetup(
      actor.userId,
      { password: dto?.password, code: dto?.code },
      AuthController.meta(req),
    );
  }

  @ApiBearerAuth()
  @AllowLimited()
  @AuthLimited()
  @Post('totp/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تأكيد التهيئة — يُعيد رموز الاستعادة مرة واحدة ويُبطل الجلسات السابقة' })
  confirmTotp(
    @CurrentActor() actor: Actor,
    @Body() dto: TotpConfirmDto,
    @Req() req: RawReq,
  ): Promise<{ recoveryCodes: string[] }> {
    return this.auth.confirmTotpSetup(actor.userId, dto.token, AuthController.meta(req));
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
