import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InvalidInputError } from '../../../common/errors/domain-error';
import type { Actor } from '../../../common/security/actor';
import { CurrentActor, RequirePermission, Roles } from '../../../common/security/decorators';
import { VendorOnboardingService, type OnboardingView } from '../application/vendor-onboarding.service';
import { VendorReviewService } from '../application/vendor-review.service';
import { DOCUMENT_MAX_BYTES, DocumentRejectedError } from '../domain/onboarding';
import {
  ApplyVendorDto,
  BankAccountDto,
  DocumentDecisionDto,
  RejectVendorDto,
  ReviewQueueQueryDto,
  SettlementCurrencyDto,
  SuspendVendorDto,
  UpdateShopDto,
  UpdateStoreProfileDto,
} from './dto/vendors.dto';
import { scopeOf, uuidParam } from './scope';

/** يقرأ ملف الوثيقة من طلب multipart بحدّ حجم المسار. */
async function readDocumentFile(
  req: FastifyRequest,
): Promise<{ buffer: Buffer; fileName: string | null; fields: Record<string, string> }> {
  let part: MultipartFile | undefined;
  try {
    part = await req.file({ limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1, fields: 10 } });
  } catch {
    throw new InvalidInputError('الطلب ليس multipart/form-data صالحاً. أرفق الملف في الحقل file.');
  }
  if (!part) throw new InvalidInputError('أرفق ملفاً في الحقل file.');

  let buffer: Buffer;
  try {
    buffer = await part.toBuffer();
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new DocumentRejectedError(
        `حجم الملف يتجاوز ${DOCUMENT_MAX_BYTES / (1024 * 1024)} ميغابايت.`,
      );
    }
    throw err;
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(part.fields ?? {})) {
    const field = Array.isArray(value) ? value[0] : value;
    if (field && 'value' in field && typeof field.value === 'string') fields[key] = field.value;
  }
  return { buffer, fileName: part.filename ?? null, fields };
}

/**
 * تسجيل البائع وتأهيله — VD-01 إلى VD-05.
 *
 * التقديم متاح لأي مستخدم مسجَّل: العميل الذي يقرّر البيع يصير بائعاً بطلب
 * واحد، لا بحساب ثانٍ. أما بقية المسارات فتتطلب متجراً قائماً (نطاق بائع).
 */
@ApiTags('vendor-onboarding')
@ApiBearerAuth()
@Controller('vendor/onboarding')
export class VendorOnboardingController {
  constructor(private readonly onboarding: VendorOnboardingService) {}

  /** يعيد رمزاً جديداً مع المتجر: الرمز القديم لا يحمل دور البائع بعد. */
  @Post('apply')
  @ApiOperation({ summary: 'تسجيل متجر جديد على الحساب الحالي — VD-01' })
  apply(
    @CurrentActor() actor: Actor,
    @Body() dto: ApplyVendorDto,
    @Req() req: FastifyRequest,
  ) {
    return this.onboarding.apply(actor, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('slug-available')
  @ApiOperation({ summary: 'توفّر رابط المتجر أثناء الكتابة — VD-01' })
  checkSlug(@Query('value') value: string) {
    if (!value) throw new InvalidInputError('أرسل الرابط في المعامل value.');
    return this.onboarding.checkSlug(value);
  }

  @Get()
  @ApiOperation({ summary: 'حالة التأهيل والموانع مجتمعةً — VD-02 و VD-03' })
  mine(@CurrentActor() actor: Actor): Promise<OnboardingView> {
    return this.onboarding.mine(actor);
  }

  @Patch('shop')
  @Roles('vendor_owner')
  @ApiOperation({ summary: 'تعديل بيانات المتجر قبل الاعتماد — VD-01' })
  updateShop(@CurrentActor() actor: Actor, @Body() dto: UpdateShopDto): Promise<OnboardingView> {
    return this.onboarding.updateShop(scopeOf(actor), dto);
  }

  @Put('bank')
  @Roles('vendor_owner')
  @ApiOperation({ summary: 'حساب استلام المستحقات — VD-02' })
  saveBank(@CurrentActor() actor: Actor, @Body() dto: BankAccountDto): Promise<OnboardingView> {
    return this.onboarding.saveBank(scopeOf(actor), dto);
  }

  @Post('documents/:type')
  @Roles('vendor_owner')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'رفع وثيقة (PDF أو صورة) — VD-02' })
  async uploadDocument(
    @CurrentActor() actor: Actor,
    @Param('type') type: string,
    @Req() req: FastifyRequest,
  ): Promise<OnboardingView> {
    const { buffer, fileName } = await readDocumentFile(req);
    return this.onboarding.uploadDocument(scopeOf(actor), type, buffer, fileName);
  }

