'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { ApiError, session } from '@/lib/api';
import { cartApi } from '@/lib/cart';
import { imageUrl } from '@/lib/storefront';
import { getWishlist, savedCount, setSaved, type WishlistItem } from '@/lib/wishlist';

/** «بقي N فقط» عند هذا العدد أو أقل — الحدّ نفسه في الخادم وبطاقة المنتج */
const LOW_STOCK = 3;

const FLAG: Partial<Record<WishlistItem['state'], { label: string; tone: string }>> = {
  sold_out: { label: 'نفد', tone: 'badge--pending' },
  unavailable: { label: 'غير متاح', tone: 'badge--pending' },
  drop: { label: 'انخفض السعر', tone: 'badge--success' },
  rise: { label: 'ارتفع السعر', tone: 'badge--warning' },
};

/**
 * ST-23 — المفضّلة.
 *
 * شبكة بأربعة أعمدة. كل بطاقة تقول ما تغيّر منذ الحفظ (السعر نزل أو ارتفع،
 * قارب النفاد، نفد، لم يعد معروضاً) لأن هذا ما يعود المشتري من أجله.
 * «انقله إلى السلة» يضيف مباشرةً حين للمنتج متغيّر واحد، وإلا يفتح صفحة
 * المنتج لاختيار المقاس أو اللون — لا نخمّن خياراً عن المشتري.
 */
