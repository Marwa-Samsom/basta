/**
 * أنواع الطلبات وتسمياتها في الواجهة. الحالات والأزرار تأتي من الخادم
 * (`actions` مشتقّة من آلة الحالات نفسها) — الواجهة لا تقرّر ما يُسمح.
 */
import { intlLocale, type Locale } from './i18n';
import { formatMoney } from './money';

export type SubOrderStatus =
  | 'awaiting_vendor'
  | 'accepted'
  | 'preparing'
  | 'ready_to_ship'
  | 'shipped'
  | 'delivery_failed'
  | 'delivered'
  | 'return_requested'
  | 'returned'
  | 'completed'
  | 'rejected_by_vendor'
  | 'canceled_by_customer'
  | 'canceled_by_admin'
  | 'refunded';

export const STATUS_LABEL: Record<SubOrderStatus, string> = {
  awaiting_vendor: 'بانتظار القبول',
  accepted: 'مقبول',
  preparing: 'قيد التجهيز',
  ready_to_ship: 'جاهز للشحن',
  shipped: 'تم الشحن',
  delivery_failed: 'تعذّر التوصيل',
  delivered: 'تم التسليم',
  return_requested: 'طلب إرجاع',
  returned: 'مُرجَع',
  completed: 'مكتمل',
  rejected_by_vendor: 'رفضه البائع',
  canceled_by_customer: 'ألغاه المشتري',
  canceled_by_admin: 'ألغته الإدارة',
  refunded: 'مُسترَد',
};

/** التسميات نفسها بالإنجليزية — المفاتيح نفسها */
export const STATUS_LABEL_EN: Record<SubOrderStatus, string> = {
  awaiting_vendor: 'Awaiting acceptance',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready_to_ship: 'Ready to ship',
  shipped: 'Shipped',
  delivery_failed: 'Delivery failed',
  delivered: 'Delivered',
  return_requested: 'Return requested',
  returned: 'Returned',
  completed: 'Completed',
  rejected_by_vendor: 'Rejected by seller',
  canceled_by_customer: 'Canceled by buyer',
  canceled_by_admin: 'Canceled by admin',
  refunded: 'Refunded',
};

const TONE: Partial<Record<SubOrderStatus, string>> = {
  awaiting_vendor: 'badge--warning',
  accepted: 'badge--review',
  preparing: 'badge--review',
  ready_to_ship: 'badge--review',
  shipped: 'badge--review',
  delivery_failed: 'badge--rejected',
  delivered: 'badge--approved',
  completed: 'badge--approved',
  return_requested: 'badge--warning',
  rejected_by_vendor: 'badge--rejected',
  canceled_by_customer: 'badge--rejected',
  canceled_by_admin: 'badge--rejected',
};

export const toneOf = (s: string): string => TONE[s as SubOrderStatus] ?? 'badge--pending';
export const labelOf = (s: string, locale: Locale = 'ar'): string =>
  (locale === 'en' ? STATUS_LABEL_EN : STATUS_LABEL)[s as SubOrderStatus] ?? s;

/** نصّ الزرّ لكل انتقال — من منظور من يضغطه */
export const ACTION_LABEL: Partial<Record<SubOrderStatus, string>> = {
  accepted: 'قبول الطلب',
  rejected_by_vendor: 'رفض',
  preparing: 'بدء التجهيز',
  ready_to_ship: 'جاهز للشحن',
  shipped: 'تأكيد الشحن',
  delivered: 'تأكيد التسليم',
  delivery_failed: 'تعذّر التوصيل',
  returned: 'استلام المرتجع',
  canceled_by_customer: 'إلغاء هذا المتجر',
};

export const ACTION_LABEL_EN: Partial<Record<SubOrderStatus, string>> = {
  accepted: 'Accept order',
  rejected_by_vendor: 'Reject',
  preparing: 'Start preparing',
  ready_to_ship: 'Ready to ship',
  shipped: 'Confirm shipment',
  delivered: 'Confirm delivery',
  delivery_failed: 'Delivery failed',
  returned: 'Receive return',
  canceled_by_customer: 'Cancel this shop',
};

/** حال الردّ للإدارة — «بانتظار التحويل» مالٌ لم يخرج بعد: الإدارة تحوّله وتسجّل مرجعه */
export const REFUND_STATUS: Readonly<Record<string, string>> = {
  pending: 'قيد التنفيذ',
  processing: 'قيد التنفيذ',
  awaiting_transfer: 'بانتظار التحويل',
  succeeded: 'تمّ',
  failed: 'فشل',
};

export const REFUND_STATUS_EN: Readonly<Record<string, string>> = {
  pending: 'In progress',
  processing: 'In progress',
  awaiting_transfer: 'Awaiting transfer',
  succeeded: 'Done',
  failed: 'Failed',
};

