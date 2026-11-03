'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import '@/styles/screens/admin-operations.css';
import '@/styles/screens/admin-catalog-system.css';
import { LogoutButton } from '@/components/logout-button';
import { NotificationBell } from '@/components/notification-bell';
import { DashIdent, DashShell, type DashNavGroup } from '@/components/dash-shell';
import type { IconName } from '@/components/icons';
import { Alert, Spinner } from '@/components/ui';
import { api, ApiError, session } from '@/lib/api';
import { useReturnTick } from '@/lib/fresh';
import type { Me } from '@/lib/admin';
import { MeContext, can } from '@/components/admin-context';
import { useT } from '@/components/locale';

const GROUP_EN: Record<string, string> = {
  'التشغيل': 'Operations',
  'الكتالوج والمحتوى': 'Catalog & content',
  'المال': 'Money',
  'النظام': 'System',
};

/** كل عنصر يظهر لمن يملك صلاحيته — لا رابط يفتح صفحة تقول «ممنوع» */
const NAV: { href: string; label: string; en: string; icon: IconName; perm?: string; group: string; exact?: boolean }[] = [
  { href: '/admin', label: 'لوحة المؤشرات', en: 'Dashboard', icon: 'chart', group: 'التشغيل', exact: true },
  // صندوق المدير (28 أكتوبر 2026): ما يصل الجرس كله، بلا صلاحية — كلٌّ يرى ما وصله
  { href: '/admin/notifications', label: 'الإشعارات', en: 'Notifications', icon: 'bell', group: 'التشغيل', exact: true },
  { href: '/admin/vendors', label: 'المتاجر', en: 'Shops', icon: 'store', perm: 'vendors.review', group: 'التشغيل' },
  // لا مراجعة قبل النشر (15 أكتوبر 2026) — القائمة لمتابعة المنشور وإيقاف المخالف
  { href: '/admin/products', label: 'المنتجات', en: 'Products', icon: 'package', perm: 'catalog.manage', group: 'التشغيل' },
  { href: '/admin/orders', label: 'الطلبات', en: 'Orders', icon: 'truck', perm: 'orders.manage', group: 'التشغيل' },
  { href: '/admin/transfers', label: 'تحويلات المشترين', en: 'Buyer transfers', icon: 'cash', perm: 'payouts.approve', group: 'التشغيل' },
  { href: '/admin/payouts', label: 'طلبات التحويل', en: 'Payout requests', icon: 'wallet', perm: 'payouts.approve', group: 'التشغيل' },
  { href: '/admin/disputes', label: 'النزاعات', en: 'Disputes', icon: 'scale', perm: 'disputes.resolve', group: 'التشغيل' },
  { href: '/admin/returns', label: 'المرتجعات', en: 'Returns', icon: 'return', perm: 'orders.manage', group: 'التشغيل' },
  { href: '/admin/customers', label: 'العملاء', en: 'Customers', icon: 'users', perm: 'customers.manage', group: 'التشغيل' },
  { href: '/admin/reviews', label: 'التقييمات', en: 'Reviews', icon: 'star', perm: 'content.manage', group: 'التشغيل' },
  // الفئات لكل متجر يديرها البائع (14 أكتوبر 2026) — للإدارة مكتبة الخصائص وحدها
  { href: '/admin/attributes', label: 'الخصائص', en: 'Attributes', icon: 'list', perm: 'catalog.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/coupons', label: 'الكوبونات', en: 'Coupons', icon: 'star', perm: 'coupons.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/campaigns', label: 'الحملات', en: 'Campaigns', icon: 'chart', perm: 'content.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/storefront', label: 'الواجهة واللافتات', en: 'Storefront & banners', icon: 'image', perm: 'content.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/pages', label: 'صفحات المحتوى', en: 'Content pages', icon: 'file', perm: 'content.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/notifications/templates', label: 'قوالب الإشعارات', en: 'Notification templates', icon: 'msg', perm: 'content.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/commissions', label: 'العمولة', en: 'Commission', icon: 'scale', perm: 'commissions.edit', group: 'المال' },
  { href: '/admin/currencies', label: 'العملات والصرف', en: 'Currencies & rates', icon: 'wallet', perm: 'settings.edit', group: 'المال' },
  { href: '/admin/reports', label: 'التقارير', en: 'Reports', icon: 'chart', perm: 'reports.view', group: 'المال' },
  { href: '/admin/users', label: 'مستخدمو الإدارة', en: 'Admin users', icon: 'users', perm: 'users.manage', group: 'النظام' },
  { href: '/admin/audit', label: 'سجلّ التدقيق', en: 'Audit log', icon: 'shield', perm: 'audit.view', group: 'النظام' },
  { href: '/admin/settings', label: 'الإعدادات والضرائب', en: 'Settings & taxes', icon: 'lock', perm: 'settings.edit', group: 'النظام' },
];

/**
 * قشرة الإدارة — AD-01 و AD-02 في الدخول: الرمز المحدود (مدير بلا تحقق
 * ثنائي) يُحوَّل لتفعيله قبل أي شيء، ولا زرّ «تخطٍّ».
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  // الرجوع إلى اللوحة يعيد قراءة الصلاحيات بصمت — مُنحت أو سُحبت وهي مفتوحة
  const returned = useReturnTick();
  useEffect(() => {
    if (!session.read()) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    let alive = true;
    api<Me>('/auth/me')
      .then((m) => {
        if (!alive) return;
        if (!m.roles.includes('admin')) setError(t('هذه اللوحة للإدارة وحدها.', 'This dashboard is for admins only.'));
        else setMe(m);
      })
      .catch((e: Error) => {
        if (!alive || returned) return;
        if (e instanceof ApiError && e.status === 403 && (e.code === 'TOTP_SETUP_REQUIRED' || /الثنائي/.test(e.message))) router.replace('/account/2fa');
        else setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [pathname, router, t, returned]);

  if (error) {
    return (
      <main className="shell">
        <Alert tone="danger">{error}</Alert>
      </main>
    );
  }
  if (!me) {
    return (
      <main className="shell">
        <Spinner label={t('جارٍ فتح لوحة الإدارة…', 'Opening the admin dashboard…')} />
      </main>
    );
  }

  const items = NAV.filter((n) => can(me, n.perm));
  const groups: DashNavGroup[] = [...new Set(items.map((i) => i.group))].map((g) => ({
    label: g,
    en: GROUP_EN[g],
    items: items.filter((i) => i.group === g),
  }));
  const role = me.permissions.includes('users.manage') ? t('مدير عام', 'Super admin') : t('مدير', 'Admin');

  return (
    <MeContext.Provider value={me}>
      <DashShell
        ident={
          <DashIdent
            href="/admin"
            name={t('لوحة الإدارة', 'Admin dashboard')}
            sub={role}
            mark={
              <span className="dash__mark" aria-hidden>
                {t('ب', 'B')}
              </span>
            }
          />
        }
        groups={groups}
        exitHref="/account"
        // الجرس نفسه الذي في لوحة البائع: يصل المدير ما يخصّ صلاحياته — نزاع مصعَّد، طلب سحب
        tools={<NotificationBell allHref="/admin/notifications" />}
        sideFoot={
          <LogoutButton className="btn btn--ghost btn--sm btn--block" next="/login?next=/admin">
            {t('خروج', 'Sign out')}
          </LogoutButton>
        }
      >
        {children}
      </DashShell>
    </MeContext.Provider>
  );
}