export function WishlistView({ suggestions }: { suggestions: { slug: string; nameAr: string }[] }) {
  const router = useRouter();
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [max, setMax] = useState(200);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [moved, setMoved] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const grid = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!session.read()) {
      router.replace('/login?next=/account/wishlist');
      return;
    }
    let alive = true;
    getWishlist()
      .then((d) => {
        if (!alive) return;
        setItems(d.items);
        setMax(d.max);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login?next=/account/wishlist');
          return;
        }
        setError(e instanceof Error ? e.message : 'تعذّر جلب مفضّلتك.');
      });
    return () => {
      alive = false;
    };
  }, [router]);

  /** البطاقة تختفي، والتركيز ينتقل إلى زرّ الإزالة في البطاقة التالية لا إلى أول الصفحة */
  function dropItem(productId: string): void {
    const list = items ?? [];
    const index = list.findIndex((i) => i.productId === productId);
    const next = list[index + 1] ?? list[index - 1];
    setItems((current) => current?.filter((i) => i.productId !== productId) ?? current);
    requestAnimationFrame(() => {
      const target = next ? document.querySelector<HTMLElement>(`[data-wl-remove="${next.productId}"]`) : null;
      (target ?? grid.current)?.focus();
    });
  }

  async function remove(item: WishlistItem): Promise<void> {
    setBusyId(item.productId);
    setError(null);
    try {
      await setSaved(item.productId, false);
      setMoved(null);
      setStatus(`أُزيل «${item.nameAr}» من المفضّلة.`);
      dropItem(item.productId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّرت الإزالة من المفضّلة.');
    } finally {
      setBusyId(null);
    }
  }

  async function moveToCart(item: WishlistItem): Promise<void> {
    if (!item.variantId) return;
    setBusyId(item.productId);
    setError(null);
    try {
      await cartApi.add(item.variantId, 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّرت الإضافة إلى السلة.');
      setBusyId(null);
      return;
    }
    try {
      await setSaved(item.productId, false);
      dropItem(item.productId);
      setMoved(item.nameAr);
      setStatus('');
    } catch {
      // في السلة فعلاً؛ بقاؤه في المفضّلة لا يضرّ — يُقال ولا يُعاد
      setError(`أُضيف «${item.nameAr}» إلى سلّتك، لكن تعذّرت إزالته من المفضّلة. أزله يدوياً إن شئت.`);
    } finally {
      setBusyId(null);
    }
  }

  const count = items?.length ?? 0;

  return (
    <div className="aa-page">
      <PageHead
        title="المفضّلة"
        {...(items && count > 0 ? { count: savedCount(count) } : {})}
        {...(items && count >= max ? { meta: `بلغت الحد (${max}) — أزل منتجاً لتحفظ غيره` } : {})}
      />

      <p className="visually-hidden" role="status">
        {status}
      </p>

      {moved ? (
        <div className="alert alert--success wl-moved" role="status">
          <Icon name="check-circle" size={17} />
          <span>
            نُقل «{moved}» إلى سلّتك. <Link href="/cart">اذهب إلى السلة</Link>
          </span>
        </div>
      ) : null}

      {error ? (
        <Alert tone="danger" title="لم يكتمل الطلب">
          {error}
        </Alert>
      ) : null}

      {!items && !error ? (
        <div className="wl-skel" role="status">
          <span className="visually-hidden">جارٍ جلب مفضّلتك…</span>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skeleton wl-skel__card" aria-hidden />
          ))}
        </div>
      ) : null}

      {items && count === 0 ? (
        <EmptyState
          icon="heart"
          title="مفضّلتك فارغة"
          actions={
            suggestions.length > 0 ? (
              suggestions.map((c) => (
                <Link key={c.slug} href={`/c/${c.slug}`} className="btn btn--secondary">
                  {c.nameAr}
                </Link>
              ))
            ) : (
              <Link href="/" className="btn btn--primary">
                تصفّح المتجر
              </Link>
            )
          }
        >
          احفظ ما يعجبك بضغطة على القلب، وتجده هنا بسعره الآن — ونقول لك إن تغيّر سعره منذ حفظته أو قارب النفاد.
        </EmptyState>
      ) : null}

      {items && count > 0 ? (
        <ul className="wl-grid" ref={grid} tabIndex={-1} aria-label="المنتجات المحفوظة">
          {items.map((item) => (
            <li key={item.productId}>
              <WishCard
                item={item}
                busy={busyId === item.productId}
                onRemove={() => void remove(item)}
                onMove={() => void moveToCart(item)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function WishCard({
  item,
  busy,
  onRemove,
  onMove,
}: {
  item: WishlistItem;
  busy: boolean;
  onRemove: () => void;
  onMove: () => void;
}) {
  const gone = item.state === 'unavailable';
  const soldOut = item.state === 'sold_out';
  const src = imageUrl(item.image);
  const flag = FLAG[item.state];
  const href = `/p/${item.slug}`;
  const changed = item.state === 'drop' || item.state === 'rise';
  const few = item.available > 0 && item.available <= LOW_STOCK;

  const media = src ? (
    // صورة المنتج من خادم الرفع مباشرةً — المقاس نفسه في بطاقة المنتج
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" width={400} height={500} />
  ) : (
    <Icon name="image" size={30} />
  );

  return (
    <article className="wl-card" data-state={item.state} aria-busy={busy}>
      <div className="wl-card__media">
        {/* منتج لم يعد معروضاً لا رابط له: صفحته 404 */}
        {gone ? (
          <span className="wl-card__img" aria-hidden>
            {media}
          </span>
        ) : (
          <Link href={href} className="wl-card__img" tabIndex={-1} aria-hidden>
            {media}
          </Link>
        )}
        {flag ? <span className={`badge ${flag.tone} wl-card__flag`}>{flag.label}</span> : null}
        <button
          type="button"
          className="wl-card__remove"
          data-wl-remove={item.productId}
          aria-label={`أزل «${item.nameAr}» من المفضّلة`}
          title="أزل من المفضّلة"
          onClick={() => {
            if (!busy) onRemove();
          }}
        >
          <Icon name="heart-fill" size={16} />
        </button>
      </div>

      <div className="wl-card__body">
        <h2 className="wl-card__name">{gone ? item.nameAr : <Link href={href}>{item.nameAr}</Link>}</h2>
        <Link href={`/s/${item.shop.slug}`} className="wl-card__shop">
          <Icon name="store" size={12} />
          {item.shop.nameAr}
        </Link>

        {item.currentPrice ? (
          <p className="wl-card__price">
            <span className="money num">{item.currentPrice.formatted}</span>
            {changed ? (
              <s className="num">
                <span className="visually-hidden">سعره عند الحفظ </span>
                {item.savedPrice.formatted}
              </s>
            ) : null}
          </p>
        ) : null}

        {gone ? <p className="wl-card__note">لم يعد معروضاً في المتجر</p> : null}
        {soldOut ? <p className="wl-card__note">نفد من المتجر</p> : null}
        {changed && item.delta ? (
          <p className="wl-card__note" data-tone={item.state === 'drop' ? 'success' : 'warning'}>
            {item.state === 'drop' ? 'انخفض' : 'ارتفع'} <span className="num">{item.delta.formatted}</span> منذ حفظه
          </p>
        ) : null}
        {few && !soldOut && !gone ? (
          <p className="wl-card__note" data-tone="warning">
            بقي <span className="num">{item.available}</span> فقط
          </p>
        ) : null}

        <div className="wl-card__action">
          {gone ? (
            <button type="button" className="btn btn--secondary wl-card__btn" disabled>
              غير متاح
            </button>
          ) : soldOut ? (
            <button type="button" className="btn btn--secondary wl-card__btn" disabled>
              <Icon name="cart" size={15} />
              نفد
            </button>
          ) : item.variantId ? (
            <button
              type="button"
              className="btn btn--primary wl-card__btn"
              aria-busy={busy}
              onClick={() => {
                if (!busy) onMove();
              }}
            >
              <Icon name="cart" size={15} />
              {busy ? 'جارٍ النقل…' : 'انقله إلى السلة'}
            </button>
          ) : (
            <Link href={href} className="btn btn--primary wl-card__btn">
              اختر الخيارات
              <Icon name="chev-end" size={14} mirror />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
