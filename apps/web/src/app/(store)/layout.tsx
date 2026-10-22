import '@/styles/screens/storefront-discovery.css';
import '@/styles/screens/storefront-purchase.css';
import { StoreShell } from '@/components/store-shell';
import { requestCurrency } from '@/lib/currency-server';
import { getCurrencies } from '@/lib/storefront';

/**
 * قشرة المتجر — ST-01 بشكل لوحة البائع منذ 22 أكتوبر 2026 (StoreShell): شريط جانبي
 * بالأقسام، وشريط علوي فيه البحث والعملة والجرس والسلة.
 *
 * مكوّن خادم يقرأ العملة وحده: المختارة إن كانت متاحة، وإلا افتراضية الإدارة.
 * data-currency منه تقرأ السلة والمفضّلة — فلا تختلف عملة صفحة عن سلّتها.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [money, chosen] = await Promise.all([getCurrencies(), requestCurrency()]);
  const currency = chosen && money.currencies.some((c) => c.code === chosen) ? chosen : money.defaultCurrency;

  return (
    <div className="store-root" data-currency={currency}>
      <StoreShell currency={currency} currencies={money.currencies}>
        {children}
      </StoreShell>
    </div>
  );
}
