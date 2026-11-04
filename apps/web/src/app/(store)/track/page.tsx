import type { Metadata } from 'next';
import { Suspense } from 'react';
import '@/styles/screens/storefront-extra.css';
import { TrackView } from '@/components/track-view';
import { serverT } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t('تتبّع شحنتك', 'Track your shipment'), robots: { index: false } };
}

/**
 * ST-31 — تتبّع بلا حساب. النموذج والنتيجة عميلان: البحث برقم يكتبه المشتري أو يأتي في `?number=`
 * (من تفاصيل الطلب أو رابط أُرسل له). useSearchParams يحتاج حدّ Suspense في صفحة تُبنى مسبقاً.
 */
export default function TrackPage() {
  return (
    <Suspense>
      <TrackView />
    </Suspense>
  );
}
