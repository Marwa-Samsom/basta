'use client';

import Link from 'next/link';
import { useSyncExternalStore, type ReactNode } from 'react';
import { CurrencyPicker } from '@/components/currency-picker';
import { DashIdent, DashShell, type DashNavGroup, type DashNavItem } from '@/components/dash-shell';
import { NotificationBell } from '@/components/notification-bell';
import { SearchBox } from '@/components/search-box';
import { CartButton, useCartCount } from '@/components/store-chrome';
import { session } from '@/lib/api';
import type { CurrencyOption } from '@/lib/storefront';

/** صفحات المنصّة — كانت في التذييل، وصارت أسفل الشريط الجانبي */
const PAGES: readonly { href: string; label: string }[] = [
  { href: '/pages/about', label: 'من نحن' },
  { href: '/pages/faq', label: 'الأسئلة الشائعة' },
  { href: '/pages/returns', label: 'سياسة الإرجاع' },
  { href: '/pages/contact', label: 'اتصل بنا' },
];

const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};

/**
 * قشرة المتجر بشكل لوحة البائع — بطلب صاحبة المشروع (22 أكتوبر 2026): «بدي كل اشي
 * هيك شكلو». الأقسام في الشريط الجانبي (ودرج على الجوال)، والبحث والعملة والجرس
 * والسلة في الشريط العلوي. سقطت الزوائد: شريط المتاجر و«بِع على بسطة» الكبير
 * والتذييل — روابطها في الشريط الجانبي.
 *
 * الكثافة `comfortable`: المتجر يُقرأ. وطريق البائع والمدير إلى لوحتيهما من هنا أيضاً.
 */
export function StoreShell({
  currency,
  currencies,
  children,
}: {
  currency: string;
  currencies: CurrencyOption[];
  children: ReactNode;
}) {
  const cart = useCartCount();
  const signedIn = useSyncExternalStore(subscribe, () => !!session.read(), () => false);
  // نصّ لا مصفوفة: لقطة useSyncExternalStore تُقارَن بالمساواة، والمصفوفة جديدة كل قراءة
  const roles = useSyncExternalStore(subscribe, () => session.roles().join(','), () => '').split(',');

  const shop: DashNavItem[] = [
    { href: '/', label: 'الرئيسية', icon: 'grid', exact: true },
    { href: '/shops', label: 'كل المتاجر', icon: 'store' },
    { href: '/search', label: 'البحث', icon: 'search' },
    { href: '/cart', label: 'السلة', icon: 'cart', count: cart },
  ];
  const mine: DashNavItem[] = signedIn
    ? [
        { href: '/account/orders', label: 'طلباتي', icon: 'package' },
        { href: '/account/wishlist', label: 'المفضّلة', icon: 'heart' },
        { href: '/account', label: 'حسابي', icon: 'user', exact: true },
      ]
    : [{ href: '/login', label: 'ادخل أو أنشئ حساباً', icon: 'user' }];
  const work: DashNavItem[] = [
    ...(roles.includes('vendor_owner') || roles.includes('vendor_staff')
      ? [{ href: '/vendor', label: 'لوحة التاجر', icon: 'chart' as const }]
      : [{ href: '/sell', label: 'بِع على بسطة', icon: 'cash' as const }]),
    ...(roles.includes('admin') ? [{ href: '/admin', label: 'لوحة الإدارة', icon: 'shield' as const }] : []),
  ];
  const groups: DashNavGroup[] = [
    { items: shop },
    { label: 'حسابي', items: mine },
    { label: 'للتجّار', items: work },
  ];

  return (
    <DashShell
      density="comfortable"
      ident={<DashIdent href="/" name="بسطة" sub="سوق المتاجر المستقلة" mark={<span className="dash__mark">ب</span>} />}
      groups={groups}
      search={<SearchBox />}
      tools={
        <>
          <CurrencyPicker current={currency} options={currencies} />
          {signedIn ? <NotificationBell /> : null}
          <CartButton count={cart} />
        </>
      }
      sideFoot={
        <nav className="store-pages" aria-label="عن بسطة">
          {PAGES.map((p) => (
            <Link key={p.href} href={p.href}>
              {p.label}
            </Link>
          ))}
        </nav>
      }
    >
      <div className="store-body">{children}</div>
    </DashShell>
  );
}
