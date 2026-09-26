'use client';

import { useRouter } from 'next/navigation';
import { Alert, Spinner } from '@/components/ui';
import { useOnboarding } from '@/lib/vendor';
import { NotificationBell } from '@/components/notification-bell';
import { DashIdent, DashShell, type DashNavGroup } from '@/components/dash-shell';
import { Icon } from '@/components/icons';

/**
 * أقسام اللوحة بترتيب ملف التصميم. الاستيراد الجماعي يُفتح من صفحة المنتجات
 * (VD-07) لا من الشريط، ويُضيء «المنتجات» حين يكون مفتوحاً.
 */
const NAV: DashNavGroup[] = [
  {
    items: [
      { href: '/vendor', label: 'الرئيسية', icon: 'chart', exact: true },
      { href: '/vendor/products', label: 'المنتجات', icon: 'package' },
      { href: '/vendor/inventory', label: 'المخزون', icon: 'boxes' },
      { href: '/vendor/orders', label: 'الطلبات', icon: 'truck' },
      { href: '/vendor/disputes', label: 'المرتجعات والنزاعات', icon: 'return' },
      { href: '/vendor/finance', label: 'المحفظة', icon: 'wallet' },
      { href: '/vendor/store', label: 'ملف المتجر', icon: 'store' },
    ],
  },
];

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  approved: { label: 'معتمد', tone: 'success' },
  suspended: { label: 'معلَّق', tone: 'warning' },
  banned: { label: 'محظور', tone: 'danger' },
};

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
  const { data, loading, missing, error } = useOnboarding();

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

  const status = STATUS[data.status];

  return (
    <DashShell
      ident={
        <DashIdent
          href="/vendor/store"
          name={data.nameAr}
          sub={status?.label ?? data.status}
          tone={status?.tone}
          mark={
            <span className="tile-icon" aria-hidden>
              <Icon name="store" size={18} />
            </span>
          }
        />
      }
      groups={NAV}
      tools={<NotificationBell />}
      banner={
        data.status === 'suspended' ? (
          <Alert tone="danger" title="متجرك معلَّق مؤقتاً — منتجاتك مخفية عن المشترين">
            لا تستطيع نشر منتج جديد، وطلباتك القائمة تُكمَل كما هي. راسل الدعم لمعرفة السبب ورفع التعليق.
          </Alert>
        ) : null
      }
    >
      {children}
    </DashShell>
  );
}
