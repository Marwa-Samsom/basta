'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon, type IconName } from '@/components/icons';
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
      </ul>
    </nav>
  );
}
