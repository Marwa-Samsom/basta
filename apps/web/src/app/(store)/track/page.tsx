import type { Metadata } from 'next';
import '@/styles/screens/storefront-extra.css';
import { TrackView } from '@/components/track-view';
import { serverT } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t('تتبّع شحنتك', 'Track your shipment'), robots: { index: false } };
}

/** ST-31 — تتبّع بلا حساب. النموذج والنتيجة عميلان: البحث برقم يكتبه المشتري */
export default function TrackPage() {
  return <TrackView />;
}
