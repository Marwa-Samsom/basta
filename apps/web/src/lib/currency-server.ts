import { cookies } from 'next/headers';
import { getCurrencies } from './storefront';

/** عملة العرض التي اختارها المشتري — من كوكيه. بلا كوكي: زائر جديد لم يختر */
async function requestCurrency(): Promise<string | undefined> {
  const value = (await cookies()).get('basta.currency')?.value;
  return value && /^[A-Z]{3}$/.test(value) ? value : undefined;
}

/**
 * العملة التي تُصيَّر بها الصفحة: المختارة إن كانت متاحة، وإلا افتراضية الإدارة.
 * منها وحدها الرأس (`data-currency`) والسلة والأسعار، فلا تختلف عملة سعر عن سلّته.
 *
 * كانت الصفحات ترسل الكوكي وحده، فأسعار الزائر الجديد بافتراضية الخادم (نسخة دقيقة)
 * ورأسه وسلّته بنسخة خمس دقائق: بعد تغيير الإدارة لها رأسٌ بعملة وأسعار بأخرى،
 * والتغيير لا يبلغه إلا بعد دقائق (ACFG-107، 1 نوفمبر 2026). getCurrencies يُستدعى
 * في القشرة والصفحة معاً، و Next يجمعهما في طلب واحد لكل صفحة.
 */
export async function pageCurrency(): Promise<string> {
  const [money, chosen] = await Promise.all([getCurrencies(), requestCurrency()]);
  return chosen && money.currencies.some((c) => c.code === chosen) ? chosen : money.defaultCurrency;
}
