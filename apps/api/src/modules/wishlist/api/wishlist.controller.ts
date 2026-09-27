import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../common/security/actor';
import { CurrentActor } from '../../../common/security/decorators';
import { WishlistService } from '../application/wishlist.service';

const productParam = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('المنتج غير موجود أو لم يعد معروضاً.'),
});

/**
 * ST-23 — مفضّلة المستخدم الداخل. لا مسار يأخذ معرّف مستخدم: المالك هو
 * الفاعل دائماً. الإضافة `PUT` لأنها عديمة الأثر عند التكرار، والإزالة كذلك.
 */
@ApiTags('my-wishlist')
@ApiBearerAuth()
@Controller('me/wishlist')
export class MyWishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  @ApiOperation({ summary: 'المحفوظ، الأحدث أولاً، بسعره الآن وسعره لحظة الحفظ وحالته' })
  list(@CurrentActor() a: Actor) {
    return this.wishlist.list(a.userId);
  }

  @Get('ids')
  @ApiOperation({ summary: 'معرّفات المحفوظ وحدها — لحالة القلوب في الصفحة' })
  async ids(@CurrentActor() a: Actor) {
    return { ids: await this.wishlist.ids(a.userId) };
  }

  @Put(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'احفظ — التكرار لا يغيّر السعر المحفوظ' })
  add(@CurrentActor() a: Actor, @Param('productId', productParam) productId: string) {
    return this.wishlist.add(a.userId, productId);
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentActor() a: Actor, @Param('productId', productParam) productId: string) {
    return this.wishlist.remove(a.userId, productId);
  }
}
