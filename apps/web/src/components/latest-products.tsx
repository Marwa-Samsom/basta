'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { ProductGrid } from '@/components/product-card';
import type { ListResult, ProductCard } from '@/lib/storefront';

/**
 * «وصل حديثاً» في الرئيسية: الصفحة الأولى تُصيَّر في الخادم، و«المزيد» يجلب التالية
 * في المكان نفسه وبعملة العرض نفسها — بلا مغادرة الرئيسية. و«السابق» يُسقط آخر
 * دفعة أضافها «المزيد» فيعود ما قبلها كما كان.
 */
export function LatestProducts({ first, currency }: { first: ListResult; currency: string | undefined }) {
  const [items, setItems] = useState<ProductCard[]>(first.items);
  // كم أضافت كل ضغطة «المزيد» بعد إسقاط المكرّر — «السابق» يُزيل آخرها بقدرها
  const [batches, setBatches] = useState<number[]>([]);
  const [page, setPage] = useState(first.page);
  const [total, setTotal] = useState(first.total);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const hasMore = page * first.pageSize < total;

  const more = async () => {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const query = new URLSearchParams({ sort: 'newest', pageSize: String(first.pageSize), page: String(page + 1) });
      if (currency) query.set('currency', currency);
      const next = await api<ListResult>(`/storefront/products?${query.toString()}`, { auth: false });
      // منتج نُشر بين الصفحتين يزيح ما بعده — فلا يتكرّر في الشبكة
      const fresh = next.items.filter((n) => !items.some((p) => p.id === n.id));
      setItems([...items, ...fresh]);
      setBatches([...batches, fresh.length]);
      setPage(next.page);
      setTotal(next.total);
    } catch {
      setMoreError('تعذّر تحميل المزيد.');
    } finally {
      setLoadingMore(false);
    }
  };

  const less = () => {
    const last = batches.at(-1);
    if (last === undefined) return;
    setItems(items.slice(0, items.length - last));
    setBatches(batches.slice(0, -1));
    setPage(page - 1);
    setMoreError(null);
    // الشبكة قصرت من تحت — يبقى الزرّان أمام العين لا تقفز الصفحة بعيداً عنهما
    requestAnimationFrame(() => bar.current?.scrollIntoView({ block: 'center' }));
  };

  return (
    <>
      <ProductGrid products={items} />
      {hasMore || batches.length > 0 || moreError ? (
        <div className="list-more" ref={bar}>
          <span className="list-more__count num">
            {items.length} من {total}
          </span>
          {moreError ? (
            <span className="list-more__error" role="alert">
              {moreError}
            </span>
          ) : null}
          {batches.length > 0 ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={loadingMore} onClick={less}>
              السابق
            </button>
          ) : null}
          {hasMore || moreError ? (
            <button type="button" className="btn btn--secondary btn--sm" disabled={loadingMore} onClick={() => void more()}>
              {loadingMore ? 'جارٍ التحميل…' : moreError ? 'أعد المحاولة' : 'المزيد'}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
