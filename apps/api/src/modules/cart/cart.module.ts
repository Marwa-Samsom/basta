import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/public';
import { CartController } from './api/cart.controller';
import { CartService } from './application/cart.service';

@Module({
  imports: [PricingModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
