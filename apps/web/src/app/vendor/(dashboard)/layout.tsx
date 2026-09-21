'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Spinner, StatusBadge } from '@/components/ui';
import { useOnboarding } from '@/lib/vendor';

const NAV = [
  { href: '/vendor', label: 'المؤشرات' },
  { href: '/vendor/orders', label: 'الطلبات' },
  { href: '/vendor/disputes', label: 'النزاعات' },
  { href: '/vendor/finance', label: 'المحفظة' },
  { href: '/vendor/products', label: 'المنتجات' },
  { href: '/vendor/inventory', label: 'المخزون' },
  { href: '/vendor/products/import', label: 'الاستيراد الجماعي' },
  { href: '/vendor/store', label: 'ملف المتجر' },
] as const;

/**
 * قشرة لوحة البائع — §6.2.
 *
 * الكثافة `compact` هنا لا في المتجر: اللوحة تُشغَّل ولا تُقرأ، فصفوف أقصر
 * تعني جدولاً أطول في الشاشة الواحدة. والشريط يصير درجاً على الجوال.
 *
 * البائع المعلَّق يرى لوحته ولا يُمنع منها: منعُه يخفي عنه سبب التعليق
 * ورصيده ومنتجاته. الشريط أعلى الصفحة يقول الحال، والإجراءات تُمنع في مكانها.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, loading, missing, error } = useOnboarding();
  const [open, setOpen] = useState(false);

  if (missing) {
    router.replace('/vendor/register');
    return null;
  }

  if (loading && !data) {
    return (
      <main className="shell">
        <Spinner label="جارٍ فتح لوحتك…" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="shell">
        <Alert tone="danger">{error ?? 'تعذّر فتح اللوحة.'}</Alert>
      </main>
    );
  }

  // التأهيل غير مكتمل: اللوحة بلا معنى قبله، والطريق واحد
  if (data.status === 'pending' || data.status === 'in_review' || data.status === 'rejected') {
    router.replace('/vendor/onboarding/status');
    return null;
  }

  return (
    <div className="dash" data-density="compact">
      <header className="dash__bar">
        <button
          type="button"
          className="btn btn--secondary btn--sm dash__menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          القائمة
        </button>
        <Link href="/vendor" className="dash__brand">
          بسطة · لوحة البائع
        </Link>
        <span className="row">
          <span className="small muted">{data.nameAr}</span>
          <StatusBadge status={data.status} />
        </span>
      </header>

      <div className="dash__body">
        <nav className="dash__nav" data-open={open} aria-label="أقسام اللوحة">
          {NAV.map((item) => {
            const active = item.href === '/vendor' ? pathname === '/vendor' : pathname.startsWith(item.href);
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
        </nav>

        <main className="dash__main">
          {data.status === 'suspended' ? (
            <Alert tone="warning" title="متجرك معلَّق">
              منتجاتك لا تظهر للمشترين ولا تستطيع نشر جديد. راسل الدعم لمعرفة التفاصيل.
            </Alert>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
