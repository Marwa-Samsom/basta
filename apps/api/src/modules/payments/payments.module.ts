import { Module } from '@nestjs/common';
import { loadEnv } from '../../common/config/env';
import { PaymentEventsService } from './application/payment-events.service';
import { TransferDetailsService } from './application/transfer-details.service';
import type { PaymentProvider } from './domain/provider';
import { FakePaymentProvider } from './infrastructure/fake-provider';
import { ManualTransferProvider } from './infrastructure/manual-transfer-provider';

/** الرمز الذي يُحقن به المزوّد — تبديل البوابة الحقيقية سطر واحد هنا (ADR-012) */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

@Module({
  providers: [
    // المزوّد من PAYMENT_PROVIDER: الوهمي يُبنى في التطوير وحده (ومنشئه يسقط في الإنتاج)،
    // فلا يُنشأ أصلاً حين يُختار غيره — والاختبارات تصل إليه بصنفه لتصنع الفشل
    {
      provide: FakePaymentProvider,
      useFactory: (): FakePaymentProvider | null => (loadEnv().paymentProvider === 'fake' ? new FakePaymentProvider() : null),
    },
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (fake: FakePaymentProvider | null): PaymentProvider => fake ?? new ManualTransferProvider(),
      inject: [FakePaymentProvider],
    },
    PaymentEventsService,
    TransferDetailsService,
  ],
  exports: [PAYMENT_PROVIDER, FakePaymentProvider, PaymentEventsService, TransferDetailsService],
})
export class PaymentsModule {}
