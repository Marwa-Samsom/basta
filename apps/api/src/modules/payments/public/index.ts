/**
 * الواجهة العامة لوحدة الدفع — ADR-002 و ADR-012.
 * خارج هذه الوحدة لا يُعرف اسم مزوّد: يُحقن بالرمز `PAYMENT_PROVIDER`.
 */
export { PaymentsModule, PAYMENT_PROVIDER } from '../payments.module';
export { PaymentEventsService } from '../application/payment-events.service';
export {
  TransferDetailsService,
  DEFAULT_TRANSFER_WINDOW_HOURS,
  type TransferDetails,
} from '../application/transfer-details.service';
export { FakePaymentProvider } from '../infrastructure/fake-provider';
export { ManualTransferProvider, BANK_TRANSFER_TOKEN } from '../infrastructure/manual-transfer-provider';
export type {
  ChargeOutcome,
  ChargeRequest,
  PaymentMethod,
  PaymentProvider,
  ProviderEvent,
  RefundOutcome,
} from '../domain/provider';
