'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Spinner } from '@/components/ui';
import { cartApi, type CartView } from '@/lib/cart';

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

  if (loading) return <Spinner label="جارٍ تحميل سلّتك…" />;

  if (!cart || cart.itemCount === 0) {
    return (
      <div className="empty">
        <h1>سلّتك فارغة</h1>
        <p>تصفّح المتاجر وأضف ما يعجبك — تبقى السلة محفوظة أسبوعاً.</p>
        <Link className="btn btn--primary" href="/">
          تسوّق الآن
        </Link>
      </div>
    );
  }

  const blocked = cart.blockers.length > 0;

  return (
    <div className="checkout">
      <div className="stack">
        <h1>سلّتك</h1>
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

        {cart.groups.map((g) => (
          <section key={g.vendorId} className="card">
            <header className="card__title">
              <h2>{g.vendorNameAr}</h2>
              <span className="small muted">يُشحن منفصلاً</span>
            </header>
            {g.lines.map((l) => (
              <div key={l.variantId} className="cart-line">
                <div className="grow stack stack--tight">
                  <span className="field__label">{l.nameAr}</span>
                  {l.variantLabel ? <span className="small muted">{l.variantLabel}</span> : null}
                  {l.priceChanged ? <span className="badge badge--warning">تغيّر السعر منذ أضفته</span> : null}
                  {l.available < l.qty ? (
                    <span className="field__error">
                      {l.available === 0 ? 'نفد' : `المتاح ${l.available} فقط`}
                    </span>
                  ) : null}
                </div>
                <div className="row">
                  <label className="visually-hidden" htmlFor={`qty-${l.variantId}`}>
                    كمية {l.nameAr}
                  </label>
                  <select
                    id={`qty-${l.variantId}`}
                    className="field__control"
                    value={l.qty}
                    disabled={busy}
                    onChange={(e) => void run(() => cartApi.setQty(l.variantId, Number(e.target.value)))}
                  >
                    {Array.from({ length: Math.max(10, l.qty) }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className="money num">{l.lineTotal.formatted}</span>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={busy}
                    onClick={() => void run(() => cartApi.setQty(l.variantId, 0))}
                  >
                    احذف
                  </button>
                </div>
              </div>
            ))}
            <p className="small row row--between">
              <span>مجموع هذا المتجر</span>
              <span className="money num">{g.subtotal.formatted}</span>
            </p>
          </section>
        ))}
      </div>

      <aside className="card summary">
        <h2>الملخّص</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => cartApi.coupon(coupon || null));
          }}
        >
          <label className="visually-hidden" htmlFor="coupon">
            رمز الكوبون
          </label>
          <input
            id="coupon"
            className="field__control grow"
            placeholder="رمز الكوبون"
            dir="ltr"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
          />
          <button type="submit" className="btn btn--secondary" disabled={busy}>
            طبّق
          </button>
        </form>
        {cart.couponCode ? <p className="small">الكوبون المطبَّق: <span className="num">{cart.couponCode}</span></p> : null}

        <dl className="summary__rows">
          <div>
            <dt>المنتجات</dt>
            <dd className="money num">{cart.totals.items.formatted}</dd>
          </div>
          {cart.totals.discount.minorUnits !== '0' ? (
            <div>
              <dt>الخصم</dt>
              <dd className="money num">− {cart.totals.discount.formatted}</dd>
            </div>
          ) : null}
          <div>
            <dt>الشحن</dt>
            <dd className="small muted">يُحسب بعد إدخال العنوان</dd>
          </div>
          <div className="summary__total">
            <dt>الإجمالي التقديري</dt>
            <dd className="money num">{cart.totals.total.formatted}</dd>
          </div>
        </dl>
        <p className="small muted">الأسعار بعملة كل متجر، وتُحوَّل إلى {cart.currency} عند الدفع.</p>

        <Link
          className={`btn btn--primary btn--block ${blocked ? 'is-disabled' : ''}`}
          href={blocked ? '#' : '/checkout'}
          aria-disabled={blocked}
        >
          إتمام الشراء
        </Link>
      </aside>
    </div>
  );
}
