import '@/styles/screens/storefront-discovery.css';
import '@/styles/screens/storefront-purchase.css';
import '@/styles/screens/account-area.css';
import { requestCurrency } from '@/lib/currency-server';
import { getCurrencies } from '@/lib/storefront';
import { AccountShell } from './account-nav';

/**
 * قشرة منطقة الحساب — ST-23…ST-28 بشكل لوحة البائع (22 أكتوبر 2026، بطلب صاحبة
 * المشروع): شريط جانبي بالأقسام، وشريط علوي بعنوان القسم والجرس والوضع و«✕» إلى
 * المتجر. لا رأس متجر ولا بحث ولا شريط متاجر ولا تذييل — الحساب يُشغَّل لا يُتصفَّح.
 *
 * خارج قشرة المتجر فتحمل ما كانت تأخذه منها: أنماط بطاقات المنتج والطلب، و
 * `data-currency` التي تقرأ منها المفضّلة والسلة عملة الصفحة.
 *
 * مكوّن خادم لا يعرف الجلسة: كل صفحة تحته تحوّل غير الداخل إلى الدخول بنفسها.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const [money, chosen] = await Promise.all([getCurrencies(), requestCurrency()]);
  const currency = chosen && money.currencies.some((c) => c.code === chosen) ? chosen : money.defaultCurrency;

  return (
    <div className="aa-root" data-currency={currency}>
      <AccountShell>{children}</AccountShell>
    </div>
  );
}
