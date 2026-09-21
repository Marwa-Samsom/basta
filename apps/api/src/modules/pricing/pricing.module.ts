import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/public';
import { PricingService } from './application/pricing.service';

@Module({
  imports: [InventoryModule],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
