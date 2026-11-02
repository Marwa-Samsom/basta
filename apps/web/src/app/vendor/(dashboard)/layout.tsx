'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import '@/styles/screens/vendor-products.css';
import '@/styles/screens/vendor-orders-money.css';
// ملف المتجر (VD-05) داخل اللوحة يشارك أنماط التأهيل
import '@/styles/screens/vendor-onboarding.css';
import { Alert, Spinner } from '@/components/ui';
import { useOnboarding } from '@/lib/vendor';
import { NotificationBell } from '@/components/notification-bell';
import { LogoutButton } from '@/components/logout-button';
import { DashIdent, DashShell, type DashNavGroup } from '@/components/dash-shell';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale';

/**
 * أقسام اللوحة بترتيب ملف التصميم. الاستيراد الجماعي يُفتح من صفحة المنتجات
 * (VD-07) لا من الشريط، ويُضيء «المنتجات» حين يكون مفتوحاً.
 */
const NAV: DashNavGroup[] = [
  {
    items: [
      { href: '/vendor', label: 'الرئيسية', en: 'Home', icon: 'chart', exact: true },
      { href: '/vendor/products', label: 'المنتجات', en: 'Products', icon: 'package' },
      // فئات المتجر تحت المنتجات — يديرها البائع وحده (14 أكتوبر 2026)
      { href: '/vendor/categories', label: 'الفئات', en: 'Categories', icon: 'list' },
      { href: '/vendor/inventory', label: 'المخزون', en: 'Inventory', icon: 'boxes' },
      { href: '/vendor/orders', label: 'الطلبات', en: 'Orders', icon: 'truck' },
      { href: '/vendor/messages', label: 'الرسائل', en: 'Messages', icon: 'msg' },
      { href: '/vendor/disputes', label: 'المرتجعات والنزاعات', en: 'Returns & disputes', icon: 'return' },
      { href: '/vendor/shipping', label: 'الشحن', en: 'Shipping', icon: 'truck' },
      { href: '/vendor/finance', label: 'المحفظة', en: 'Wallet', icon: 'wallet' },
      { href: '/vendor/reports', label: 'التقارير', en: 'Reports', icon: 'chart' },
      { href: '/vendor/store', label: 'ملف المتجر', en: 'Shop profile', icon: 'store' },
      { href: '/vendor/notifications', label: 'الإشعارات', en: 'Notifications', icon: 'bell' },
      { href: '/vendor/settings', label: 'الإعدادات', en: 'Settings', icon: 'gear' },
    ],
  },
];

const STATUS: Record<string, { label: string; en: string; tone: 'success' | 'warning' | 'danger' }> = {
  approved: { label: 'معتمد', en: 'Approved', tone: 'success' },
  in_review: { label: 'قيد المراجعة', en: 'Under review', tone: 'warning' },
  suspended: { label: 'معلَّق', en: 'Suspended', tone: 'warning' },
  banned: { label: 'محظور', en: 'Banned', tone: 'danger' },
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
  const t = useT();
  const router = useRouter();
  const { data, loading, missing, error } = useOnboarding();
  const unsent = data?.status === 'pending' || data?.status === 'rejected';

  // إلى صفحة الحالة بعد الرسم لا أثناءه — كان React يرفضه («1 Issue»، VON-013، 28 أكتوبر 2026)
  useEffect(() => {
    if (unsent) router.replace('/vendor/onboarding/status');
  }, [unsent, router]);

  // التحويل إلى التسجيل في useOnboarding نفسه، بعد الرسم
  if (missing) return null;

  if (loading && !data) {
    return (
      <main className="shell">
        <Spinner label={t('جارٍ فتح لوحتك…', 'Opening your dashboard…')} />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="shell">
        <Alert tone="danger">{error ?? t('تعذّر فتح اللوحة.', "Couldn't open the dashboard.")}</Alert>
      </main>
    );
  }

  /**
   * التأهيل لم يُرسَل أو رُفض: الطريق واحد، إلى صفحة الحالة. أمّا قيد
   * المراجعة فيدخل — يضيف منتجاته وينشرها أثناء الانتظار، فتظهر للمشترين لحظة
   * اعتماد متجره (قاعدة الرؤية في الخادم، 15 أكتوبر 2026). منعُه من اللوحة كان
   * يعيد رابط «هيّئ منتجاتك» إلى صفحة الحالة نفسها في حلقة.
   */
  if (unsent) return null;

  const status = STATUS[data.status];

  return (
    <DashShell
      ident={
        <DashIdent
          href="/vendor/store"
          name={data.nameAr}
          sub={status ? t(status.label, status.en) : data.status}
          tone={status?.tone}
          mark={
            <span className="tile-icon" aria-hidden>
              <Icon name="store" size={18} />
            </span>
          }
        />
      }
      groups={NAV}
      tools={<NotificationBell allHref="/vendor/notifications" />}
      exitHref="/account"
      sideFoot={
        <LogoutButton className="btn btn--ghost btn--sm btn--block" next="/login">
          {t('خروج', 'Sign out')}
        </LogoutButton>
      }
      banner={
        data.status === 'in_review' ? (
          <Alert tone="info" title={t('متجرك قيد المراجعة', 'Your shop is under review')}>
            {t(
              'أضف منتجاتك وانشرها الآن — تظهر للمشترين تلقائياً لحظة اعتماد متجرك.',
              'Add and publish your products now — buyers see them the moment your shop is approved.',
            )}{' '}
            <Link href="/vendor/onboarding/status">{t('تابع حالة طلبك', 'Track your application')}</Link>
          </Alert>
        ) : data.status === 'suspended' ? (
          <Alert tone="danger" title={t('متجرك معلَّق مؤقتاً — منتجاتك مخفية عن المشترين', 'Your shop is temporarily suspended — your products are hidden from buyers')}>
            {t(
              'لا تستطيع نشر منتج جديد، وطلباتك القائمة تُكمَل كما هي. راسل الدعم لمعرفة السبب ورفع التعليق.',
              "You can't publish new products; open orders continue as usual. Contact support to learn why and lift the suspension.",
            )}
          </Alert>
        ) : null
      }
    >
      {children}
    </DashShell>
  );
}
