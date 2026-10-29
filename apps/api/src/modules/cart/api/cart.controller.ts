import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { InvalidInputError } from '../../../common/errors/domain-error';
import type { Actor } from '../../../common/security/actor';
import { MaybeActor, OptionalAuth } from '../../../common/security/decorators';
import { CartService, MAX_QTY_PER_LINE } from '../application/cart.service';

/** الشكل هنا، والإتاحة في الخدمة: المفعّلة التي لها سعر صرف نافذ (عملة العرض) */
const CURRENCY = /^[A-Za-z]{3}$/;

export class CreateCartDto {
  @Matches(CURRENCY, { message: 'عملة غير مدعومة.' })
  currency!: string;
}

export class AddItemDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_QTY_PER_LINE)
  qty!: number;
}

export class SetQtyDto {
  @IsInt()
  @Min(0)
  @Max(MAX_QTY_PER_LINE)
  qty!: number;
}

export class CouponDto {
  @IsOptional()
  @IsString()
  @Length(0, 40)
  code?: string;
}

export class CurrencyDto {
  @Matches(CURRENCY, { message: 'عملة غير مدعومة.' })
  currency!: string;
}

/**
 * السلة — ST-13 و ST-14. مفتوحة للضيف، والرمز في ترويسة `x-cart-token`
 * لا في العنوان: رمز في العنوان يتسرّب في سجلات الخوادم وترويسة Referer.
 */
@ApiTags('cart')
@OptionalAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly carts: CartService) {}

  private static token(value: string | undefined): string {
    if (!value) throw new InvalidInputError('أرسل رمز السلة في الترويسة x-cart-token.');
    return value;
  }

  @Post()
  @ApiOperation({ summary: 'سلة جديدة — تعيد رمزها' })
  create(@Body() dto: CreateCartDto, @MaybeActor() actor: Actor | null) {
    return this.carts.create(dto.currency, actor?.userId ?? null);
  }

  @Get()
  @ApiOperation({ summary: 'السلة مسعّرة ومقسّمة حسب البائع' })
  get(@Headers('x-cart-token') token: string | undefined, @MaybeActor() actor: Actor | null) {
    return this.carts.view(CartController.token(token), null, actor?.userId ?? null);
  }

  @Post('items')
  add(@Headers('x-cart-token') token: string | undefined, @Body() dto: AddItemDto, @MaybeActor() actor: Actor | null) {
    return this.carts.addItem(CartController.token(token), dto.variantId, dto.qty, actor?.userId ?? null);
  }

  @Patch('items/:variantId')
  setQty(
    @Headers('x-cart-token') token: string | undefined,
    @Param('variantId') variantId: string,
    @Body() dto: SetQtyDto,
    @MaybeActor() actor: Actor | null,
  ) {
    return this.carts.setQty(CartController.token(token), variantId, dto.qty, actor?.userId ?? null);
  }

  @Delete('items/:variantId')
  remove(
    @Headers('x-cart-token') token: string | undefined,
    @Param('variantId') variantId: string,
    @MaybeActor() actor: Actor | null,
  ) {
    return this.carts.setQty(CartController.token(token), variantId, 0, actor?.userId ?? null);
  }

  @Put('coupon')
  coupon(@Headers('x-cart-token') token: string | undefined, @Body() dto: CouponDto, @MaybeActor() actor: Actor | null) {
    return this.carts.setCoupon(CartController.token(token), dto.code ?? null, actor?.userId ?? null);
  }

  @Put('currency')
  currency(@Headers('x-cart-token') token: string | undefined, @Body() dto: CurrencyDto, @MaybeActor() actor: Actor | null) {
    return this.carts.setCurrency(CartController.token(token), dto.currency, actor?.userId ?? null);
  }
}
