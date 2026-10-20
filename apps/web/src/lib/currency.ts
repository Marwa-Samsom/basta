'use client';

import { api, session } from './api';

/**
 * عملة العرض — قرار صاحبة المشروع 18 أكتوبر 2026: المشتري يختار عملة واحدة من
 * رأس المتجر، يرى بها الأسعار في الموقع كله ويدفع بها.
 *
 * الاختيار كوكي لا تخزين محلي: الصفحات تُصيَّر في الخادم (السعر في مصدر HTML)،
 * والخادم يقرأ الكوكي لا localStorage. والرأس يكتب العملة التي صيّر بها الصفحة
 * في `data-currency` — منه تقرأ السلة والمفضّلة، فلا تختلف عملة صفحة عن سلّتها.
 * وللمسجَّل تُحفظ في حسابه أيضاً فتتبعه إلى جهاز آخر حين يدخل.
 */
export const CURRENCY_COOKIE = 'basta.currency';
const CART_TOKEN_KEY = 'basta.cart';
const CODE = /^[A-Z]{3}$/;

/** العملة التي صُيّرت بها الصفحة الحالية */
export function displayCurrency(): string {
  if (typeof document === 'undefined') return 'JOD';
  return document.querySelector<HTMLElement>('[data-currency]')?.dataset['currency'] ?? 'JOD';
}

function readCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)basta\.currency=([A-Z]{3})/);
  return match?.[1] ?? null;
}

function writeCookie(code: string): void {
  // سنة؛ Lax كي يصل مع التنقّل العادي إلى الموقع
  document.cookie = `${CURRENCY_COOKIE}=${code}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * يختار المشتري عملة: الكوكي، والسلة القائمة، وحسابه إن كان داخلاً — ثم تُعاد
 * الصفحة كاملة، فكل سعر فيها (خادماً وعميلاً) يُقرأ بالعملة الجديدة.
 */
export async function chooseCurrency(code: string): Promise<void> {
  if (!CODE.test(code)) return;
  writeCookie(code);
  const cart = window.localStorage.getItem(CART_TOKEN_KEY);
  await Promise.allSettled([
    cart ? api('/cart/currency', { method: 'PUT', body: { currency: code }, headers: { 'x-cart-token': cart } }) : null,
    session.read() ? api('/me/account/currency', { method: 'PUT', body: { currency: code } }) : null,
  ]);
  window.location.reload();
}

/**
 * بعد الدخول: عملة الحساب تغلب كوكي هذا الجهاز؛ وحساب لم يختر بعد يأخذ ما
 * اختاره صاحبه زائراً. لا يُسقط الدخول أبداً — العملة تفضيل لا شرط.
 */
export async function syncAccountCurrency(): Promise<void> {
  try {
    const me = await api<{ preferredCurrency: string | null }>('/me/account');
    if (me.preferredCurrency && CODE.test(me.preferredCurrency)) {
      writeCookie(me.preferredCurrency);
      return;
    }
    const chosen = readCookie();
    if (chosen) await api('/me/account/currency', { method: 'PUT', body: { currency: chosen } });
  } catch {
    // بلا عملة محفوظة يبقى ما على هذا الجهاز
  }
}
