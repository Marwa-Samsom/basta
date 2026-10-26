'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { MoreButton } from '@/components/ui';
import { apiBase } from '@/lib/api';
import { num, type ProductReview, type ProductReviews as Reviews } from '@/lib/storefront';

const dateOf = (iso: string) => new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium' }).format(new Date(iso));

/** العدد يُميَّز كما تقتضي العربية: تقييم واحد، تقييمان، 3–10 تقييمات، 11 فأكثر تقييماً */
const countLabel = (n: number) =>
  n === 1 ? 'من تقييم واحد' : n === 2 ? 'من تقييمين' : n <= 10 ? `من ${num(n)} تقييمات` : `من ${num(n)} تقييماً`;

function Stars({ value, size = 15 }: { value: number; size?: number }) {
  const full = Math.round(value);
  return (
    <span className="sd-stars" role="img" aria-label={`${value.toFixed(1)} من 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name={n <= full ? 'star-fill' : 'star'} size={size} />
      ))}
    </span>
  );
}

/**
 * مراجعات المنتج — DISC-064 و BUY-070، 26 أكتوبر 2026.
 *
 * كانت المراجعة تُنشر بشارة «شراء موثّق» ولا تعرضها أي صفحة. الآن تحت المواصفات: المعدّل
 * وتوزيع النجوم، ثم المراجعات الأحدث أولاً. الصفحة الأولى تصل من الخادم في HTML، و«المزيد»
 * يطلب العشر التالية، و«السابق» يطوي آخر دفعة.
 */
export function ProductReviews({ productId, initial }: { productId: string; initial: Reviews }) {
  const [batches, setBatches] = useState<ProductReview[][]>([initial.items]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const items = batches.flat();
  const { count, average, distribution } = initial;

  async function more() {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await fetch(`${apiBase()}/products/${productId}/reviews?page=${batches.length + 1}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as Reviews;
      setBatches((b) => [...b, page.items]);
    } catch {
      setMoreError('تعذّر تحميل المزيد.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="sd-pdp__block" aria-labelledby="sd-reviews">
      <h2 id="sd-reviews" className="sd-pdp__tabs">
        <span className="sd-pdp__tab">التقييمات</span>
      </h2>

      {count === 0 || average === null ? (
        <p className="sd-reviews__empty">لا تقييمات بعد. يقيّم المنتج من اشتراه واستلمه.</p>
      ) : (
        <div className="sd-reviews">
          <div className="sd-reviews__summary">
            <p className="sd-reviews__avg">
              <span className="num">{average.toFixed(1)}</span>
              <span className="sd-reviews__of">من 5</span>
            </p>
            <Stars value={average} size={17} />
            <p className="sd-reviews__count">{countLabel(count)}</p>
            <ul className="sd-reviews__dist" aria-label="توزيع النجوم">
              {([5, 4, 3, 2, 1] as const).map((n) => {
                const c = distribution[String(n) as keyof typeof distribution] ?? 0;
                return (
                  <li key={n} className="sd-reviews__row">
                    <span className="num">{n}</span>
                    <Icon name="star-fill" size={12} className="sd-reviews__row-star" />
                    <span className="sd-reviews__bar" aria-hidden>
                      <span style={{ inlineSize: `${(c / count) * 100}%` }} />
                    </span>
                    <span className="num sd-reviews__row-count" aria-label={`${n} نجوم: ${c}`}>
                      {c}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="sd-reviews__main">
            <ol className="sd-reviews__list">
              {items.map((r) => (
                <li key={r.id} className="sd-review">
                  <div className="sd-review__head">
                    <Stars value={r.rating} />
                    {r.title ? <strong className="sd-review__title">{r.title}</strong> : null}
                  </div>
                  {r.body ? <p className="sd-review__body">{r.body}</p> : null}
                  <p className="sd-review__meta">
                    <span className="sd-review__author">{r.author}</span>
                    <time dateTime={r.createdAt}>{dateOf(r.createdAt)}</time>
                    {r.variant ? <span>{r.variant}</span> : null}
                    {r.verified ? (
                      <span className="badge badge--approved">
                        <Icon name="check" size={12} />
                        شراء موثّق
                      </span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ol>
            <MoreButton
              list={{
                items,
                total: count,
                hasMore: items.length < count,
                loadingMore,
                moreError,
                more: () => void more(),
                less: () => setBatches((b) => (b.length > 1 ? b.slice(0, -1) : b)),
                canLess: batches.length > 1,
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
