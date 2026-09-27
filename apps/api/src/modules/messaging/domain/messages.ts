/**
 * قواعد الرسائل الصافية — بلا قاعدة ولا Nest، فتُقرأ وتُختبر وحدها.
 */

export type Side = 'customer' | 'vendor';

/** حدود نصّ الرسالة بعد التشذيب — يطابق قيد القاعدة `conversation_messages_body_check` */
export const BODY_MIN = 1;
export const BODY_MAX = 1000;

/** القائمة تعرض أول 140 حرفاً من آخر رسالة ولا تجلب الرسائل */
export const PREVIEW_MAX = 140;

export const previewOf = (body: string): string => body.slice(0, PREVIEW_MAX);

/** مفتاح التفرّد — يطابق قيد القاعدة `conversations_context_check` */
export const productKey = (productId: string): string => `product:${productId}`;
export const orderKey = (subOrderId: string): string => `order:${subOrderId}`;

export const other = (side: Side): Side => (side === 'customer' ? 'vendor' : 'customer');

/** ما يلزم من المحادثة لتقرير المقروء والتنبيه */
export interface ThreadState {
  lastSenderSide: string;
  lastMessageAt: Date;
  customerReadAt: Date | null;
  vendorReadAt: Date | null;
}

const readAtOf = (t: ThreadState, side: Side): Date | null => (side === 'customer' ? t.customerReadAt : t.vendorReadAt);

/**
 * هل في المحادثة ما لم يقرأه `side`؟ آخر رسالة من الطرف الآخر، ولم يفتح
 * المحادثة بعدها. المساواة تُعدّ قراءة: فتحها في اللحظة نفسها رآها.
 */
export function isUnreadFor(t: ThreadState, side: Side): boolean {
  if (t.lastSenderSide === side) return false;
  const readAt = readAtOf(t, side);
  return readAt === null || readAt.getTime() < t.lastMessageAt.getTime();
}

/**
 * هل يُنبَّه الطرف الآخر برسالة جديدة من `sender`؟
 *
 * لا — إن كانت رسالة سابقة من المرسِل نفسه تنتظره ولم يقرأها بعد: تنبيه
 * واحد لكل دفعة غير مقروءة، لا بريد لكل سطر. متى فتح المستلم المحادثة
 * صارت الرسالة التالية دفعة جديدة تستحق تنبيهاً.
 */
export function shouldNotify(prev: ThreadState | null, sender: Side): boolean {
  if (!prev) return true;
  return !isUnreadFor(prev, other(sender));
}
