'use client';

import { useMemo } from 'react';
import { NotificationsInbox, type InboxEvent } from '@/components/notifications-inbox';
import { useLocale, useT } from '@/components/locale';
import { pick, type Bilingual } from '@/lib/i18n';

/**
 * إشعارات الإدارة — صندوق المدير كما للبائع (VD-21)، بطلب صاحبة المشروع (28 أكتوبر 2026).
 * كان للإدارة الجرس وحده، و«كل الإشعارات» تحته يفتح صفحة المشتري. القوالب انتقلت إلى
 * `/admin/notifications/templates` كما في التصميم (AD-20).
 */
const EVENTS: Record<string, Omit<InboxEvent, 'title'> & { title: Bilingual }> = {
  admin_dispute_escalated: { title: { ar: 'نزاع مصعَّد ينتظر الحسم', en: 'Escalated dispute awaiting a decision' }, icon: 'scale', tone: 'danger', kind: 'dispute' },
  admin_dispute_waiting: { title: { ar: 'نزاع ينتظر ردّك', en: 'Dispute awaiting your reply' }, icon: 'clock', tone: 'warning', kind: 'dispute' },
  admin_dispute_message: { title: { ar: 'رسالة في نزاع مصعَّد', en: 'Message in an escalated dispute' }, icon: 'msg', tone: 'info', kind: 'dispute' },
  admin_dispute_withdrawn: { title: { ar: 'سحب المشتري نزاعاً مصعَّداً', en: 'A buyer withdrew an escalated dispute' }, icon: 'check-circle', tone: 'success', kind: 'dispute' },
  admin_acceptance_due: { title: { ar: 'طلب قارب مهلة القبول', en: 'Order near its acceptance deadline' }, icon: 'clock', tone: 'warning', kind: 'order' },
  admin_return_stalled: { title: { ar: 'مرتجع لم يستلمه المتجر', en: 'Return not yet received by the shop' }, icon: 'return', tone: 'warning', kind: 'order' },
  admin_transfer_awaiting: { title: { ar: 'تحويل مشترٍ ينتظر التأكيد', en: 'Buyer transfer awaiting confirmation' }, icon: 'cash', tone: 'money', kind: 'money' },
  admin_payout_requested: { title: { ar: 'طلب سحب ينتظر الموافقة', en: 'Payout request awaiting approval' }, icon: 'wallet', tone: 'money', kind: 'money' },
  admin_refund_awaiting_transfer: { title: { ar: 'ردّ ينتظر التحويل اليدوي', en: 'Refund awaiting manual transfer' }, icon: 'wallet', tone: 'warning', kind: 'money' },
  admin_audit_drift: { title: { ar: 'انحراف في فحوص المال', en: 'Drift in money checks' }, icon: 'alert', tone: 'danger', kind: 'money' },
  admin_vendor_submitted: { title: { ar: 'متجر ينتظر المراجعة', en: 'Shop awaiting review' }, icon: 'store', tone: 'brand', kind: 'vendor' },
  admin_bank_account_added: { title: { ar: 'حساب بنكي ينتظر التوثيق', en: 'Bank account awaiting verification' }, icon: 'shield', tone: 'warning', kind: 'vendor' },
};

const FILTERS: readonly { key: string; label: Bilingual }[] = [
  { key: 'all', label: { ar: 'الكل', en: 'All' } },
  { key: 'dispute', label: { ar: 'النزاعات', en: 'Disputes' } },
  { key: 'order', label: { ar: 'الطلبات', en: 'Orders' } },
  { key: 'money', label: { ar: 'المال', en: 'Money' } },
  { key: 'vendor', label: { ar: 'المتاجر', en: 'Shops' } },
];

export default function AdminNotificationsPage() {
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
        'كل شيء هادئ. النزاعات المصعَّدة وطلبات السحب والمتاجر الجديدة وتنبيهات المهل تظهر هنا.',
        'All quiet. Escalated disputes, payout requests, new shops and deadline alerts show up here.',
      )}
    />
  );
}
