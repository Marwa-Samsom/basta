/**
 * أنواع الطلبات وتسمياتها في الواجهة. الحالات والأزرار تأتي من الخادم
 * (`actions` مشتقّة من آلة الحالات نفسها) — الواجهة لا تقرّر ما يُسمح.
 */
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
export const labelOf = (s: string): string => STATUS_LABEL[s as SubOrderStatus] ?? s;

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

export const money = (minor: string | number | bigint, currency: string): string =>
  formatMoney(BigInt(minor), currency);

export const when = (iso: string | null | undefined): string =>
  iso
    ? new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
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
  returns: { id: string; itemsJson: { orderItemId: string; qty: number }[]; reasonCode: string; description: string | null; status: string; requestedAt: string }[];
  refunds: { id: string; amountMinorUnits: string; reason: string; status: string; createdAt: string }[];
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

export const DISPUTE_REASONS: Record<string, string> = {
  not_received: 'لم يصلني الطلب',
  damaged: 'وصل تالفاً',
  not_as_described: 'لا يطابق الوصف',
  return_refused: 'رُفض إرجاعي',
  refund_missing: 'لم يصلني الاسترداد',
  other: 'مشكلة أخرى',
};

export const DISPUTE_STATUS: Record<string, string> = {
  open: 'مفتوح',
  escalated: 'مُصعَّد للإدارة',
  withdrawn: 'مسحوب',
  resolved_customer: 'حُسم للمشتري',
  resolved_vendor: 'حُسم للبائع',
};

export const ROLE_LABEL: Record<string, string> = {
  customer: 'المشتري',
  vendor_owner: 'البائع',
  vendor_staff: 'البائع',
  admin: 'الإدارة',
};
