/**
 * شركة الشحن مجرّدة كبوابة الدفع (ADR-008 + ADR-012): واجهة واحدة، ومزوّد
 * وهمي محلي الآن، وأرامكس أو غيرها لاحقاً بلا مساس بالطلبات.
 */

export type TrackingCode = 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed';

export const TRACKING_LABELS: Readonly<Record<TrackingCode, string>> = Object.freeze({
  picked_up: 'استلمت شركة الشحن الطرد',
  in_transit: 'في الطريق',
  out_for_delivery: 'خرج للتوصيل',
  delivered: 'تم التسليم',
  failed: 'تعذّر التوصيل',
});

/** ترتيب المسار: الحدث لا يعود للخلف (إشعار متأخر لا يلغي تسليماً) */
export const TRACKING_ORDER: readonly TrackingCode[] = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'];

export interface Waybill {
  readonly carrierCode: string;
  readonly trackingNumber: string;
  readonly labelText: string;
}

export interface CarrierProvider {
  readonly code: string;
  readonly nameAr: string;
  createWaybill(input: { subOrderNumber: string; recipient: string; city: string }): Promise<Waybill>;
}

/**
 * رمز حقن شركة الشحن الموصولة — أو `null` حين لا شركة (SHIPPING_CARRIER=none):
 * التوصيل ذاتي وحده، ولا بوليصة، ولا مهمة تتبّع تعلّم شيئاً مستلَماً.
 */
export const CARRIER = Symbol('CARRIER');

/** رمز التوصيل الذاتي — مرجع يكتبه البائع لنفسه، لا شركة وراءه */
export const SELF_DELIVERY = 'self';

/** الحدث التالي في المسار أو null إن وصل النهاية */
export function nextCode(current: TrackingCode | null): TrackingCode | null {
  if (current === 'delivered' || current === 'failed') return null;
  const i = current ? TRACKING_ORDER.indexOf(current) : -1;
  return TRACKING_ORDER[i + 1] ?? null;
}
