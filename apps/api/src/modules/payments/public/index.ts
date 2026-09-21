/**
 * الواجهة العامة لوحدة الدفع — ADR-002 و ADR-012.
 * خارج هذه الوحدة لا يُعرف اسم مزوّد: يُحقن بالرمز `PAYMENT_PROVIDER`.
 */
export { PaymentsModule, PAYMENT_PROVIDER } from '../payments.module';
export { PaymentEventsService } from '../application/payment-events.service';
export { FakePaymentProvider } from '../infrastructure/fake-provider';
export type {
  ChargeOutcome,
  ChargeRequest,
  PaymentProvider,
  ProviderEvent,
} from '../domain/provider';
