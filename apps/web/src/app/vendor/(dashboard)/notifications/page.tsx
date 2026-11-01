'use client';

import { NotificationsInbox, type InboxEvent } from '@/components/notifications-inbox';

/** كل حدث: عنوانه القصير وأيقونته ولونه ومجموعته في التصفية — نمط ST-27 */
const EVENTS: Record<string, InboxEvent> = {
  vendor_new_order: { title: 'طلب جديد بانتظار قبولك', icon: 'truck', tone: 'brand', kind: 'order' },
  // كان «إشعار» بجرس عام خارج «الطلبات» — الإلغاء الآلي بعد 48 ساعة أولها (ADM-051، 30 أكتوبر 2026)
  vendor_order_canceled: { title: 'أُلغي طلب', icon: 'alert', tone: 'danger', kind: 'order' },
  return_requested: { title: 'طلب إرجاع جديد', icon: 'return', tone: 'warning', kind: 'dispute' },
  dispute_message: { title: 'رسالة في نزاع', icon: 'msg', tone: 'danger', kind: 'dispute' },
  // كانت تظهر «إشعار» بلا عنوان، والسحب لم يكن يصل أصلاً (BUY-059، 28 أكتوبر 2026)
  vendor_dispute_opened: { title: 'نزاع جديد على طلب', icon: 'alert', tone: 'danger', kind: 'dispute' },
  vendor_dispute_escalated: { title: 'صُعِّد نزاع للإدارة', icon: 'scale', tone: 'warning', kind: 'dispute' },
  vendor_dispute_resolved: { title: 'حُسم نزاع', icon: 'scale', tone: 'info', kind: 'dispute' },
  vendor_dispute_withdrawn: { title: 'سحب المشتري نزاعه', icon: 'check-circle', tone: 'success', kind: 'dispute' },
  product_rejected: { title: 'لم يُنشر منتجك', icon: 'alert', tone: 'danger', kind: 'product' },
  low_stock: { title: 'مخزون قارب النفاد', icon: 'boxes', tone: 'warning', kind: 'stock' },
  payout_paid: { title: 'حُوِّل مبلغ إلى حسابك', icon: 'check-circle', tone: 'money', kind: 'payout' },
  payout_rejected: { title: 'رُفض طلب سحب', icon: 'wallet', tone: 'danger', kind: 'payout' },
  vendor_approved: { title: 'اعتُمد متجرك', icon: 'check-circle', tone: 'success', kind: 'store' },
  vendor_rejected: { title: 'طلب انضمامك يحتاج تعديلاً', icon: 'store', tone: 'warning', kind: 'store' },
  vendor_document_rejected: { title: 'رُفضت وثيقة من طلبك', icon: 'file', tone: 'warning', kind: 'store' },
  message_to_vendor: { title: 'رسالة من مشترٍ', icon: 'msg', tone: 'brand', kind: 'order' },
  bank_account_added: { title: 'أُضيف حساب بنكي', icon: 'shield', tone: 'warning', kind: 'payout' },
  bank_account_verified: { title: 'وُثّق حسابك البنكي', icon: 'check-circle', tone: 'success', kind: 'payout' },
  recovery_code_used: { title: 'استُعمل رمز استعادة', icon: 'shield', tone: 'warning', kind: 'store' },
  totp_reset_by_admin: { title: 'أُعيد ضبط التحقّق بخطوتين', icon: 'shield', tone: 'danger', kind: 'store' },
};

const FILTERS = [
  { key: 'all', label: 'الكل' },
  { key: 'order', label: 'الطلبات' },
  { key: 'product', label: 'المنتجات' },
  { key: 'stock', label: 'المخزون' },
  { key: 'payout', label: 'المال' },
  { key: 'dispute', label: 'النزاعات' },
] as const;

/** VD-21 — الإشعارات بكثافة اللوحة (compact)، على نمط ST-27. الصندوق نفسه في components/notifications-inbox */
export default function VendorNotificationsPage() {
  return (
    <NotificationsInbox
      events={EVENTS}
      filters={FILTERS}
      emptyBody="كل شيء هادئ. الطلبات الجديدة وقرارات المراجعة وتنبيهات المخزون تظهر هنا."
    />
  );
}
