import type { Metadata } from 'next';
import '@/styles/screens/storefront-extra.css';
import { TrackView } from '@/components/track-view';

export const metadata: Metadata = { title: 'تتبّع شحنتك', robots: { index: false } };

/** ST-31 — تتبّع بلا حساب. النموذج والنتيجة عميلان: البحث برقم يكتبه المشتري */
export default function TrackPage() {
  return <TrackView />;
}
