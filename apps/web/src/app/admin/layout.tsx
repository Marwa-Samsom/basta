'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import '@/styles/screens/admin-operations.css';
import '@/styles/screens/admin-catalog-system.css';
import { DashIdent, DashShell, type DashNavGroup } from '@/components/dash-shell';
import type { IconName } from '@/components/icons';
import { Alert, Spinner } from '@/components/ui';
import { api, ApiError, session } from '@/lib/api';
import type { Me } from '@/lib/admin';
import { MeContext, can } from '@/components/admin-context';

/** كل عنصر يظهر لمن يملك صلاحيته — لا رابط يفتح صفحة تقول «ممنوع» */
const NAV: { href: string; label: string; icon: IconName; perm?: string; group: string; exact?: boolean }[] = [
  { href: '/admin', label: 'لوحة المؤشرات', icon: 'chart', group: 'التشغيل', exact: true },
  { href: '/admin/vendors', label: 'المتاجر', icon: 'store', perm: 'vendors.review', group: 'التشغيل' },
  { href: '/admin/products', label: 'مراجعة المنتجات', icon: 'package', perm: 'catalog.manage', group: 'التشغيل' },
  { href: '/admin/orders', label: 'الطلبات', icon: 'truck', perm: 'orders.manage', group: 'التشغيل' },
  { href: '/admin/payouts', label: 'طلبات التحويل', icon: 'wallet', perm: 'payouts.approve', group: 'التشغيل' },
  { href: '/admin/disputes', label: 'النزاعات', icon: 'scale', perm: 'disputes.resolve', group: 'التشغيل' },
  { href: '/admin/returns', label: 'المرتجعات', icon: 'return', perm: 'orders.manage', group: 'التشغيل' },
  { href: '/admin/customers', label: 'العملاء', icon: 'users', perm: 'customers.manage', group: 'التشغيل' },
  { href: '/admin/reviews', label: 'التقييمات', icon: 'star', perm: 'content.manage', group: 'التشغيل' },
  { href: '/admin/categories', label: 'التصنيفات والخصائص', icon: 'package', perm: 'catalog.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/coupons', label: 'الكوبونات', icon: 'star', perm: 'coupons.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/campaigns', label: 'الحملات', icon: 'chart', perm: 'content.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/storefront', label: 'الواجهة واللافتات', icon: 'image', perm: 'content.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/pages', label: 'صفحات المحتوى', icon: 'file', perm: 'content.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/notifications', label: 'قوالب الإشعارات', icon: 'msg', perm: 'content.manage', group: 'الكتالوج والمحتوى' },
  { href: '/admin/commissions', label: 'قواعد العمولة', icon: 'scale', perm: 'commissions.edit', group: 'المال' },
  { href: '/admin/currencies', label: 'العملات والصرف', icon: 'wallet', perm: 'settings.edit', group: 'المال' },
  { href: '/admin/reports', label: 'التقارير', icon: 'chart', perm: 'reports.view', group: 'المال' },
  { href: '/admin/users', label: 'مستخدمو الإدارة', icon: 'users', perm: 'users.manage', group: 'النظام' },
  { href: '/admin/audit', label: 'سجلّ التدقيق', icon: 'shield', perm: 'audit.view', group: 'النظام' },
  { href: '/admin/settings', label: 'الإعدادات والضرائب', icon: 'lock', perm: 'settings.edit', group: 'النظام' },
];

/**
 * قشرة الإدارة — AD-01 و AD-02 في الدخول: الرمز المحدود (مدير بلا تحقق
 * ثنائي) يُحوَّل لتفعيله قبل أي شيء، ولا زرّ «تخطٍّ».
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.read()) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    let alive = true;
    api<Me>('/auth/me')
      .then((m) => {
        if (!alive) return;
        if (!m.roles.includes('admin')) setError('هذه اللوحة للإدارة وحدها.');
        else setMe(m);
      })
      .catch((e: Error) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 403 && /الثنائي/.test(e.message)) router.replace('/account/2fa');
        else setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [pathname, router]);

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
        <Spinner label="جارٍ فتح لوحة الإدارة…" />
      </main>
    );
  }

  const items = NAV.filter((n) => can(me, n.perm));
  const groups: DashNavGroup[] = [...new Set(items.map((i) => i.group))].map((g) => ({
    label: g,
    items: items.filter((i) => i.group === g),
  }));
  const role = me.permissions.includes('users.manage') ? 'مدير عام' : 'مدير';

  return (
    <MeContext.Provider value={me}>
      <DashShell
        tone="inverse"
        ident={
          <DashIdent
            href="/admin"
            name="لوحة الإدارة"
            sub={role}
            mark={
              <span className="dash__mark" aria-hidden>
                ب
              </span>
            }
          />
        }
        groups={groups}
        sideFoot={
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--block"
            onClick={() => {
              session.clear();
              router.replace('/login?next=/admin');
            }}
          >
            خروج
          </button>
        }
      >
        {children}
      </DashShell>
    </MeContext.Provider>
  );
}
