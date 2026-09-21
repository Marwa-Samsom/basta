'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Spinner } from '@/components/ui';
import { api, ApiError, session } from '@/lib/api';
import type { Me } from '@/lib/admin';
import { MeContext, can } from '@/components/admin-context';

/** كل عنصر يظهر لمن يملك صلاحيته — لا رابط يفتح صفحة تقول «ممنوع» */
const NAV: { href: string; label: string; perm?: string; group: string }[] = [
  { href: '/admin', label: 'اللوحة', group: 'عام' },
  { href: '/admin/vendors', label: 'البائعون', perm: 'vendors.review', group: 'التشغيل' },
  { href: '/admin/products', label: 'مراجعة المنتجات', perm: 'catalog.manage', group: 'التشغيل' },
  { href: '/admin/orders', label: 'الطلبات', perm: 'orders.manage', group: 'التشغيل' },
  { href: '/admin/returns', label: 'المرتجعات والاستردادات', perm: 'orders.manage', group: 'التشغيل' },
  { href: '/admin/disputes', label: 'النزاعات', perm: 'disputes.resolve', group: 'التشغيل' },
  { href: '/admin/customers', label: 'العملاء', perm: 'customers.manage', group: 'التشغيل' },
  { href: '/admin/payouts', label: 'السحوبات', perm: 'payouts.approve', group: 'المال' },
  { href: '/admin/commissions', label: 'العمولات', perm: 'commissions.edit', group: 'المال' },
  { href: '/admin/currencies', label: 'العملات والصرف', perm: 'settings.edit', group: 'المال' },
  { href: '/admin/reports', label: 'التقارير', perm: 'reports.view', group: 'المال' },
  { href: '/admin/categories', label: 'الفئات والسمات', perm: 'catalog.manage', group: 'المحتوى' },
  { href: '/admin/coupons', label: 'الكوبونات', perm: 'coupons.manage', group: 'المحتوى' },
  { href: '/admin/storefront', label: 'البانرات والمميّز', perm: 'content.manage', group: 'المحتوى' },
  { href: '/admin/pages', label: 'صفحات المحتوى', perm: 'content.manage', group: 'المحتوى' },
  { href: '/admin/reviews', label: 'مراجعات المنتجات', perm: 'content.manage', group: 'المحتوى' },
  { href: '/admin/notifications', label: 'قوالب الإشعارات', perm: 'content.manage', group: 'المحتوى' },
  { href: '/admin/users', label: 'مستخدمو الإدارة', perm: 'users.manage', group: 'النظام' },
  { href: '/admin/audit', label: 'سجل التدقيق', perm: 'audit.view', group: 'النظام' },
  { href: '/admin/settings', label: 'الإعدادات والضرائب', perm: 'settings.edit', group: 'النظام' },
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
  const [open, setOpen] = useState(false);

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
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <MeContext.Provider value={me}>
      <div className="dash" data-density="compact">
        <header className="dash__bar">
          <button type="button" className="btn btn--secondary btn--sm dash__menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            القائمة
          </button>
          <Link href="/admin" className="dash__brand">
            بسطة · الإدارة
          </Link>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              session.clear();
              router.replace('/login?next=/admin');
            }}
          >
            خروج
          </button>
        </header>
        <div className="dash__body">
          <nav className="dash__nav" data-open={open} aria-label="أقسام الإدارة">
            {groups.map((g) => (
              <div key={g} className="stack stack--tight">
                <span className="small muted">{g}</span>
                {items
                  .filter((i) => i.group === g)
                  .map((item) => {
                    const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="dash__link"
                        data-active={active}
                        {...(active ? { 'aria-current': 'page' as const } : {})}
                        onClick={() => setOpen(false)}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
              </div>
            ))}
          </nav>
          <main className="dash__main">{children}</main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
