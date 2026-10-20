/**
 * الواجهة العامة لوحدة التسعير — ADR-002.
 * النواة الصافية (priceCart) والخدمة التي تحمّل مدخلاتها من القاعدة.
 */
export { PricingModule } from '../pricing.module';
export { PricingService, type Quote, type QuoteAddress, type QuoteInput } from '../application/pricing.service';
export { DisplayCurrencyService, type CurrencyOption, type DisplayFx } from '../application/display-currency.service';
export {
  allocate,
  convertMinor,
  priceCart,
  type Breakdown,
  type PricedCart,
  type PricedLine,
  type PricedSubOrder,
} from '../domain/pricing';
