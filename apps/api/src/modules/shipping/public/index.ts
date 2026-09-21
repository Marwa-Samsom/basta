/** الواجهة العامة لوحدة الشحن — ADR-002 و ADR-008 */
export { ShippingModule } from '../shipping.module';
export { TrackingService } from '../application/tracking.service';
export { TRACKING_LABELS, type TrackingCode, type CarrierProvider, type Waybill } from '../domain/carrier';
