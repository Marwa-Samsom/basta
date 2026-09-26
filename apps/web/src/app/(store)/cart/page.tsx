'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Alert, EmptyState, PageHead } from '@/components/ui';
import { cartApi, type CartLine, type CartView } from '@/lib/cart';
import { imageUrl } from '@/lib/storefront';

/** الصورة المصغّرة من مفتاح صورة المنتج — المسار نفسه الذي يبنيه الخادم لبطاقات المتجر */
const thumbOf = (key: string | null): string | null => (key ? imageUrl(`/uploads/${key}/thumb.webp`) : null);

/** تمييز العدد بالعربية يتغيّر بالعدد نفسه — «2 قطع» خطأ، والصواب «قطعتان» */
function pieces(n: number): string {
  if (n === 1) return 'قطعة واحدة';
  if (n === 2) return 'قطعتان';
  if (n <= 10) return `${n} قطع`;
  return `${n} قطعة`;
}

function fromStores(n: number): string {
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
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void cartApi
      .get()
      .then((c) => {
        if (alive) setCart(c);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'تعذّر تحميل السلة.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function run(action: () => Promise<CartView>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setCart(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحديث السلة.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="sp-skel" role="status">
        <span className="visually-hidden">جارٍ تحميل سلّتك…</span>
        <span className="skeleton sp-skel__title" aria-hidden />
        <span className="skeleton sp-skel__block" aria-hidden />
        <span className="skeleton sp-skel__block" aria-hidden />
      </div>
    );
  }

  if (!cart || cart.itemCount === 0) {
    return (
      <div className="sp-page sp-page--lg">
        <PageHead title="سلّتك" meta="لا قطع" />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <EmptyState
          icon="cart"
          title="سلّتك فارغة"
          actions={
            <Link className="btn btn--primary" href="/">
              تصفّح المنتجات
            </Link>
          }
        >
          تصفّح المتاجر وأضف ما يعجبك — تبقى السلة محفوظة أسبوعاً.
        </EmptyState>
      </div>
    );
  }

  const blocked = cart.blockers.length > 0;
  const hasDiscount = cart.totals.discount.minorUnits !== '0';
  const hasTax = cart.totals.tax.minorUnits !== '0';

  return (
    <div className="sp-page sp-page--lg">
      <PageHead title="سلّتك" meta={`${pieces(cart.itemCount)} ${fromStores(cart.groups.length)}`} />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {blocked ? (
        <Alert tone="warning" title="قبل الدفع">
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
                <h2 className="sp-group__name">{g.vendorNameAr}</h2>
                <span className="sp-group__meta">يُشحن منفصلاً</span>
              </header>

              {g.lines.map((l) => (
                <CartRow key={l.variantId} line={l} busy={busy} onQty={(qty) => void run(() => cartApi.setQty(l.variantId, qty))} />
              ))}

              <div className="sp-group__foot">
                <p className="sp-kv">
                  <span>مجموع قطع المتجر</span>
                  <span className="sp-kv__v money num">{g.subtotal.formatted}</span>
                </p>
                <p className="sp-kv">
                  <span>شحن هذا المتجر</span>
                  {g.shipping ? (
                    <span className="sp-kv__v money num">{g.shipping.formatted}</span>
                  ) : (
                    <span className="sp-kv__v sp-kv__v--muted">يُحسب بعد إدخال العنوان</span>
                  )}
                </p>
              </div>
            </section>
          ))}

          <form
            className="card sp-coupon"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => cartApi.coupon(coupon || null));
            }}
          >
            <label className="sp-coupon__label" htmlFor="coupon">
              كود الخصم
            </label>
            <div className="sp-coupon__row">
              <input
                id="coupon"
                className="field__control"
                placeholder="رمز الكوبون"
                dir="ltr"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              />
              <button type="submit" className="btn btn--secondary" disabled={busy}>
                طبّق
              </button>
            </div>
            {cart.couponCode ? (
              <p className="sp-coupon__ok">
                <Icon name="check-circle" size={14} />
                الكوبون المطبَّق: <span className="num">{cart.couponCode}</span>
              </p>
            ) : null}
          </form>
        </div>

        <aside className="sp-aside" aria-label="ملخّص الطلب">
          <div className="sp-sum">
            <h2 className="sp-sum__title">ملخّص الطلب</h2>
            <dl className="sp-sum__rows">
              <div>
                <dt>قيمة المنتجات</dt>
                <dd className="num">{cart.totals.items.formatted}</dd>
              </div>
              <div>
                <dt>الشحن (كل المتاجر)</dt>
                {cart.shippingKnown ? (
                  <dd className="num">{cart.totals.shipping.formatted}</dd>
                ) : (
                  <dd className="sp-sum__muted">يُحسب بعد إدخال العنوان</dd>
                )}
              </div>
              <div>
                <dt>الخصم</dt>
                {hasDiscount ? (
                  <dd className="num sp-sum__saving">− {cart.totals.discount.formatted}</dd>
                ) : (
                  <dd className="sp-sum__muted">—</dd>
                )}
              </div>
              {hasTax ? (
                <div>
                  <dt>{cart.taxInclusive ? 'الضريبة (مشمولة)' : 'الضريبة'}</dt>
                  <dd className="num">{cart.totals.tax.formatted}</dd>
                </div>
              ) : null}
              <div className="sp-sum__total">
                <dt>الإجمالي التقديري</dt>
                <dd className="money num">{cart.totals.total.formatted}</dd>
              </div>
            </dl>
            <p className="sp-sum__fx">الأسعار بعملة كل متجر، وتُحوَّل إلى {cart.currency} عند الدفع.</p>
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
              إتمام الشراء
              <Icon name="next" size={17} mirror />
            </Link>
            <p className={`sp-note ${blocked ? 'sp-note--danger' : ''}`}>
              <Icon name="lock" size={13} />
              {blocked ? 'عالج ما في التنبيه أعلى الصفحة لتكمل الشراء.' : 'يُثبَّت السعر ويُحجز المخزون لحظة الدفع.'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CartRow({ line: l, busy, onQty }: { line: CartLine; busy: boolean; onQty: (qty: number) => void }) {
  const src = thumbOf(l.imageKey);
  const soldOut = l.available === 0;
  const short = l.available < l.qty;
  const stock = soldOut
    ? { cls: 'sp-stock--out', text: 'نفدت الكمية' }
    : l.available <= 3
      ? { cls: 'sp-stock--low', text: `بقي ${l.available} فقط` }
      : { cls: '', text: 'متوفّر' };

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
        <span className="sp-line__name">{l.nameAr}</span>
        {l.variantLabel ? <span className="sp-line__variant">{l.variantLabel}</span> : null}
        {l.priceChanged ? (
          <span className="sp-flag sp-flag--info">
            <Icon name="info" size={13} />
            تغيّر السعر منذ أضفته
          </span>
        ) : null}
        {short ? (
          <span className="sp-flag sp-flag--danger" role="alert">
            <Icon name="alert" size={13} />
            {soldOut ? 'نفدت هذه القطعة بعد إضافتها — أزلها لتكمل الشراء' : `المتاح ${l.available} فقط — أنقص الكمية لتكمل الشراء`}
          </span>
        ) : null}

        <div className="sp-line__controls">
          <span className="sp-qty" role="group" aria-label={`كمية ${l.nameAr}`}>
            <button
              type="button"
              className="sp-qty__btn"
              aria-label="أنقص"
              disabled={busy || l.qty <= 1}
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
              aria-label="زد"
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
            aria-label={`أزل ${l.nameAr}`}
            disabled={busy}
            onClick={() => onQty(0)}
          >
            <Icon name="trash" size={14} />
            أزل
          </button>
        </div>
      </div>

      <div className="sp-line__price">
        <span className="sp-line__total money num">{l.lineTotal.formatted}</span>
        <span className="sp-line__unit num">
          {l.unitPrice.formatted} × {l.qty}
        </span>
      </div>
    </div>
  );
}
