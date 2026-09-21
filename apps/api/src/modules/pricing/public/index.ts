/**
 * الواجهة العامة لوحدة التسعير — ADR-002.
 * النواة الصافية (priceCart) والخدمة التي تحمّل مدخلاتها من القاعدة.
 */
export { PricingModule } from '../pricing.module';
export { PricingService, type Quote, type QuoteAddress, type QuoteInput } from '../application/pricing.service';
export {
  allocate,
  priceCart,
  type Breakdown,
  type PricedCart,
  type PricedLine,
  type PricedSubOrder,
} from '../domain/pricing';
