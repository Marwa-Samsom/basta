import { LatinDigits } from '../../../common/digits';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { pageOf, termOf } from '../../../common/paging';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor } from '../../../common/security/actor';
import { CurrentActor, MaybeActor, OptionalAuth, Public, RequirePermission, Roles } from '../../../common/security/decorators';
import {
  PAYMENT_PROVIDER,
  PaymentEventsService,
  TransferDetailsService,
  type PaymentProvider,
} from '../../payments/public';
import { CartService } from '../../cart/public';
import { CheckoutService } from '../application/checkout.service';
import { TransferQueueService } from '../application/transfer-queue.service';
import { NormalizeEmail } from '../../../common/email';
import { guestOrderKeyMatches } from '../domain/snapshot';
import { loadEnv } from '../../../common/config/env';

export class AddressDto {
  @IsString()
  @Length(2, 120)
  recipientName!: string;

  @Matches(/^\+?[0-9 ]{7,20}$/, { message: 'رقم الهاتف غير صالح.' })
  @LatinDigits()
  phone!: string;

  @Matches(/^[A-Za-z]{2}$/, { message: 'البلد برمز من حرفين.' })
  country!: string;

  @IsString()
  @Length(1, 80)
  region!: string;

  @IsString()
  @Length(1, 80)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  area?: string;

  @IsString()
  @Length(2, 200)
  street!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;
}

export class PlaceOrderDto {
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  /** رمز وسيلة الدفع من نموذج المزوّد — لا رقم بطاقة يمرّ بخادمنا */
  @IsString()
  @Length(3, 120)
  paymentToken!: string;

  /**
   * الإجمالي الذي رآه المشتري تحت «ادفع» — بالوحدات الصغرى وعملته، كما أعاده
   * /checkout/quote. الخادم يعيد التسعير ولا يخصم مبلغاً غيره (409، reason TOTAL_CHANGED).
   */
  @Matches(/^[0-9]{1,19}$/, { message: 'أرسل الإجمالي الذي رأيته قبل الدفع.' })
  expectedTotal!: string;

  @Matches(/^[A-Z]{3}$/, { message: 'أرسل عملة الإجمالي الذي رأيته.' })
  expectedCurrency!: string;

  /** لا يُستعمل: الشراء بحساب (place). يبقى مقبولاً كي لا يرتدّ 400 من نسخة واجهة قديمة في متصفّح */
  @IsOptional()
  @NormalizeEmail()
  @IsEmail({}, { message: 'البريد غير صالح.' })
  guestEmail?: string;

  @IsOptional()
  @Matches(/^\+?[0-9 ]{7,20}$/)
  @LatinDigits()
  guestPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ConfirmTransferDto {
  /** المرجع كما في كشف البنك أو إشعار كليك — به يُعرف التحويل عند أي مراجعة */
  @IsString()
  @Length(3, 80, { message: 'اكتب مرجع التحويل كما في كشف البنك (3 أحرف على الأقل).' })
  reference!: string;

  /** المبلغ الذي وصل بالوحدات الصغرى — يُطابَق بمبلغ الطلب، فلا يُؤكَّد طلبٌ بتحويل غيره */
  @Matches(/^[0-9]{1,19}$/, { message: 'اكتب المبلغ الذي وصل.' })
  receivedMinorUnits!: string;

  /** اسم المحوِّل أو حسابه — إليه يُردّ المال إن أُلغي شيء لاحقاً */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class QuoteDto {
  @Matches(/^[A-Za-z]{2}$/)
  country!: string;

  @IsString()
  @Length(1, 80)
  region!: string;

  @IsString()
  @Length(1, 80)
  city!: string;
}

/**
 * إتمام الشراء — ST-15.
 * مفتاح عدم التكرار في الترويسة `idempotency-key` كما تطلبه البوابات الحقيقية.
 * التسعير مفتوح للضيف (يرى الشحن قبل أن يدخل)، و«ادفع» لصاحب حساب وحده.
 */
@ApiTags('checkout')
@OptionalAuth()
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly carts: CartService,
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly transfers: TransferDetailsService,
  ) {}

