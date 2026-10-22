'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DashIdent, DashShell, type DashNavGroup, type DashNavItem } from '@/components/dash-shell';
import { Icon } from '@/components/icons';
import { LogoutButton } from '@/components/logout-button';
import { NotificationBell } from '@/components/notification-bell';
import { api, session } from '@/lib/api';
import { NOTIFICATIONS_CHANGED } from '@/lib/addresses';

/** ترتيب ملف التصميم: الطلبات، ثم المفضّلة والرسائل، ثم الباقي */
const NAV: readonly DashNavItem[] = [
  // «حسابي» يطابق مساره وحده؛ البقية تطابق ما تحتها أيضاً (تفاصيل الطلب تحت «طلباتي»)
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
const PANELS: readonly { item: DashNavItem; roles: readonly string[] }[] = [
  { item: { href: '/admin', label: 'لوحة الإدارة', icon: 'shield' }, roles: ['admin'] },
  { item: { href: '/vendor', label: 'لوحة التاجر', icon: 'store' }, roles: ['vendor_owner', 'vendor_staff'] },
];

const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};

/**
 * قشرة الحساب على قشرة اللوحتين نفسها: الأقسام في الشريط الجانبي (ودرج على الجوال)،
 * وعنوان القسم المفتوح في الشريط العلوي. عدّاد غير المقروء يظهر لمن دخل وحده،
 * ويتحدّث حين تعلّم صفحة الإشعارات شيئاً مقروءاً.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  const signedIn = useSyncExternalStore(subscribe, () => !!session.read(), () => false);
  // نصّ لا مصفوفة: لقطة useSyncExternalStore تُقارَن بالمساواة، والمصفوفة جديدة كل قراءة
  const roles = useSyncExternalStore(subscribe, () => session.roles().join(','), () => '').split(',');
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

  const panels = PANELS.filter((p) => p.roles.some((r) => roles.includes(r))).map((p) => p.item);
  const groups: DashNavGroup[] = [
    {
      items: NAV.map((item) =>
        item.href === '/account/notifications' && signedIn && unread > 0 ? { ...item, count: unread } : item,
      ),
    },
    ...(panels.length > 0 ? [{ label: 'لوحاتك', items: panels }] : []),
  ];

  return (
    <DashShell
      density="comfortable"
      ident={
        <DashIdent
          href="/account"
          name="حسابي"
          sub="بسطة"
          mark={
            <span className="tile-icon" aria-hidden>
              <Icon name="user" size={18} />
            </span>
          }
        />
      }
      groups={groups}
      tools={signedIn ? <NotificationBell /> : null}
      exitHref="/"
      sideFoot={
        signedIn ? (
          <LogoutButton className="btn btn--ghost btn--sm btn--block" next="/">
            خروج
          </LogoutButton>
        ) : null
      }
    >
      {children}
    </DashShell>
  );
}
