'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { LogoutButton } from '@/components/logout-button';
import { api, session } from '@/lib/api';
import { NOTIFICATIONS_CHANGED } from '@/lib/addresses';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** «حسابي» يطابق مساره وحده؛ البقية تطابق ما تحتها أيضاً (تفاصيل الطلب تحت «طلباتي») */
  exact?: boolean;
}

/** ترتيب ملف التصميم: الطلبات، ثم المفضّلة والرسائل، ثم الباقي */
const NAV: readonly NavItem[] = [
  { href: '/account', label: 'حسابي', icon: 'user', exact: true },
  { href: '/account/orders', label: 'طلباتي', icon: 'package' },
  { href: '/account/wishlist', label: 'المفضّلة', icon: 'heart' },
  { href: '/account/messages', label: 'رسائلي', icon: 'msg' },
  { href: '/account/addresses', label: 'العناوين', icon: 'pin' },
  { href: '/account/notifications', label: 'الإشعارات', icon: 'bell' },
  { href: '/account/recent', label: 'شوهد مؤخراً', icon: 'history' },
  { href: '/account/disputes', label: 'النزاعات', icon: 'shield' },
];

/**
 * لوحتا العمل لمن له دورهما — كان المدير والتاجر يدخلان «حسابي» فلا يجدان طريقاً
 * إلى لوحتيهما إلا بكتابة الرابط. الدور يُقرأ من الرمز للعرض وحده؛ اللوحة تفحصه بنفسها.
 */
const PANELS: readonly (NavItem & { roles: readonly string[] })[] = [
  { href: '/admin', label: 'لوحة الإدارة', icon: 'shield', roles: ['admin'] },
  { href: '/vendor', label: 'لوحة التاجر', icon: 'store', roles: ['vendor_owner', 'vendor_staff'] },
];

const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};

/**
 * تنقّل منطقة الحساب — عمود 220px في التصميم، وشريط أقراص على الجوال.
 * الرابط الحالي بـ `aria-current="page"`. عدّاد غير المقروء يظهر لمن دخل
 * وحده، ويتحدّث حين تعلّم صفحة الإشعارات شيئاً مقروءاً.
 */
export function AccountNav() {
  const pathname = usePathname();
  const signedIn = useSyncExternalStore(subscribe, () => !!session.read(), () => false);
  // نصّ لا مصفوفة: لقطة useSyncExternalStore تُقارَن بالمساواة، والمصفوفة جديدة كل قراءة
  const roles = useSyncExternalStore(subscribe, () => session.roles().join(','), () => '').split(',');
  const panels = PANELS.filter((p) => p.roles.some((r) => roles.includes(r)));
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const load = () =>
      api<{ unread: number }>('/me/notifications?limit=1')
        .then((d) => alive && setUnread(d.unread))
        .catch(() => undefined);
    void load();
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, [signedIn]);

  const isHere = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <nav className="aa-nav" aria-label="حسابي">
      <span className="aa-nav__title" aria-hidden>
        حسابي
      </span>
      <ul className="aa-nav__list">
        {NAV.map((item) => {
          const count = item.href === '/account/notifications' && signedIn && unread > 0 ? unread : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="aa-nav__link"
                {...(isHere(item) ? { 'aria-current': 'page' as const } : {})}
              >
                <Icon name={item.icon} size={17} />
                <span className="aa-nav__label">{item.label}</span>
                {count ? (
                  <span className="aa-nav__count">
                    {count}
                    <span className="visually-hidden"> غير مقروء</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        {panels.map((item, i) => (
          <li key={item.href} className={i === 0 ? 'aa-nav__group' : undefined}>
            <Link href={item.href} className="aa-nav__link aa-nav__link--panel">
              <Icon name={item.icon} size={17} />
              <span className="aa-nav__label">{item.label}</span>
            </Link>
          </li>
        ))}
        {signedIn ? (
          <li>
            <LogoutButton className="aa-nav__link aa-nav__link--out" next="/">
              <Icon name="lock" size={17} />
              <span className="aa-nav__label">خروج</span>
            </LogoutButton>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
