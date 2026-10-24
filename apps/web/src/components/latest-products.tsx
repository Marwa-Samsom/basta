'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { ProductGrid } from '@/components/product-card';
import { MoreButton } from '@/components/ui';
import type { ListResult, ProductCard } from '@/lib/storefront';

/**
 * «وصل حديثاً» في الرئيسية: الصفحة الأولى تُصيَّر في الخادم، و«المزيد» يجلب التالية
 * في المكان نفسه وبعملة العرض نفسها — بلا مغادرة الرئيسية.
 */
export function LatestProducts({ first, currency }: { first: ListResult; currency: string | undefined }) {
  const [items, setItems] = useState<ProductCard[]>(first.items);
  const [page, setPage] = useState(first.page);
  const [total, setTotal] = useState(first.total);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const more = async () => {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const query = new URLSearchParams({ sort: 'newest', pageSize: String(first.pageSize), page: String(page + 1) });
      if (currency) query.set('currency', currency);
      const next = await api<ListResult>(`/storefront/products?${query.toString()}`, { auth: false });
      // منتج نُشر بين الصفحتين يزيح ما بعده — فلا يتكرّر في الشبكة
      setItems((prev) => [...prev, ...next.items.filter((n) => !prev.some((p) => p.id === n.id))]);
      setPage(next.page);
      setTotal(next.total);
    } catch {
      setMoreError('تعذّر تحميل المزيد.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <ProductGrid products={items} />
      <MoreButton
        list={{ items, total, hasMore: page * first.pageSize < total, loadingMore, moreError, more: () => void more() }}
      />
    </>
  );
}
