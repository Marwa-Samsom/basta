import type { Metadata } from 'next';
import '@/styles/screens/storefront-extra.css';
import { RecentView } from '@/components/recent';

export const metadata: Metadata = { title: 'شوهدت مؤخّراً', robots: { index: false } };

/**
 * ST-24 — شوهدت مؤخّراً. السجلّ في هذا الجهاز لا في الحساب، فيعمل للزائر
 * أيضاً، ويُمسح من هنا بتأكيد.
 */
export default function RecentPage() {
  return <RecentView />;
}
