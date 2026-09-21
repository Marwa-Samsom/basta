import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { InvalidInputError } from '../../../common/errors/domain-error';
import type { Actor } from '../../../common/security/actor';
import { MaybeActor, OptionalAuth } from '../../../common/security/decorators';
import { CartService, MAX_QTY_PER_LINE } from '../application/cart.service';

const CURRENCIES = ['USD', 'SAR', 'AED', 'JOD', 'KWD', 'EGP', 'EUR'];

export class CreateCartDto {
  @IsIn(CURRENCIES, { message: 'عملة غير مدعومة.' })
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
  @IsIn(CURRENCIES, { message: 'عملة غير مدعومة.' })
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
  get(@Headers('x-cart-token') token: string | undefined) {
    return this.carts.view(CartController.token(token));
  }

  @Post('items')
  add(@Headers('x-cart-token') token: string | undefined, @Body() dto: AddItemDto) {
    return this.carts.addItem(CartController.token(token), dto.variantId, dto.qty);
  }

  @Patch('items/:variantId')
  setQty(
    @Headers('x-cart-token') token: string | undefined,
    @Param('variantId') variantId: string,
    @Body() dto: SetQtyDto,
  ) {
    return this.carts.setQty(CartController.token(token), variantId, dto.qty);
  }

  @Delete('items/:variantId')
  remove(@Headers('x-cart-token') token: string | undefined, @Param('variantId') variantId: string) {
    return this.carts.setQty(CartController.token(token), variantId, 0);
  }

  @Put('coupon')
  coupon(@Headers('x-cart-token') token: string | undefined, @Body() dto: CouponDto) {
    return this.carts.setCoupon(CartController.token(token), dto.code ?? null);
  }

  @Put('currency')
  currency(@Headers('x-cart-token') token: string | undefined, @Body() dto: CurrencyDto) {
    return this.carts.setCurrency(CartController.token(token), dto.currency);
  }
}
