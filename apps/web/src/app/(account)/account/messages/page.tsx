import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MessagesInbox } from '@/components/messages';

export const metadata: Metadata = { title: 'رسائلي', robots: { index: false } };

/**
 * ST-28 — رسائلي: محادثات المشتري مع المتاجر. `?c=<id>` يفتح محادثة بعينها
 * (رابط التنبيه ورابط تأكيد «اسأل المتجر»). المنطق كله في المكوّن المشترك
 * مع VD-15؛ الحدّ هنا لأن قراءة معاملات الرابط تحتاج Suspense وقت البناء.
 */
export default function MyMessagesPage() {
  return (
    <Suspense>
      <MessagesInbox audience="customer" />
    </Suspense>
  );
}
