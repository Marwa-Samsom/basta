import type { Metadata } from 'next';
import '@/styles/screens/storefront-extra.css';
import { CompareView } from '@/components/compare';
import { serverT } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t('قارن المنتجات', 'Compare products'), robots: { index: false } };
}

/**
 * ST-10 — المقارنة. القائمة في هذا الجهاز (التخزين المحلي)، والأسعار
 * والتوفّر والسمات تُجلب حيّة من صفحة كل منتج — لا شيء مخزّن يشيخ.
 */
export default function ComparePage() {
  return <CompareView />;
}
