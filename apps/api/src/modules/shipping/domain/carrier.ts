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

/**
 * أحداث المحاولة الجارية. شحنة «تعذّر توصيلها» ثم شُحنت من جديد تبدأ مسارها من أوله: ما قبل آخر
 * «تعذّر» تاريخ يبقى في طلب المشتري، لا يُحسب في التقدّم ولا يُعرض للرقم الجديد. كانت الأحداث القديمة
 * وآخرها «تعذّر» تُوقف المهمة عن الشحنة المعادة أبداً (VOPS-035، 29 أكتوبر 2026).
 * قبل إعادة الشحن المحاولة الجارية هي الفاشلة نفسها، فتبقى كلها.
 */
export function currentAttempt<T extends { code: string; occurredAt: Date }>(events: readonly T[], shippedAt: Date | null): T[] {
  const failedAt = Math.max(-Infinity, ...events.filter((e) => e.code === 'failed').map((e) => e.occurredAt.getTime()));
  const reshipped = shippedAt !== null && shippedAt.getTime() > failedAt;
  if (failedAt === -Infinity || !reshipped) return [...events];
  return events.filter((e) => e.occurredAt.getTime() > failedAt);
}
