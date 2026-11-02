import type { Metadata } from 'next';
import '@/styles/screens/storefront-extra.css';
import { RecentView } from '@/components/recent';
import { serverT } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t('شوهدت مؤخّراً', 'Recently viewed'), robots: { index: false } };
}

/**
 * ST-24 — شوهدت مؤخّراً. السجلّ في هذا الجهاز لا في الحساب، فيعمل للزائر
 * أيضاً، ويُمسح من هنا بتأكيد.
 */
export default function RecentPage() {
  return <RecentView />;
}
