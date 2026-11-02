'use client';

import { useMemo } from 'react';
import { NotificationsInbox, type InboxEvent } from '@/components/notifications-inbox';
import { useLocale, useT } from '@/components/locale';
import { pick, type Bilingual } from '@/lib/i18n';

/** كل حدث: عنوانه القصير وأيقونته ولونه ومجموعته في التصفية — نمط ST-27 */
const EVENTS: Record<string, Omit<InboxEvent, 'title'> & { title: Bilingual }> = {
  vendor_new_order: { title: { ar: 'طلب جديد بانتظار قبولك', en: 'New order awaiting your acceptance' }, icon: 'truck', tone: 'brand', kind: 'order' },
  // كان «إشعار» بجرس عام خارج «الطلبات» — الإلغاء الآلي بعد 48 ساعة أولها (ADM-051، 30 أكتوبر 2026)
  vendor_order_canceled: { title: { ar: 'أُلغي طلب', en: 'An order was canceled' }, icon: 'alert', tone: 'danger', kind: 'order' },
  return_requested: { title: { ar: 'طلب إرجاع جديد', en: 'New return request' }, icon: 'return', tone: 'warning', kind: 'dispute' },
  dispute_message: { title: { ar: 'رسالة في نزاع', en: 'Message in a dispute' }, icon: 'msg', tone: 'danger', kind: 'dispute' },
  // كانت تظهر «إشعار» بلا عنوان، والسحب لم يكن يصل أصلاً (BUY-059، 28 أكتوبر 2026)
  vendor_dispute_opened: { title: { ar: 'نزاع جديد على طلب', en: 'New dispute on an order' }, icon: 'alert', tone: 'danger', kind: 'dispute' },
  vendor_dispute_escalated: { title: { ar: 'صُعِّد نزاع للإدارة', en: 'A dispute was escalated to admin' }, icon: 'scale', tone: 'warning', kind: 'dispute' },
  vendor_dispute_resolved: { title: { ar: 'حُسم نزاع', en: 'A dispute was resolved' }, icon: 'scale', tone: 'info', kind: 'dispute' },
  vendor_dispute_withdrawn: { title: { ar: 'سحب المشتري نزاعه', en: 'The buyer withdrew their dispute' }, icon: 'check-circle', tone: 'success', kind: 'dispute' },
  product_rejected: { title: { ar: 'لم يُنشر منتجك', en: 'Your product was not published' }, icon: 'alert', tone: 'danger', kind: 'product' },
  low_stock: { title: { ar: 'مخزون قارب النفاد', en: 'Stock running low' }, icon: 'boxes', tone: 'warning', kind: 'stock' },
  payout_paid: { title: { ar: 'حُوِّل مبلغ إلى حسابك', en: 'Money was transferred to your account' }, icon: 'check-circle', tone: 'money', kind: 'payout' },
  payout_rejected: { title: { ar: 'رُفض طلب سحب', en: 'A payout request was rejected' }, icon: 'wallet', tone: 'danger', kind: 'payout' },
  vendor_approved: { title: { ar: 'اعتُمد متجرك', en: 'Your shop was approved' }, icon: 'check-circle', tone: 'success', kind: 'store' },
  vendor_rejected: { title: { ar: 'طلب انضمامك يحتاج تعديلاً', en: 'Your application needs changes' }, icon: 'store', tone: 'warning', kind: 'store' },
  vendor_document_rejected: { title: { ar: 'رُفضت وثيقة من طلبك', en: 'A document in your application was rejected' }, icon: 'file', tone: 'warning', kind: 'store' },
  message_to_vendor: { title: { ar: 'رسالة من مشترٍ', en: 'Message from a buyer' }, icon: 'msg', tone: 'brand', kind: 'order' },
  bank_account_added: { title: { ar: 'أُضيف حساب بنكي', en: 'A bank account was added' }, icon: 'shield', tone: 'warning', kind: 'payout' },
  bank_account_verified: { title: { ar: 'وُثّق حسابك البنكي', en: 'Your bank account was verified' }, icon: 'check-circle', tone: 'success', kind: 'payout' },
  recovery_code_used: { title: { ar: 'استُعمل رمز استعادة', en: 'A recovery code was used' }, icon: 'shield', tone: 'warning', kind: 'store' },
  totp_reset_by_admin: { title: { ar: 'أُعيد ضبط التحقّق بخطوتين', en: 'Two-step verification was reset' }, icon: 'shield', tone: 'danger', kind: 'store' },
};

const FILTERS: readonly { key: string; label: Bilingual }[] = [
  { key: 'all', label: { ar: 'الكل', en: 'All' } },
  { key: 'order', label: { ar: 'الطلبات', en: 'Orders' } },
  { key: 'product', label: { ar: 'المنتجات', en: 'Products' } },
  { key: 'stock', label: { ar: 'المخزون', en: 'Stock' } },
  { key: 'payout', label: { ar: 'المال', en: 'Money' } },
  { key: 'dispute', label: { ar: 'النزاعات', en: 'Disputes' } },
];

/** VD-21 — الإشعارات بكثافة اللوحة (compact)، على نمط ST-27. الصندوق نفسه في components/notifications-inbox */
export default function VendorNotificationsPage() {
  const t = useT();
  const locale = useLocale();
  const events = useMemo<Record<string, InboxEvent>>(
    () => Object.fromEntries(Object.entries(EVENTS).map(([code, e]) => [code, { ...e, title: pick(locale, e.title) }])),
    [locale],
  );
  const filters = useMemo(() => FILTERS.map((f) => ({ key: f.key, label: pick(locale, f.label) })), [locale]);
  return (
    <NotificationsInbox
      events={events}
      filters={filters}
      emptyBody={t(
        'كل شيء هادئ. الطلبات الجديدة وقرارات المراجعة وتنبيهات المخزون تظهر هنا.',
        'All quiet. New orders, review decisions and stock alerts show up here.',
      )}
    />
  );
}
