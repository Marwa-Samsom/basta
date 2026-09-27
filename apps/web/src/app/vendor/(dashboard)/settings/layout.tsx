import type { Metadata } from 'next';

/** الصفحة نفسها في العميل (تبويبات وجلسة) — العنوان من هنا */
export const metadata: Metadata = { title: 'الإعدادات', robots: { index: false } };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
