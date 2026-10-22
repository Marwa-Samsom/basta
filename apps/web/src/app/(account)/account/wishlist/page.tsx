import type { Metadata } from 'next';
import '@/styles/screens/wishlist.css';
import { getShops } from '@/lib/storefront';
import { WishlistView } from './wishlist-view';

export const metadata: Metadata = { title: 'المفضّلة', robots: { index: false } };

/** المتاجر تُقرأ عند الطلب لا وقت البناء — البناء لا يحتاج خادماً حيّاً */
export const dynamic = 'force-dynamic';

/** رقائق الحالة الفارغة — أربع كما في التصميم */
const SUGGESTED = 4;

/**
 * ST-23 — المفضّلة. القائمة نفسها في العميل (تخصّ الداخل وحده)، والمتاجر
 * المقترحة في الحالة الفارغة متاجر حقيقية من الخادم (كانت أقساماً عامة حتى
 * صارت الفئات لكل متجر — 14 أكتوبر 2026).
 */
export default async function WishlistPage() {
  const shops = await getShops().catch(() => ({ items: [] }));
  const suggestions = shops.items.slice(0, SUGGESTED).map((s) => ({ slug: s.slug, nameAr: s.nameAr }));
  return <WishlistView suggestions={suggestions} />;
}
