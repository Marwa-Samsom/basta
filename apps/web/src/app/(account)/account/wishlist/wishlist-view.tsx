'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { ApiError, session } from '@/lib/api';
import { cartApi } from '@/lib/cart';
import { imageUrl } from '@/lib/storefront';
import { getWishlist, savedCount, setSaved, type WishlistItem } from '@/lib/wishlist';

/** «بقي N فقط» عند هذا العدد أو أقل — الحدّ نفسه في الخادم وبطاقة المنتج */
const LOW_STOCK = 3;

const FLAG: Partial<Record<WishlistItem['state'], { label: string; en: string; tone: string }>> = {
  sold_out: { label: 'نفد', en: 'Sold out', tone: 'badge--pending' },
  unavailable: { label: 'غير متاح', en: 'Unavailable', tone: 'badge--pending' },
  drop: { label: 'انخفض السعر', en: 'Price dropped', tone: 'badge--success' },
  rise: { label: 'ارتفع السعر', en: 'Price went up', tone: 'badge--warning' },
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
  const t = useT();
  const locale = useLocale();
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
        setError(e instanceof Error ? e.message : t('تعذّر جلب مفضّلتك.', "Couldn't load your wishlist."));
      });
    return () => {
      alive = false;
    };
  }, [router, t]);

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
      setStatus(t(`أُزيل «${item.nameAr}» من المفضّلة.`, `“${item.nameAr}” was removed from your wishlist.`));
      dropItem(item.productId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('تعذّرت الإزالة من المفضّلة.', "Couldn't remove it from your wishlist."));
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
      setError(e instanceof Error ? e.message : t('تعذّرت الإضافة إلى السلة.', "Couldn't add it to the cart."));
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
      setError(
        t(
          `أُضيف «${item.nameAr}» إلى سلّتك، لكن تعذّرت إزالته من المفضّلة. أزله يدوياً إن شئت.`,
          `“${item.nameAr}” was added to your cart, but we couldn't remove it from your wishlist. Remove it yourself if you like.`,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  const count = items?.length ?? 0;

  return (
    <div className="aa-page">
      <PageHead
        title={t('المفضّلة', 'Wishlist')}
        {...(items && count > 0 ? { count: savedCount(count, locale) } : {})}
        {...(items && count >= max
          ? { meta: t(`بلغت الحد (${max}) — أزل منتجاً لتحفظ غيره`, `You've reached the limit (${max}) — remove an item to save another`) }
          : {})}
      />

      <p className="visually-hidden" role="status">
        {status}
      </p>

      {moved ? (
        <div className="alert alert--success wl-moved" role="status">
          <Icon name="check-circle" size={17} />
          <span>
            {t(`نُقل «${moved}» إلى سلّتك.`, `“${moved}” was moved to your cart.`)}{' '}
            <Link href="/cart">{t('اذهب إلى السلة', 'Go to cart')}</Link>
          </span>
        </div>
      ) : null}

      {error ? (
        <Alert tone="danger" title={t('لم يكتمل الطلب', "The request didn't go through")}>
          {error}
        </Alert>
      ) : null}

      {!items && !error ? (
        <div className="wl-skel" role="status">
          <span className="visually-hidden">{t('جارٍ جلب مفضّلتك…', 'Loading your wishlist…')}</span>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skeleton wl-skel__card" aria-hidden />
          ))}
        </div>
      ) : null}

      {items && count === 0 ? (
        <EmptyState
          icon="heart"
          title={t('مفضّلتك فارغة', 'Your wishlist is empty')}
          actions={
            suggestions.length > 0 ? (
              suggestions.map((c) => (
                <Link key={c.slug} href={`/s/${encodeURIComponent(c.slug)}`} className="btn btn--secondary">
                  {c.nameAr}
                </Link>
              ))
            ) : (
              <Link href="/" className="btn btn--primary">
                {t('تصفّح المتجر', 'Browse the store')}
              </Link>
            )
          }
        >
          {t(
            'احفظ ما يعجبك بضغطة على القلب، وتجده هنا بسعره الآن — ونقول لك إن تغيّر سعره منذ حفظته أو قارب النفاد.',
            "Save what you like with a tap on the heart and find it here at today's price — we'll tell you if its price has changed since you saved it or if it's running out.",
          )}
        </EmptyState>
      ) : null}

      {items && count > 0 ? (
        <ul className="wl-grid" ref={grid} tabIndex={-1} aria-label={t('المنتجات المحفوظة', 'Saved items')}>
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
  const t = useT();
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
        {flag ? <span className={`badge ${flag.tone} wl-card__flag`}>{t(flag.label, flag.en)}</span> : null}
        <button
          type="button"
          className="wl-card__remove"
          data-wl-remove={item.productId}
          aria-label={t(`أزل «${item.nameAr}» من المفضّلة`, `Remove “${item.nameAr}” from wishlist`)}
          title={t('أزل من المفضّلة', 'Remove from wishlist')}
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
                <span className="visually-hidden">{t('سعره عند الحفظ ', 'Price when saved ')}</span>
                {item.savedPrice.formatted}
              </s>
            ) : null}
          </p>
        ) : null}

        {gone ? <p className="wl-card__note">{t('لم يعد معروضاً في المتجر', 'No longer listed in the shop')}</p> : null}
        {soldOut ? <p className="wl-card__note">{t('نفد من المتجر', 'Sold out at the shop')}</p> : null}
        {changed && item.delta ? (
          <p className="wl-card__note" data-tone={item.state === 'drop' ? 'success' : 'warning'}>
            {item.state === 'drop' ? t('انخفض', 'Dropped by') : t('ارتفع', 'Went up by')}{' '}
            <span className="num">{item.delta.formatted}</span> {t('منذ حفظه', 'since you saved it')}
          </p>
        ) : null}
        {few && !soldOut && !gone ? (
          <p className="wl-card__note" data-tone="warning">
            {t('بقي', 'Only')} <span className="num">{item.available}</span> {t('فقط', 'left')}
          </p>
        ) : null}

        <div className="wl-card__action">
          {gone ? (
            <button type="button" className="btn btn--secondary wl-card__btn" disabled>
              {t('غير متاح', 'Unavailable')}
            </button>
          ) : soldOut ? (
            <button type="button" className="btn btn--secondary wl-card__btn" disabled>
              <Icon name="cart" size={15} />
              {t('نفد', 'Sold out')}
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
              {busy ? t('جارٍ النقل…', 'Moving…') : t('انقله إلى السلة', 'Move to cart')}
            </button>
          ) : (
            <Link href={href} className="btn btn--primary wl-card__btn">
              {t('اختر الخيارات', 'Choose options')}
              <Icon name="chev-end" size={14} mirror />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
