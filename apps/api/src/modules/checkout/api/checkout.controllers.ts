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
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor } from '../../../common/security/actor';
import { MaybeActor, OptionalAuth, Public } from '../../../common/security/decorators';
import {
  PAYMENT_PROVIDER,
  PaymentEventsService,
  type PaymentProvider,
} from '../../payments/public';
import { CartService } from '../../cart/public';
import { CheckoutService } from '../application/checkout.service';
import { NormalizeEmail } from '../../../common/email';

export class AddressDto {
  @IsString()
  @Length(2, 120)
  recipientName!: string;

  @Matches(/^\+?[0-9 ]{7,20}$/, { message: 'رقم الهاتف غير صالح.' })
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

  @IsOptional()
  @NormalizeEmail()
  @IsEmail({}, { message: 'البريد غير صالح.' })
  guestEmail?: string;

  @IsOptional()
  @Matches(/^\+?[0-9 ]{7,20}$/)
  guestPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
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
 * إتمام الشراء — ST-15. للضيف والمسجَّل.
 * مفتاح عدم التكرار في الترويسة `idempotency-key` كما تطلبه البوابات الحقيقية.
 */
@ApiTags('checkout')
@OptionalAuth()
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly carts: CartService,
    private readonly prisma: PrismaService,
  ) {}

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
    if (!cartToken) throw new InvalidInputError('أرسل رمز السلة في الترويسة x-cart-token.');
    if (!idempotencyKey) throw new InvalidInputError('أرسل مفتاح عدم التكرار في الترويسة idempotency-key.');
    return this.checkout.place({
      cartToken,
      idempotencyKey,
      address: dto.address,
      paymentToken: dto.paymentToken,
      expected: { total: BigInt(dto.expectedTotal), currency: dto.expectedCurrency },
      userId: actor?.userId ?? null,
      guestEmail: dto.guestEmail ?? null,
      guestPhone: dto.guestPhone ?? null,
      note: dto.note ?? null,
    });
  }

  /**
   * حالة الطلب بعد الدفع — ST-16 و ST-17. تُسأل بعد انقطاع الاتصال: إن كانت
   * «pending» تُطلب المصالحة، فيعرف المشتري النتيجة لا يدفع ثانيةً.
   */
  @Get('orders/:orderNumber')
  async status(@Param('orderNumber') orderNumber: string, @MaybeActor() actor: Actor | null) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true, status: true, customerUserId: true },
    });
    // رقم الطلب ليس سرّاً كافياً: طلب مسجَّل لا يُعرض لغير صاحبه
    if (!order || (order.customerUserId && order.customerUserId !== actor?.userId)) {
      throw new NotFoundError('الطلب غير موجود.', {});
    }
    if (order.status === 'pending_payment') await this.checkout.reconcile(order.id);
    return this.checkout.result(order.id);
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

