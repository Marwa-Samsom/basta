'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cartApi, CART_EVENT } from '@/lib/cart';
import { Icon } from '@/components/icons';

/**
 * زرّ السلة في رأس المتجر — ST-01. العدد من الخادم لا من ذاكرة المتصفّح:
 * السلة تعيش في الخادم، والرمز وحده محلي. يُحدَّث عند كل تغيير في السلة
 * (حدث `CART_EVENT`) وعند العودة إلى التبويب.
 */
export function CartButton() {
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

  return (
    <Link href="/cart" className="icon-btn" aria-label={count ? `السلة — ${count}` : 'السلة'}>
      <Icon name="cart" size={19} />
      {count > 0 ? <span className="icon-btn__count">{count > 99 ? '99+' : count}</span> : null}
    </Link>
  );
}

/** رقائق الأقسام تحت الرأس — القسم المفتوح بلون العلامة الخفيف */
export function CategoryStrip({ categories }: { categories: { slug: string; nameAr: string }[] }) {
  const pathname = usePathname();
  return (
    <>
      {categories.map((c) => {
        const href = `/c/${c.slug}`;
        const active = decodeURIComponent(pathname) === href;
        return (
          <Link
            key={c.slug}
            href={href}
            className="store__cat"
            {...(active ? { 'aria-current': 'page' as const } : {})}
          >
            {c.nameAr}
          </Link>
        );
      })}
    </>
  );
}