  /**
   * كيف يدفع المشتري — تعرضه صفحة الدفع قبل «ادفع». بيانات الحساب لا تُكشف هنا: تظهر
   * لصاحب الطلب بعد أن يحجزه (result)، لا لكل زائر.
   */
  @Get('payment-method')
  async paymentMethod() {
    if (this.provider.method !== 'bank_transfer') return { method: this.provider.method };
    const d = await this.transfers.read();
    return { method: this.provider.method, windowHours: d.windowHours, ready: d.ready, cliq: d.cliqAlias !== null };
  }

  /** تسعير بالعنوان: الشحن لكل بائع والضريبة ببلد المشتري — قبل «ادفع» */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(@Headers('x-cart-token') cartToken: string | undefined, @Body() dto: QuoteDto) {
    if (!cartToken) throw new InvalidInputError('أرسل رمز السلة في الترويسة x-cart-token.');
    return this.carts.view(cartToken, { country: dto.country.toUpperCase(), region: dto.region, city: dto.city });
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ادفع — حجز ثم دفع ثم تقسيم عند النجاح' })
  place(
    @Headers('x-cart-token') cartToken: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PlaceOrderDto,
    @MaybeActor() actor: Actor | null,
  ) {
    /**
     * الشراء بحساب — محسوم 13 أكتوبر 2026. طلب الضيف لا يُتابَع ولا يُلغى ولا يُرجَع ولا
     * يُراسَل فيه البائع، والبريد الذي يحمل رابطه لا يصل بعد — فيبقى المال عالقاً بلا
     * صاحب يُعرف. صاحب الحساب يجد كل ذلك في صفحة طلباته. والسلة برمزها لا بالحساب،
     * فتبقى كما هي بعد الدخول. طلبات الضيف القديمة تُقرأ بمفتاحها كما كانت (status).
     */
    if (!actor) throw new UnauthorizedException('سجّل دخولك أو أنشئ حساباً لتكمل الشراء — سلّتك محفوظة كما هي.');
    if (!cartToken) throw new InvalidInputError('أرسل رمز السلة في الترويسة x-cart-token.');
    if (!idempotencyKey) throw new InvalidInputError('أرسل مفتاح عدم التكرار في الترويسة idempotency-key.');
    return this.checkout.place({
      cartToken,
      idempotencyKey,
      address: dto.address,
      paymentToken: dto.paymentToken,
      expected: { total: BigInt(dto.expectedTotal), currency: dto.expectedCurrency },
      userId: actor.userId,
      note: dto.note ?? null,
    });
  }

  /**
   * حالة الطلب بعد الدفع — ST-16 و ST-17. تُسأل بعد انقطاع الاتصال: إن كانت
   * «pending» تُطلب المصالحة، فيعرف المشتري النتيجة لا يدفع ثانيةً.
   */
  @Get('orders/:orderNumber')
  async status(
    @Param('orderNumber') orderNumber: string,
    @MaybeActor() actor: Actor | null,
    @Headers('x-order-key') accessKey: string | undefined,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true, status: true, customerUserId: true },
    });
    // رقم الطلب ليس سرّاً: طلب مسجَّل لصاحبه وحده، وطلب الضيف بمفتاحه — وإلا 404
    // كأنه غير موجود، والمصالحة (نداء للبوابة) لا تُطلق قبل الإذن
    const allowed = order
      ? order.customerUserId
        ? order.customerUserId === actor?.userId
        : guestOrderKeyMatches(order.id, loadEnv().jwtAccessSecret, accessKey)
      : false;
    if (!order || !allowed) {
      throw new NotFoundError('الطلب غير موجود.', {});
    }
    if (order.status === 'pending_payment') await this.checkout.reconcile(order.id);
    return this.checkout.result(order.id);
  }

  /** إلغاء طلب ينتظر التحويل قبل أن يحوّل — قطعه تعود فوراً لا بعد انقضاء المهلة */
  @Post('orders/:orderNumber/cancel')
  @HttpCode(HttpStatus.OK)
  cancelAwaiting(@Param('orderNumber') orderNumber: string, @MaybeActor() actor: Actor | null) {
    if (!actor) throw new UnauthorizedException('سجّل دخولك لتلغي طلبك.');
    return this.checkout.cancelAwaitingTransfer(orderNumber, actor.userId);
  }
}