/** حال الدفع للإدارة — رمز الخادم لا يُعرض كما هو (PaymentStatus بحالاته التسع) */
export const PAYMENT_STATUS: Readonly<Record<string, string>> = {
  pending: 'قيد المعالجة',
  requires_action: 'بانتظار تأكيد البنك',
  awaiting_transfer: 'بانتظار التحويل',
  authorized: 'محجوز على البطاقة',
  captured: 'مدفوع',
  partially_refunded: 'مُسترَد جزئياً',
  refunded: 'مُسترَد',
  failed: 'فشل',
  voided: 'أُلغي قبل التحصيل',
};

export const PAYMENT_STATUS_EN: Readonly<Record<string, string>> = {
  pending: 'Processing',
  requires_action: 'Awaiting bank confirmation',
  awaiting_transfer: 'Awaiting transfer',
  authorized: 'Authorized on card',
  captured: 'Paid',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  failed: 'Failed',
  voided: 'Voided before capture',
};

export const money = (minor: string | number | bigint, currency: string, locale: Locale = 'ar'): string =>
  formatMoney(BigInt(minor), currency, locale);

/** عدد الساعات بتمييزه العربي: «ساعة واحدة»، «ساعتين»، «6 ساعات»، «48 ساعة» — لا «6 ساعة» */
export function hoursAr(n: number, locale: Locale = 'ar'): string {
  // بالإنجليزية: «1 hour»، «48 hours»
  if (locale === 'en') return `${n} ${n === 1 ? 'hour' : 'hours'}`;
  if (n === 1) return 'ساعة واحدة';
  if (n === 2) return 'ساعتين';
  if (n >= 3 && n <= 10) return `${n} ساعات`;
  return `${n} ساعة`;
}

