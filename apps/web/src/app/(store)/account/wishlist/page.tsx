import type { Metadata } from 'next';
import '@/styles/screens/wishlist.css';
import { getCategories } from '@/lib/storefront';
import { WishlistView } from './wishlist-view';

export const metadata: Metadata = { title: 'المفضّلة', robots: { index: false } };

/** الأقسام تُقرأ عند الطلب لا وقت البناء — البناء لا يحتاج خادماً حيّاً */
export const dynamic = 'force-dynamic';

/** رقائق الحالة الفارغة — أربع كما في التصميم */
const SUGGESTED = 4;

/**
 * ST-23 — المفضّلة. القائمة نفسها في العميل (تخصّ الداخل وحده)، والأقسام
 * المقترحة في الحالة الفارغة أقسام المتجر الحقيقية من الخادم.
 */
export default async function WishlistPage() {
  const tree = await getCategories().catch(() => []);
  const suggestions = tree
    .filter((c) => c.parentId === null)
    .slice(0, SUGGESTED)
    .map((c) => ({ slug: c.slug, nameAr: c.nameAr }));
  return <WishlistView suggestions={suggestions} />;
}