  @Get('documents/:id')
  @Roles('vendor_owner', 'vendor_staff')
  @ApiOperation({ summary: 'تنزيل وثيقة — مصادَق، لا رابط عام' })
  async downloadDocument(
    @CurrentActor() actor: Actor,
    @Param('id', uuidParam) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.onboarding.readDocument(scopeOf(actor), id);
    await sendDocument(reply, file);
  }

  @Put('settlement-currency')
  @Roles('vendor_owner')
  @ApiOperation({ summary: 'عملة التسعير والتحصيل — VD-04 (تثبيتها لا رجعة فيه)' })
  setCurrency(
    @CurrentActor() actor: Actor,
    @Body() dto: SettlementCurrencyDto,
  ): Promise<OnboardingView> {
    return this.onboarding.setSettlementCurrency(scopeOf(actor), dto.currency, {
      lock: dto.lock ?? false,
    });
  }

  @Patch('profile')
  @Roles('vendor_owner')
  @ApiOperation({ summary: 'ملف المتجر: الوصف والسياسات — VD-05' })
  updateProfile(
    @CurrentActor() actor: Actor,
    @Body() dto: UpdateStoreProfileDto,
  ): Promise<OnboardingView> {
    return this.onboarding.updateProfile(scopeOf(actor), dto);
  }

  @Post('submit')
  @Roles('vendor_owner')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إرسال الطلب للمراجعة — VD-02 → VD-03' })
  submit(@CurrentActor() actor: Actor, @Req() req: FastifyRequest): Promise<OnboardingView> {
    return this.onboarding.submit(scopeOf(actor), { ip: req.ip });
  }
}

/**
 * مراجعة طلبات البائعين — AD-04 و AD-05.
 * صلاحية `vendors.review` تفصل المراجع عن بقية الإدارة: مدير التسويق
 * لا يعتمد متاجر لأنه يملك لوحة الإدارة.
 */
@ApiTags('admin-vendors')
@ApiBearerAuth()
@Roles('admin')
@RequirePermission('vendors.review')
@Controller('admin/vendors')
export class AdminVendorsController {
  constructor(
    private readonly review: VendorReviewService,
    private readonly onboarding: VendorOnboardingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'طابور المراجعة، الأقدم أولاً — AD-04' })
  queue(@Query() query: ReviewQueueQueryDto) {
    return this.review.queue({
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit ? { limit: Number(query.limit) } : {}),
      ...(query.offset ? { offset: Number(query.offset) } : {}),
      ...(query.search?.trim() ? { search: query.search.trim() } : {}),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'ملف بائع كاملاً بوثائقه وموانعه — AD-05' })
  get(@Param('id', uuidParam) id: string): Promise<OnboardingView> {
    return this.onboarding.view(id);
  }

  @Get(':id/documents/:documentId')
  @ApiOperation({ summary: 'فتح وثيقة البائع للمراجعة' })
  async document(
    @CurrentActor() actor: Actor,
    @Param('id', uuidParam) id: string,
    @Param('documentId', uuidParam) documentId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.onboarding.readDocument(scopeOf(actor, id), documentId);
    await sendDocument(reply, file);
  }

  @Post(':id/documents/:documentId/decision')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'قبول وثيقة أو رفضها بسبب مكتوب' })
  decide(
    @CurrentActor() actor: Actor,
    @Param('documentId', uuidParam) documentId: string,
    @Body() dto: DocumentDecisionDto,
  ): Promise<void> {
    return this.review.decideDocument(actor, documentId, {
      accept: dto.accept,
      reason: dto.reason ?? null,
    });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'اعتماد المتجر فيبدأ البيع' })
  approve(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string): Promise<void> {
    return this.review.approve(actor, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'رفض الطلب بسبب يقرأه البائع ويصلح عليه' })
  reject(
    @CurrentActor() actor: Actor,
    @Param('id', uuidParam) id: string,
    @Body() dto: RejectVendorDto,
  ): Promise<void> {
    return this.review.reject(actor, id, dto.reason);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'تعليق متجر: يتوقف بيعه فوراً' })
  suspend(
    @CurrentActor() actor: Actor,
    @Param('id', uuidParam) id: string,
    @Body() dto: SuspendVendorDto,
  ): Promise<void> {
    return this.review.suspend(actor, id, dto.reason);
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'رفع التعليق' })
  reinstate(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string): Promise<void> {
    return this.review.reinstate(actor, id);
  }
}

/**
 * الوثيقة تُرسَل بترويسات تمنع المتصفّح من تفسيرها كصفحة:
 * ملف يرفعه غريب ويُفتح في نطاق لوحة الإدارة ناقل XSS جاهز.
 */
async function sendDocument(
  reply: FastifyReply,
  file: { buffer: Buffer; mimeType: string; fileName: string },
): Promise<void> {
  await reply
    .header('Content-Type', file.mimeType)
    .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('Cache-Control', 'private, no-store')
    .send(file.buffer);
}