/** عدد الأيام بتمييزه العربي: «يوم واحد»، «يومين»، «7 أيام»، «14 يوماً» */
export function daysAr(n: number, locale: Locale = 'ar'): string {
  // بالإنجليزية: «1 day»، «14 days»
  if (locale === 'en') return `${n} ${n === 1 ? 'day' : 'days'}`;
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

export const when = (iso: string | null | undefined, locale: Locale = 'ar'): string =>
  iso
    ? new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
    : '—';

export interface OrderItemView {
  id: string;
  productId: string;
  productNameSnapshotAr: string;
  variantLabelSnapshot: string | null;
  skuSnapshot: string;
  unitPriceMinorUnits: string;
  qty: number;
  refundedQty: number;
  /** من المُسترَد: ما عاد بطلب إرجاع — والباقي أُلغي (رفض المتجر أو إلغاء) */
  returnedQty: number;
  /** بعملة المتجر قبل الخصم والضريبة: سعر القطعة × الكمية */
  lineSubtotalMinorUnits: string;
  lineTotalMinorUnits: string;
  review: { id: string; rating: number } | null;
}

export interface HistoryRow {
  fromStatus: string | null;
  toStatus: string;
  toLabel: string;
  actorRole: string | null;
  reason: string | null;
  createdAt: string;
}

/**
 * سبب سطر في مسار الطلب: طلب الإرجاع كان يُكتب رمزاً («size_issue») قبل 28 أكتوبر 2026،
 * فيُقرأ بالعربي هنا لما سبق — وما بعده يصل بالعربي من الخادم (BUY-047).
 */
export function historyReason(h: Pick<HistoryRow, 'toStatus' | 'reason'>, locale: Locale = 'ar'): string | null {
  if (!h.reason || h.toStatus !== 'return_requested') return h.reason;
  return (locale === 'en' ? RETURN_REASONS_EN : RETURN_REASONS)[h.reason] ?? h.reason;
}

/**
 * التوصيل الذاتي: البائع يوصل بنفسه ويكتب مرجعاً يعرفه به، لا رقماً من شركة يُتتبَّع.
 * كانت صفحتا الطلب تقولان «رقم التتبّع» وتعرضان الرمز الخام «self» بعد الشحن، والإشعار
 * وخانة البائع «مرجع التوصيل» (BUY-015، J-14 — 21 أكتوبر 2026).
 */
export const SELF_DELIVERY = 'self';
const CARRIER_NAMES: Readonly<Record<string, string>> = { [SELF_DELIVERY]: 'توصيل ذاتي', 'basta-express': 'بسطة إكسبرس' };
const CARRIER_NAMES_EN: Readonly<Record<string, string>> = { [SELF_DELIVERY]: 'Self-delivery', 'basta-express': 'Basta Express' };

/** عنوان الرقم: «مرجع التوصيل» للتوصيل الذاتي، و«رقم التتبّع» لشحنة شركة */
export const trackingLabel = (carrierCode: string, locale: Locale = 'ar'): string => {
  if (locale === 'en') return carrierCode === SELF_DELIVERY ? 'Delivery reference' : 'Tracking number';
  return carrierCode === SELF_DELIVERY ? 'مرجع التوصيل' : 'رقم التتبّع';
};

/** اسم الناقل بالعربية — والرمز كما هو لناقل لا نعرف اسمه */
export const carrierName = (carrierCode: string, locale: Locale = 'ar'): string =>
  (locale === 'en' ? CARRIER_NAMES_EN : CARRIER_NAMES)[carrierCode] ?? carrierCode;

export interface ShipmentView {
  carrierCode: string;
  trackingNumber: string;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  events: { code: string; descriptionAr: string | null; location: string | null; occurredAt: string }[];
}

export interface SubOrderView {
  id: string;
  number: string;
  status: SubOrderStatus;
  statusLabel: string;
  actions: SubOrderStatus[];
  currency: string;
  totalMinorUnits: string;
  shippingMinorUnits: string;
  placedAt: string;
  deliveredAt: string | null;
  cancelReason: string | null;
  vendor: { id: string; slug: string; nameAr: string };
  items: OrderItemView[];
  history: HistoryRow[];
  shipment: ShipmentView | null;
  returns: {
    id: string;
    itemsJson: { orderItemId: string; qty: number }[];
    reasonCode: string;
    description: string | null;
    status: string;
    requestedAt: string;
    resolvedAt?: string | null;
    /** سبب رفض البائع — BUY-047 */
    resolutionNote?: string | null;
  }[];
  refunds: { id: string; amountMinorUnits: string; reason: string; status: string; transferReference?: string | null; createdAt: string }[];
  disputes: { id: string; reasonCode: string; status: string; createdAt: string }[];
}

export const RETURN_REASONS: Record<string, string> = {
  damaged: 'وصل تالفاً',
  wrong_item: 'منتج غير الذي طلبته',
  not_as_described: 'لا يطابق الوصف',
  size_issue: 'المقاس غير مناسب',
  changed_mind: 'غيّرت رأيي',
  other: 'سبب آخر',
};

export const RETURN_REASONS_EN: Record<string, string> = {
  damaged: 'Arrived damaged',
  wrong_item: 'Not the item I ordered',
  not_as_described: 'Not as described',
  size_issue: "Size doesn't fit",
  changed_mind: 'Changed my mind',
  other: 'Other reason',
};

export const DISPUTE_REASONS: Record<string, string> = {
  not_received: 'لم يصلني الطلب',
  damaged: 'وصل تالفاً',
  not_as_described: 'لا يطابق الوصف',
  return_refused: 'رُفض إرجاعي',
  refund_missing: 'لم يصلني الاسترداد',
  other: 'مشكلة أخرى',
};

export const DISPUTE_REASONS_EN: Record<string, string> = {
  not_received: "I didn't receive my order",
  damaged: 'Arrived damaged',
  not_as_described: 'Not as described',
  return_refused: 'My return was refused',
  refund_missing: "I didn't receive my refund",
  other: 'Another problem',
};

/** على «مُسترَد»: نزاع «لم يصلني الاسترداد» وحده خلال هذه الأيام من الاسترداد، ويصل الإدارة (BUY-052) */
export const REFUND_DISPUTE_DAYS = 14;
export const REFUND_DISPUTE_REASONS: Record<string, string> = { refund_missing: DISPUTE_REASONS['refund_missing']! };
export const REFUND_DISPUTE_REASONS_EN: Record<string, string> = { refund_missing: DISPUTE_REASONS_EN['refund_missing']! };

export const DISPUTE_STATUS: Record<string, string> = {
  open: 'مفتوح',
  escalated: 'مُصعَّد للإدارة',
  withdrawn: 'مسحوب',
  resolved_customer: 'حُسم للمشتري',
  resolved_vendor: 'حُسم للبائع',
};

export const DISPUTE_STATUS_EN: Record<string, string> = {
  open: 'Open',
  escalated: 'Escalated to admin',
  withdrawn: 'Withdrawn',
  resolved_customer: 'Resolved for buyer',
  resolved_vendor: 'Resolved for seller',
};

export const ROLE_LABEL: Record<string, string> = {
  customer: 'المشتري',
  vendor_owner: 'البائع',
  vendor_staff: 'البائع',
  admin: 'الإدارة',
};

export const ROLE_LABEL_EN: Record<string, string> = {
  customer: 'Buyer',
  vendor_owner: 'Seller',
  vendor_staff: 'Seller',
  admin: 'Admin',
};
