'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { ThemeToggle } from '@/components/theme-toggle';

export interface DashNavItem {
  href: string;
  label: string;
  icon: IconName;
  /** عدّاد ما ينتظر — يظهر حين يكون أكبر من صفر */
  count?: number | undefined;
  /** يطابق المسار حرفياً لا ببادئته — للرئيسية وأخواتها */
  exact?: boolean;
}

export interface DashNavGroup {
  label?: string;
  items: DashNavItem[];
}

/** أطول بادئة مطابقة تفوز: «/vendor/products/import» لا يُضيء «المنتجات» معه */
function activeHref(pathname: string, groups: DashNavGroup[]): string | null {
  let best: string | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    const hit = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}

/**
 * قشرة اللوحتين — ملفات التصميم: شريط جانبي بعرض 232 فيه هوية المتجر أو
 * الإدارة وأقسامها بأيقوناتها وعدّاداتها، وشريط علوي فيه عنوان القسم المفتوح
 * والجرس والمستخدم. اللوحتان بسطح الموقع نفسه — كان شريط الإدارة معكوساً
 * داكناً ليميّزها، وتوحّد بطلب صاحبة المشروع (17 أكتوبر 2026).
 */
export function DashShell({
  ident,
  groups,
  search,
  tools,
  user,
  sideFoot,
  banner,
  exitHref,
  density = 'compact',
  children,
}: {
  ident: ReactNode;
  groups: DashNavGroup[];
  /** صندوق بحث بين العنوان والأدوات — للمتجر؛ على الجوال سطر كامل تحت الشريط */
  search?: ReactNode;
  tools?: ReactNode;
  user?: { name: string; sub?: string | undefined } | undefined;
  sideFoot?: ReactNode;
  banner?: ReactNode;
  /** وجهة «✕» أعلى اللوحة: يغادرها إلى الموقع والجلسة باقية — غير «خروج» الذي ينهيها */
  exitHref?: string;
  /** اللوحتان تُشغَّلان (compact)، والمتجر والحساب يُقرآن (comfortable) — القشرة واحدة */
  density?: 'compact' | 'comfortable';
  children: ReactNode;
}) {
  const pathname = usePathname();
  // الدرج مفتوح على المسار الذي فُتح فيه وحده: الانتقال يغلقه بلا تأثير
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (next: boolean | ((v: boolean) => boolean)) =>
    setOpenAt((typeof next === 'function' ? next(open) : next) ? pathname : null);
  const current = activeHref(pathname, groups);
  const title = groups.flatMap((g) => g.items).find((i) => i.href === current)?.label ?? '';

  // و Esc يغلقه
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenAt(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="dash" data-density={density}>
      <aside className="dash__side" data-open={open} id="dash-side">
        {ident}
        <nav className="dash__nav" aria-label="أقسام اللوحة">
          {groups.map((g, gi) => (
            <div key={g.label ?? gi} className="dash__nav">
              {g.label ? <span className="dash__group">{g.label}</span> : null}
              {g.items.map((item) => {
                const active = item.href === current;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="dash__link"
                    data-active={active}
                    {...(active ? { 'aria-current': 'page' as const } : {})}
                  >
                    <Icon name={item.icon} size={17} />
                    <span className="dash__link-label">{item.label}</span>
                    {item.count ? <span className="dash__count">{item.count}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        {sideFoot ? <div className="dash__side-foot">{sideFoot}</div> : null}
      </aside>
      <div className="dash__scrim" data-open={open} onClick={() => setOpen(false)} aria-hidden />

      <div className="dash__col">
        <header className="dash__bar">
          <button
            type="button"
            className="icon-btn dash__menu"
            aria-label="القائمة"
            aria-expanded={open}
            aria-controls="dash-side"
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name="menu" size={18} />
          </button>
          {title ? <span className="dash__title">{title}</span> : null}
          {search ? <div className="dash__search">{search}</div> : null}
          <div className="dash__tools">
            <ThemeToggle />
            {tools}
            {user ? (
              <span className="dash__user">
                <span className="avatar" aria-hidden>
                  {user.name.trim().slice(0, 1)}
                </span>
                <span className="dash__user-name">{user.name}</span>
              </span>
            ) : null}
            {exitHref ? (
              <Link href={exitHref} className="icon-btn" aria-label="الخروج من اللوحة" title="الخروج من اللوحة">
                <Icon name="x" size={18} />
              </Link>
            ) : null}
          </div>
        </header>
        <main className="dash__main">
          {banner}
          {children}
        </main>
      </div>
    </div>
  );
}

/** هوية أعلى الشريط: مربّع أيقونة، واسم، وسطر حالة بنقطة لونها */
export function DashIdent({
  href,
  name,
  sub,
  tone,
  mark,
}: {
  href: string;
  name: string;
  sub?: string | undefined;
  tone?: 'success' | 'warning' | 'danger' | undefined;
  mark: ReactNode;
}) {
  return (
    <Link href={href} className="dash__ident">
      {mark}
      <span className="dash__ident-text">
        <span className="dash__ident-name">{name}</span>
        {sub ? (
          <span className="dash__ident-sub" {...(tone ? { 'data-tone': tone } : {})}>
            {tone ? <span className="dot" aria-hidden /> : null}
            {sub}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
