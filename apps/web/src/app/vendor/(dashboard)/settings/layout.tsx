import type { Metadata } from 'next';
import { serverT } from '@/lib/i18n-server';

/** الصفحة نفسها في العميل (تبويبات وجلسة) — العنوان من هنا */
export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t('الإعدادات', 'Settings'), robots: { index: false } };
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
