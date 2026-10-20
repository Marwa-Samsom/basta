import { cookies } from 'next/headers';

/**
 * عملة العرض التي اختارها المشتري — من كوكيه، للمكوّنات التي تُصيَّر في الخادم.
 * بلا كوكي (زائر جديد) لا تُرسل عملة، فيعرض الخادم ما تحدّده الإدارة.
 */
export async function requestCurrency(): Promise<string | undefined> {
  const value = (await cookies()).get('basta.currency')?.value;
  return value && /^[A-Z]{3}$/.test(value) ? value : undefined;
}
