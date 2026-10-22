'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cartApi, CART_EVENT } from '@/lib/cart';
import { Icon } from '@/components/icons';

/**
 * عدد قطع السلة — من الخادم لا من ذاكرة المتصفّح: السلة تعيش في الخادم، والرمز
 * وحده محلي. يُحدَّث عند كل تغيير في السلة (حدث `CART_EVENT`) وعند العودة إلى التبويب.
 */
export function useCartCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      cartApi
        .get()
        .then((c) => alive && setCount(c?.itemCount ?? 0))
        .catch(() => undefined);
    void load();
    window.addEventListener(CART_EVENT, load);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener(CART_EVENT, load);
      window.removeEventListener('focus', load);
    };
  }, []);

  return count;
}

/** زرّ السلة في شريط المتجر العلوي — ST-01 */
export function CartButton({ count }: { count: number }) {
  return (
    <Link href="/cart" className="icon-btn" aria-label={count ? `السلة — ${count}` : 'السلة'}>
      <Icon name="cart" size={19} />
      {count > 0 ? <span className="icon-btn__count">{count > 99 ? '99+' : count}</span> : null}
    </Link>
  );
}
