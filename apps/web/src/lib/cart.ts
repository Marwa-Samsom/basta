'use client';

import { api, ApiError } from './api';
import { displayCurrency } from './currency';
import { localStore } from './storage';

/**
 * السلة في المتصفّح — رمز في التخزين المحلي، والسلة نفسها في الخادم.
 * الرمز يُرسل في ترويسة لا في العنوان: العنوان يتسرّب في السجلات وترويسة Referer.
 */

const TOKEN_KEY = 'basta.cart';

/** يُطلق بعد كل تعديل على السلة — رأس المتجر يعيد قراءة العدد */
export const CART_EVENT = 'basta:cart';
const changed = <T>(value: T): T => {
  window.dispatchEvent(new Event(CART_EVENT));
  return value;
};
export interface Money {
  minorUnits: string;
  currency?: string;
  formatted: string;
}

export interface CartLine {
  variantId: string;
  productId: string;
  nameAr: string;
  nameEn?: string | null;
  variantLabel: string | null;
  imageKey: string | null;
  qty: number;
  available: number;
  /** بعملة السلة — عملة العرض التي يدفع بها */
  unitPrice: Money;
  lineTotal: Money;
  /** بعملة المتجر حين تختلف عن عملة السلة */
  originalUnitPrice: Money | null;
  originalLineTotal: Money | null;
  priceChanged: boolean;
  /** لم يعد يُباع (أُوقف أو أُرشف أو عُلّق متجره) — يُزال، ولا يدخل الإجمالي */
  unavailable?: boolean;
}

export interface CartView {
  token: string;
  currency: string;
  itemCount: number;
  groups: {
    vendorId: string;
    vendorNameAr: string;
    vendorNameEn?: string | null;
    storeCurrency: string;
    lines: CartLine[];
    subtotal: Money;
    shipping: Money | null;
  }[];
  totals: Record<'items' | 'discount' | 'shipping' | 'tax' | 'total', Money>;
  shippingKnown: boolean;
  taxInclusive: boolean;
  couponCode: string | null;
  blockers: string[];
}

const readToken = (): string | null => localStore.get(TOKEN_KEY);

/**
 * ينسى المتصفّح سلّته عند الخروج (CHK-020، 27 أكتوبر 2026): كان رمزها يبقى فيرى من يستعمل
 * الجهاز بعده سلّة من خرج ويدفعها بحسابه. السلة نفسها تبقى في الخادم باسم صاحبها.
 */
export function forgetCart(): void {
  localStore.remove(TOKEN_KEY);
  window.dispatchEvent(new Event(CART_EVENT));
}

export const cartHeaders = (): Record<string, string> => {
  const token = readToken();
  return token ? { 'x-cart-token': token } : {};
};

async function ensureToken(): Promise<string> {
  const existing = readToken();
  if (existing) return existing;
  const cart = await api<CartView>('/cart', { method: 'POST', body: { currency: displayCurrency() } });
  localStore.set(TOKEN_KEY, cart.token);
  return cart.token;
}

/** يُستدعى مرة ثانية بسلة جديدة إن انتهت القديمة — الرمز المنتهي لا يترك المشتري عالقاً */
async function withCart<T>(run: (token: string) => Promise<T>): Promise<T> {
  const token = await ensureToken();
  try {
    return await run(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && (err.details?.['resource'] === 'cart' || /السلة/.test(err.message))) {
      localStore.remove(TOKEN_KEY);
      return run(await ensureToken());
    }
    throw err;
  }
}

export const cartApi = {
  get: (): Promise<CartView | null> => {
    const token = readToken();
    if (!token) return Promise.resolve(null);
    return api<CartView>('/cart', { headers: { 'x-cart-token': token } })
      .then((cart) =>
        // سلة من قبل أن تتغيّر عملة العرض (جهاز آخر، أو دخول بحساب له عملته): تتبع الصفحة
        cart.currency === displayCurrency()
          ? cart
          : api<CartView>('/cart/currency', {
              method: 'PUT',
              body: { currency: displayCurrency() },
              headers: { 'x-cart-token': token },
            }).catch(() => cart),
      )
      .catch((err) => {
        // السلة نفسها غابت أو انتهت — لا 404 عن قطعة فيها: ذاك كان يمحو الرمز فتضيع قطع
        // المتاجر الأخرى معها (CHK-021). الخادم صار يعرضها سطراً «لم يعد متاحاً»
        if (err instanceof ApiError && err.status === 404 && !err.details?.['variantIds']) {
          localStore.remove(TOKEN_KEY);
          return null;
        }
        throw err;
      });
  },
  add: (variantId: string, qty: number) =>
    withCart((t) =>
      api<CartView>('/cart/items', { method: 'POST', body: { variantId, qty }, headers: { 'x-cart-token': t } }),
    ).then(changed),
  setQty: (variantId: string, qty: number) =>
    withCart((t) =>
      api<CartView>(`/cart/items/${variantId}`, {
        method: 'PATCH',
        body: { qty },
        headers: { 'x-cart-token': t },
      }),
    ).then(changed),
  coupon: (code: string | null) =>
    withCart((t) =>
      api<CartView>('/cart/coupon', { method: 'PUT', body: { code: code ?? '' }, headers: { 'x-cart-token': t } }),
    ).then(changed),
  quote: (address: { country: string; region: string; city: string }) =>
    withCart((t) =>
      api<CartView>('/checkout/quote', { method: 'POST', body: address, headers: { 'x-cart-token': t } }),
    ),
};
