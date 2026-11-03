'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { useLocale, useT } from '@/components/locale';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { cartApi, type CartLine, type CartView } from '@/lib/cart';
import { nameIn, type Locale } from '@/lib/i18n';
import { imageUrl } from '@/lib/storefront';
import { useReturnTick } from '@/lib/fresh';

/** الصورة المصغّرة من مفتاح صورة المنتج — المسار نفسه الذي يبنيه الخادم لبطاقات المتجر */
const thumbOf = (key: string | null): string | null => (key ? imageUrl(`/uploads/${key}/thumb.webp`) : null);

/** تمييز العدد بالعربية يتغيّر بالعدد نفسه — «2 قطع» خطأ، والصواب «قطعتان» */
function pieces(n: number, locale: Locale): string {
  if (locale === 'en') return n === 1 ? '1 item' : `${n} items`;
  if (n === 1) return 'قطعة واحدة';
  if (n === 2) return 'قطعتان';
  if (n <= 10) return `${n} قطع`;
  return `${n} قطعة`;
}

function fromStores(n: number, locale: Locale): string {
  if (locale === 'en') return n === 1 ? 'from 1 shop' : `from ${n} shops`;
  if (n === 1) return 'من متجر واحد';
  if (n === 2) return 'من متجرين';
  if (n <= 10) return `من ${n} متاجر`;
  return `من ${n} متجراً`;
}

/**
 * ST-13 السلة، و ST-14 السلة الفارغة.
 *
 * مجمّعة حسب البائع لأن كل بائع يشحن وحده: المشتري يرى أن طلبه سيصله في
 * طردين أو ثلاثة قبل أن يدفع، لا بعد. والمانع يظهر فوق زرّ الدفع لا بعده.
 */
