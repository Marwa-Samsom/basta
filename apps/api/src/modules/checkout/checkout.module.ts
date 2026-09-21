import { Module } from '@nestjs/common';
import { CartModule } from '../cart/public';
import { InventoryModule } from '../inventory/public';
import { PaymentsModule } from '../payments/public';
import { PricingModule } from '../pricing/public';
import { CheckoutController, PaymentWebhookController } from './api/checkout.controllers';
import { CheckoutService } from './application/checkout.service';
import { PaymentReconciler } from './application/payment-reconciler';

@Module({
  imports: [CartModule, PricingModule, InventoryModule, PaymentsModule],
  controllers: [CheckoutController, PaymentWebhookController],
  providers: [CheckoutService, PaymentReconciler],
  exports: [CheckoutService],
})
export class CheckoutModule {}
