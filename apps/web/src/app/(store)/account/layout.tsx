import '@/styles/screens/account-area.css';
import { AccountNav } from './account-nav';

/**
 * قشرة منطقة الحساب — ST-23…ST-28 تشترك في عمود تنقّل 220px بجانب المحتوى.
 *
 * مكوّن خادم لا يعرف الجلسة: كل صفحة تحته تحوّل غير الداخل إلى الدخول
 * بنفسها، والقشرة لا تمنع شيئاً ولا تطلب شيئاً إلا عدّاد التنقّل لمن دخل.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="aa-shell">
      <AccountNav />
      <div className="aa-main">{children}</div>
    </div>
  );
}
