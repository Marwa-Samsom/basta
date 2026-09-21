import { Module } from '@nestjs/common';
import { PaymentEventsService } from './application/payment-events.service';
import { FakePaymentProvider } from './infrastructure/fake-provider';

/** الرمز الذي يُحقن به المزوّد — تبديل البوابة الحقيقية سطر واحد هنا (ADR-012) */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

@Module({
  providers: [
    FakePaymentProvider,
    { provide: PAYMENT_PROVIDER, useExisting: FakePaymentProvider },
    PaymentEventsService,
  ],
  exports: [PAYMENT_PROVIDER, FakePaymentProvider, PaymentEventsService],
})
export class PaymentsModule {}
