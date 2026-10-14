import { Module } from '@nestjs/common';
import { CartModule } from '../cart/public';
import { FinanceModule } from '../finance/public';
import { NotificationsModule } from '../notifications/public';
import { InventoryModule } from '../inventory/public';
import { PaymentsModule } from '../payments/public';
import { PricingModule } from '../pricing/public';
import { AdminTransfersController, CheckoutController, PaymentWebhookController } from './api/checkout.controllers';
import { CheckoutService } from './application/checkout.service';
import { PaymentReconciler } from './application/payment-reconciler';
import { TransferQueueService } from './application/transfer-queue.service';

@Module({
  imports: [CartModule, PricingModule, InventoryModule, PaymentsModule, FinanceModule, NotificationsModule],
  controllers: [CheckoutController, PaymentWebhookController, AdminTransfersController],
  providers: [CheckoutService, PaymentReconciler, TransferQueueService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