export default function CartPage() {
  const t = useT();
  const locale = useLocale();
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState('');
  /** رفض الكوبون تحت خانته — في رأس الصفحة لا يراه من ضغط «طبّق» أسفلها على الجوال (CHK-018) */
  const [couponError, setCouponError] = useState<string | null>(null);
  const couponInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const returned = useReturnTick();
  useEffect(() => {
    let alive = true;
    void cartApi
      .get()
      .then((c) => {
        if (alive) setCart(c);
      })
      .catch((err: unknown) => {
        // فشل التحديث عند الرجوع لا يستبدل السلة برسالة
        if (alive && !returned) setError(err instanceof Error ? err.message : t('تعذّر تحميل السلة.', "Couldn't load the cart."));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [t, returned]);

  async function run(action: () => Promise<CartView>, fail: (message: string) => void = setError): Promise<void> {
    setBusy(true);
    setError(null);
    setCouponError(null);
    try {
      setCart(await action());
    } catch (err) {
      fail(err instanceof Error ? err.message : t('تعذّر تحديث السلة.', "Couldn't update the cart."));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="sp-skel" role="status">
        <span className="visually-hidden">{t('جارٍ تحميل سلّتك…', 'Loading your cart…')}</span>
        <span className="skeleton sp-skel__title" aria-hidden />
        <span className="skeleton sp-skel__block" aria-hidden />
        <span className="skeleton sp-skel__block" aria-hidden />
      </div>
    );
  }

  if (!cart || cart.itemCount === 0) {
    return (
      <div className="sp-page sp-page--lg">
        <PageHead title={t('سلّتك', 'Your cart')} meta={t('لا قطع', 'No items')} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <EmptyState
          icon="cart"
          title={t('سلّتك فارغة', 'Your cart is empty')}
          actions={
            <Link className="btn btn--primary" href="/">
              {t('تصفّح المنتجات', 'Browse products')}
            </Link>
          }
        >
          {t('تصفّح المتاجر وأضف ما يعجبك — تبقى السلة محفوظة أسبوعاً.', 'Browse the shops and add what you like — your cart is kept for a week.')}
        </EmptyState>
      </div>
    );
  }

  const blocked = cart.blockers.length > 0;
  const hasDiscount = cart.totals.discount.minorUnits !== '0';
  const hasTax = cart.totals.tax.minorUnits !== '0';

  return (
    <div className="sp-page sp-page--lg">
      <PageHead title={t('سلّتك', 'Your cart')} meta={`${pieces(cart.itemCount, locale)} ${fromStores(cart.groups.length, locale)}`} />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {blocked ? (
        <Alert tone="warning" title={t('قبل الدفع', 'Before you pay')}>
          <ul className="blockers">
            {cart.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="sp-layout">
        <div className="sp-main">
          {cart.groups.map((g) => (
            <section key={g.vendorId} className="sp-group">
              <header className="sp-group__head">
                <span className="tile-icon sp-tile" aria-hidden>
                  <Icon name="store" size={15} />
                </span>
                <h2 className="sp-group__name">{nameIn(locale, { nameAr: g.vendorNameAr, nameEn: g.vendorNameEn })}</h2>
                <span className="sp-group__meta">{t('يُشحن منفصلاً', 'Ships separately')}</span>
              </header>

              {g.lines.map((l) => (
                <CartRow key={l.variantId} line={l} busy={busy} onQty={(qty) => void run(() => cartApi.setQty(l.variantId, qty))} />
              ))}

              <div className="sp-group__foot">
                <p className="sp-kv">
                  <span>{t('مجموع قطع المتجر', 'Shop items subtotal')}</span>
                  <span className="sp-kv__v money num">{g.subtotal.formatted}</span>
                </p>
                <p className="sp-kv">
                  <span>{t('شحن هذا المتجر', 'Shipping for this shop')}</span>
                  {g.shipping ? (
                    <span className="sp-kv__v money num">{g.shipping.formatted}</span>
                  ) : (
                    <span className="sp-kv__v sp-kv__v--muted">{t('يُحسب بعد إدخال العنوان', 'Calculated once you enter the address')}</span>
                  )}
                </p>
              </div>
            </section>
          ))}

          <form
            className="card sp-coupon"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => cartApi.coupon(coupon || null), setCouponError);
            }}
          >
            <label className="sp-coupon__label" htmlFor="coupon">
              {t('كود الخصم', 'Discount code')}
            </label>
            <div className="sp-coupon__row">
              {/* الرمز لاتيني يُكتب من اليسار، فالحقل وزرّ محوه يساراً-يميناً: ✕ في نهاية الرمز */}
              <span className="sp-coupon__field" dir="ltr">
                <input
                  ref={couponInput}
                  id="coupon"
                  className="field__control"
                  placeholder={t('رمز الكوبون', 'Coupon code')}
                  value={coupon}
                  aria-invalid={couponError ? true : undefined}
                  aria-describedby={couponError ? 'coupon-error' : undefined}
                  onChange={(e) => {
                    setCoupon(e.target.value.toUpperCase());
                    setCouponError(null);
                  }}
                />
                {/* يمحو المكتوب ويُبقي المؤشّر في الخانة (27 أكتوبر 2026، بطلب صاحبة المشروع) */}
                {coupon ? (
                  <button
                    type="button"
                    className="sp-coupon__clear"
                    aria-label={t('امسح الرمز', 'Clear code')}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setCoupon('');
                      setCouponError(null);
                      couponInput.current?.focus();
                    }}
                  >
                    <Icon name="x" size={15} />
                  </button>
                ) : null}
              </span>
              <button type="submit" className="btn btn--secondary" disabled={busy}>
                {t('طبّق', 'Apply')}
              </button>
            </div>
            {couponError ? (
              <p id="coupon-error" className="field__error" role="alert">
                {couponError}
              </p>
            ) : null}
            {cart.couponCode ? (
              <p className="sp-coupon__ok">
                <Icon name="check-circle" size={14} />
                {t('الكوبون المطبَّق:', 'Applied coupon:')} <span className="num">{cart.couponCode}</span>
                {/* كان يُزال بـ«طبّق» والخانة فارغة وحدها — طريق لا يراه أحد (27 أكتوبر 2026) */}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm sp-coupon__remove"
                  aria-label={t(`أزل الكوبون ${cart.couponCode}`, `Remove coupon ${cart.couponCode}`)}
                  disabled={busy}
                  onClick={() => {
                    setCoupon('');
                    void run(() => cartApi.coupon(null), setCouponError);
                  }}
                >
                  {t('أزل', 'Remove')}
                </button>
              </p>
            ) : null}
          </form>
        </div>

        <aside className="sp-aside" aria-label={t('ملخّص الطلب', 'Order summary')}>
          <div className="sp-sum">
            <h2 className="sp-sum__title">{t('ملخّص الطلب', 'Order summary')}</h2>
            <dl className="sp-sum__rows">
              <div>
                <dt>{t('قيمة المنتجات', 'Items')}</dt>
                <dd className="num">{cart.totals.items.formatted}</dd>
              </div>
              <div>
                <dt>{t('الشحن (كل المتاجر)', 'Shipping (all shops)')}</dt>
                {cart.shippingKnown ? (
                  <dd className="num">{cart.totals.shipping.formatted}</dd>
                ) : (
                  <dd className="sp-sum__muted">{t('يُحسب بعد إدخال العنوان', 'Calculated once you enter the address')}</dd>
                )}
              </div>
              <div>
                <dt>{t('الخصم', 'Discount')}</dt>
                {hasDiscount ? (
                  <dd className="num sp-sum__saving">− {cart.totals.discount.formatted}</dd>
                ) : (
                  <dd className="sp-sum__muted">—</dd>
                )}
              </div>
              {hasTax ? (
                <div>
                  <dt>{cart.taxInclusive ? t('الضريبة (مشمولة)', 'Tax (included)') : t('الضريبة', 'Tax')}</dt>
                  <dd className="num">{cart.totals.tax.formatted}</dd>
                </div>
              ) : null}
              <div className="sp-sum__total">
                <dt>{t('الإجمالي التقديري', 'Estimated total')}</dt>
                <dd className="money num">{cart.totals.total.formatted}</dd>
              </div>
            </dl>
            {cart.groups.some((g) => g.storeCurrency !== cart.currency) ? (
              <p className="sp-sum__fx">
                {locale === 'en' ? (
                  <>
                    All amounts are in your currency (<span className="num">{cart.currency}</span>) at today&apos;s exchange
                    rate, and that is what you pay; the shop&apos;s price in its own currency is under each item. Change the
                    currency from the page header.
                  </>
                ) : (
                  <>
                    كل المبالغ بعملتك (<span className="num">{cart.currency}</span>) بسعر صرف اليوم، وهي ما تدفعه؛ سعر
                    المتجر بعملته تحت قطعته. تغيّر العملة من رأس الصفحة.
                  </>
                )}
              </p>
            ) : null}
          </div>

          <div className="sp-bar">
            <span className="sp-bar__total money num" aria-hidden>
              {cart.totals.total.formatted}
            </span>
            <Link
              className="btn btn--primary btn--block sp-cta"
              href={blocked ? '#' : '/checkout'}
              aria-disabled={blocked}
              {...(blocked ? { onClick: (e: React.MouseEvent) => e.preventDefault() } : {})}
            >
              {t('إتمام الشراء', 'Checkout')}
              <Icon name="next" size={17} mirror />
            </Link>
            <p className={`sp-note ${blocked ? 'sp-note--danger' : ''}`}>
              <Icon name="lock" size={13} />
              {blocked
                ? t('عالج ما في التنبيه أعلى الصفحة لتكمل الشراء.', 'Resolve the issues in the alert at the top of the page to check out.')
                : t('يُثبَّت السعر ويُحجز المخزون لحظة الدفع.', 'The price is locked and the stock reserved the moment you pay.')}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CartRow({ line: l, busy, onQty }: { line: CartLine; busy: boolean; onQty: (qty: number) => void }) {
  const t = useT();
  const locale = useLocale();
  const src = thumbOf(l.imageKey);
  const gone = l.unavailable === true;
  const soldOut = l.available === 0;
  const short = l.available < l.qty;
  const stock = gone
    ? { cls: 'sp-stock--out', text: t('غير متاح', 'Unavailable') }
    : soldOut
      ? { cls: 'sp-stock--out', text: t('نفدت الكمية', 'Sold out') }
      : l.available <= 3
        ? { cls: 'sp-stock--low', text: t(`بقي ${l.available} فقط`, `Only ${l.available} left`) }
        : { cls: '', text: t('متوفّر', 'In stock') };

  return (
    <div className={`sp-line ${short ? 'sp-line--problem' : ''}`}>
      <span className="sp-thumb" aria-hidden>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" width={64} height={64} />
        ) : (
          <Icon name="image" size={24} />
        )}
      </span>

      <div className="sp-line__body">
        <span className="sp-line__name">{nameIn(locale, l)}</span>
        {l.variantLabel ? <span className="sp-line__variant">{l.variantLabel}</span> : null}
        {l.priceChanged ? (
          <span className="sp-flag sp-flag--info">
            <Icon name="info" size={13} />
            {t('تغيّر السعر منذ أضفته', 'Price changed since you added it')}
          </span>
        ) : null}
        {short ? (
          <span className="sp-flag sp-flag--danger" role="alert">
            <Icon name="alert" size={13} />
            {gone
              ? t('لم تعد هذه القطعة تُباع — أزلها لتكمل الشراء', 'This item is no longer sold — remove it to check out')
              : soldOut
                ? t('نفدت هذه القطعة بعد إضافتها — أزلها لتكمل الشراء', 'This item sold out after you added it — remove it to check out')
                : t(
                    `المتاح ${l.available} فقط — أنقص الكمية لتكمل الشراء`,
                    `Only ${l.available} available — reduce the quantity to check out`,
                  )}
          </span>
        ) : null}

        <div className="sp-line__controls">
          <span className="sp-qty" role="group" aria-label={t(`كمية ${l.nameAr}`, `Quantity of ${nameIn(locale, l)}`)}>
            <button
              type="button"
              className="sp-qty__btn"
              aria-label={t('أنقص', 'Decrease')}
              disabled={busy || gone || l.qty <= 1}
              onClick={() => onQty(l.qty - 1)}
            >
              <Icon name="minus" size={14} />
            </button>
            <span className="sp-qty__val num" aria-live="polite">
              {l.qty}
            </span>
            <button
              type="button"
              className="sp-qty__btn"
              aria-label={t('زد', 'Increase')}
              disabled={busy || l.qty >= l.available}
              onClick={() => onQty(l.qty + 1)}
            >
              <Icon name="plus" size={14} />
            </button>
          </span>
          <span className={`sp-stock ${stock.cls}`}>{stock.text}</span>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            aria-label={t(`أزل ${l.nameAr}`, `Remove ${nameIn(locale, l)}`)}
            disabled={busy}
            onClick={() => onQty(0)}
          >
            <Icon name="trash" size={14} />
            {t('أزل', 'Remove')}
          </button>
        </div>
      </div>

      {gone ? (
        // لا سعر يُعرض لما لا يُباع — ولا يدخل الإجمالي
        <div className="sp-line__price">
          <span className="sp-line__total">—</span>
        </div>
      ) : (
        <div className="sp-line__price">
          <span className="sp-line__total money num">{l.lineTotal.formatted}</span>
          <span className="sp-line__unit num">
            {l.unitPrice.formatted} × {l.qty}
          </span>
          {l.originalLineTotal ? (
            <span className="sp-line__store">
              <span className="num">{l.originalLineTotal.formatted}</span> {t('بعملة المتجر', "in the shop's currency")}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
