import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MessagesInbox } from '@/components/messages';
import { serverT } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t('الرسائل', 'Messages'), robots: { index: false } };
}

/**
 * VD-15 — رسائل البائع: أسئلة المشترين عن منتجاته وطلباتهم، بردود جاهزة.
 * البائع يردّ ولا يبدأ محادثة. النطاق من الجلسة في الخادم.
 */
export default function VendorMessagesPage() {
  return (
    <Suspense>
      <MessagesInbox audience="vendor" />
    </Suspense>
  );
}