/**
 * التحويلات الواردة — الإدارة تطابق كشف البنك بالطلبات وتؤكّد ما وصل. صلاحية السحوبات
 * نفسها: كلاهما يحرّك مالاً، والتأكيد يُنشئ رصيداً للبائعين.
 */
@ApiTags('admin-payments')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/payments/transfers')
export class AdminTransfersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly queue: TransferQueueService,
  ) {}

  @Get()
  @RequirePermission('payouts.approve')
  list(@Query('search') search?: string, @Query('page') page?: string) {
    const term = termOf(search);
    return this.queue.waiting({ ...(term ? { search: term } : {}), page: pageOf(page) });
  }

  @Get('confirmed')
  @RequirePermission('payouts.approve')
  confirmed(@Query('search') search?: string, @Query('page') page?: string) {
    const term = termOf(search);
    return this.queue.confirmed({ ...(term ? { search: term } : {}), page: pageOf(page) });
  }

  @Post(':orderNumber/confirm')
  @RequirePermission('payouts.approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'وصل التحويل — بمرجعه ومبلغه، فيُقسَّم الطلب ويصل المتاجر' })
  confirm(@CurrentActor() actor: Actor, @Param('orderNumber') orderNumber: string, @Body() dto: ConfirmTransferDto) {
    return this.checkout.confirmTransfer(orderNumber, actor.userId, {
      reference: dto.reference,
      note: dto.note ?? null,
      receivedMinor: BigInt(dto.receivedMinorUnits),
    });
  }
}

/**
 * إشعارات البوابة — ADR-011. عامّ لأن البوابة لا تحمل رمزنا، والتوقيع هو
 * المصادقة: إشعار بتوقيع خاطئ يُرفض قبل أي أثر.
 *
 * التكرار يُحسم بالقيد الفريد على (provider, providerEventId): الإشعار
 * الثاني يسمع 200 (فلا تعيد البوابة الإرسال) ولا يُعالَج.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentWebhookController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly events: PaymentEventsService,
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Public()
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إشعار البوابة — موقَّع وعديم الأثر عند التكرار' })
  async webhook(
    @Param('provider') providerName: string,
    @Headers('x-signature') signature: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    if (providerName !== this.provider.name) throw new NotFoundError('مزوّد غير معروف.', {});

    // المزوّد الوهمي يوقّع JSON.stringify؛ البوابة الحقيقية تحتاج الجسم الخام كما وصل
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const event = this.provider.parseWebhook(raw, signature);

    const payment = await this.prisma.payment.findFirst({
      where: { orderId: event.orderId },
      select: { id: true, amountMinorUnits: true, currency: true },
    });
    if (!payment) throw new NotFoundError('طلب غير معروف في الإشعار.', {});

    const fresh = await this.events.record(this.provider.name, event, payment.id);
    if (!fresh) return { received: true, duplicate: true };

    // إشعار بمبلغ غير مبلغ الطلب لا يُعتمد: لا نشحن 100 دينار مقابل دينار
    if (event.amountMinor !== payment.amountMinorUnits || event.currency !== payment.currency) {
      await this.checkout.markFailed(event.orderId, 'amount_mismatch', 'مبلغ الإشعار لا يطابق الطلب.');
      return { received: true, rejected: 'amount_mismatch' };
    }

    await this.checkout.apply(
      event.orderId,
      event.type === 'payment.captured'
        ? { status: 'captured', intentId: event.intentId }
        : { status: 'failed', intentId: event.intentId, code: event.failureCode ?? 'failed', message: 'رفضت البوابة الدفع.' },
    );
    await this.events.markProcessed(this.provider.name, event.eventId);
    return { received: true };
  }
}

