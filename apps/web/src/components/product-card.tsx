import Link from 'next/link';
import { Icon } from '@/components/icons';
import { imageUrl, type ProductCard as Card } from '@/lib/storefront';

/**
 * بطاقة منتج — ورقة المكوّنات، المكوّن 9.
 *
 * مكوّن خادم بلا حالة. السعر بالفيروزي وحده (المال لا يُستعمل زينة)،
 * والنافد يُعرض ويُقال إنه نفد لا يُخفى — إخفاؤه يُفقد رابطاً مفهرساً
 * ويُربك من رآه أمس.
 */
export function ProductCard({ product }: { product: Card }) {
  const src = imageUrl(product.thumbnail);
  const discounted =
    product.compareAtPrice && BigInt(product.compareAtPrice.minorUnits) > BigInt(product.price.minorUnits);

  return (
    <article className="pcard" data-sold-out={product.isSoldOut}>
      <Link href={`/p/${product.slug}`} className="pcard__link" tabIndex={-1} aria-hidden>
        <div className="pcard__media">
          {src ? (
            // صورة المنتج من خادم الرفع مباشرةً؛ next/image يحتاج إعداد مضيف بعيد لا يلزم محلياً
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" loading="lazy" width={400} height={500} />
          ) : (
            <span className="pcard__placeholder" aria-hidden>
              {product.nameAr.slice(0, 1)}
            </span>
          )}
          {product.isSoldOut ? <span className="badge badge--pending pcard__flag">نفد</span> : null}
          {!product.isSoldOut && discounted ? <span className="badge badge--solid pcard__flag">خصم</span> : null}
        </div>
      </Link>
      <div className="pcard__body">
        <Link href={`/p/${product.slug}`} className="pcard__link">
          <h3 className="pcard__name">{product.nameAr}</h3>
        </Link>
        <Link href={`/s/${product.vendor.slug}`} className="pcard__vendor">
          <Icon name="store" size={12} />
          {product.vendor.nameAr}
        </Link>
        <p className="pcard__price">
          <span className="money num">{product.price.formatted}</span>
          {discounted && product.compareAtPrice ? <s className="num">{product.compareAtPrice.formatted}</s> : null}
        </p>
        {!product.isSoldOut && product.available > 0 && product.available <= 3 ? (
          <span className="pcard__stock">بقي {product.available} فقط</span>
        ) : null}
      </div>
    </article>
  );
}

export function ProductGrid({ products }: { products: Card[] }) {
  return (
    <div className="pgrid">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
