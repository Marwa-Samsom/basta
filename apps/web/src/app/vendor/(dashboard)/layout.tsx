'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import '@/styles/screens/vendor-products.css';
import '@/styles/screens/vendor-orders-money.css';
// ملف المتجر (VD-05) داخل اللوحة يشارك أنماط التأهيل
import '@/styles/screens/vendor-onboarding.css';
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
      { href: '/vendor/shipping', label: 'الشحن', icon: 'truck' },
      { href: '/vendor/finance', label: 'المحفظة', icon: 'wallet' },
      { href: '/vendor/reports', label: 'التقارير', icon: 'chart' },
      { href: '/vendor/store', label: 'ملف المتجر', icon: 'store' },
      { href: '/vendor/notifications', label: 'الإشعارات', icon: 'bell' },
    ],
  },
];

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  approved: { label: 'معتمد', tone: 'success' },
  in_review: { label: 'قيد المراجعة', tone: 'warning' },
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

  /**
   * التأهيل لم يُرسَل أو رُفض: الطريق واحد، إلى صفحة الحالة. أمّا قيد
   * المراجعة فيدخل — VD-03 يدعوه لتجهيز منتجاته مسوّداتٍ أثناء الانتظار،
   * والنشر وحده ممنوع حتى الاعتماد (مانع في الخادم). منعُه من اللوحة كان
   * يعيد رابط «هيّئ منتجاتك» إلى صفحة الحالة نفسها في حلقة.
   */
  if (data.status === 'pending' || data.status === 'rejected') {
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
        data.status === 'in_review' ? (
          <Alert tone="info" title="متجرك قيد المراجعة">
            جهّز منتجاتك الآن — تُحفظ مسوّداتٍ، وتستطيع إرسالها للنشر فور اعتماد متجرك.{' '}
            <Link href="/vendor/onboarding/status">تابع حالة طلبك</Link>
          </Alert>
        ) : data.status === 'suspended' ? (
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
