'use client';

import { NotificationsInbox, type InboxEvent } from '@/components/notifications-inbox';

/**
 * إشعارات الإدارة — صندوق المدير كما للبائع (VD-21)، بطلب صاحبة المشروع (28 أكتوبر 2026).
 * كان للإدارة الجرس وحده، و«كل الإشعارات» تحته يفتح صفحة المشتري. القوالب انتقلت إلى
 * `/admin/notifications/templates` كما في التصميم (AD-20).
 */
const EVENTS: Record<string, InboxEvent> = {
  admin_dispute_escalated: { title: 'نزاع مصعَّد ينتظر الحسم', icon: 'scale', tone: 'danger', kind: 'dispute' },
  admin_dispute_waiting: { title: 'نزاع ينتظر ردّك', icon: 'clock', tone: 'warning', kind: 'dispute' },
  admin_dispute_message: { title: 'رسالة في نزاع مصعَّد', icon: 'msg', tone: 'info', kind: 'dispute' },
  admin_acceptance_due: { title: 'طلب قارب مهلة القبول', icon: 'clock', tone: 'warning', kind: 'order' },
  admin_return_stalled: { title: 'مرتجع لم يستلمه المتجر', icon: 'return', tone: 'warning', kind: 'order' },
  admin_transfer_awaiting: { title: 'تحويل مشترٍ ينتظر التأكيد', icon: 'cash', tone: 'money', kind: 'money' },
  admin_payout_requested: { title: 'طلب سحب ينتظر الموافقة', icon: 'wallet', tone: 'money', kind: 'money' },
  admin_refund_awaiting_transfer: { title: 'ردّ ينتظر التحويل اليدوي', icon: 'wallet', tone: 'warning', kind: 'money' },
  admin_audit_drift: { title: 'انحراف في فحوص المال', icon: 'alert', tone: 'danger', kind: 'money' },
  admin_vendor_submitted: { title: 'متجر ينتظر المراجعة', icon: 'store', tone: 'brand', kind: 'vendor' },
  admin_bank_account_added: { title: 'حساب بنكي ينتظر التوثيق', icon: 'shield', tone: 'warning', kind: 'vendor' },
};

const FILTERS = [
  { key: 'all', label: 'الكل' },
  { key: 'dispute', label: 'النزاعات' },
  { key: 'order', label: 'الطلبات' },
  { key: 'money', label: 'المال' },
  { key: 'vendor', label: 'المتاجر' },
] as const;

export default function AdminNotificationsPage() {
  return (
    <NotificationsInbox
      events={EVENTS}
      filters={FILTERS}
      emptyBody="كل شيء هادئ. النزاعات المصعَّدة وطلبات السحب والمتاجر الجديدة وتنبيهات المهل تظهر هنا."
    />
  );
}
