import type { Metadata } from 'next';
import '@/styles/screens/storefront-extra.css';
import { CompareView } from '@/components/compare';

export const metadata: Metadata = { title: 'قارن المنتجات', robots: { index: false } };

/**
 * ST-10 — المقارنة. القائمة في هذا الجهاز (التخزين المحلي)، والأسعار
 * والتوفّر والسمات تُجلب حيّة من صفحة كل منتج — لا شيء مخزّن يشيخ.
 */
export default function ComparePage() {
  return <CompareView />;
}
