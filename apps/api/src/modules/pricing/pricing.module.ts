import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/public';
import { DisplayCurrencyService } from './application/display-currency.service';
import { PricingService } from './application/pricing.service';

@Module({
  imports: [InventoryModule],
  providers: [PricingService, DisplayCurrencyService],
  exports: [PricingService, DisplayCurrencyService],
})
export class PricingModule {}
