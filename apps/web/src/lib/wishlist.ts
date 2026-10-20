'use client';

import { useSyncExternalStore } from 'react';
import { api, session } from './api';
import { displayCurrency } from './currency';

/**
 * المفضّلة في المتصفّح — ST-23 والقلب في صفحة المنتج وبطاقته.
 *
 * **معرّفات المحفوظ تُجلب مرة واحدة** لكل مستخدم ثم تُحفظ في هذه الوحدة:
 * صفحة فيها 24 بطاقة لا تطلق 24 طلباً، والانتقال بين الصفحات لا يعيد الجلب.
 * كل تعديل يمرّ من هنا فيبقى القلب والقائمة متّفقين. الضيف لا يُطلب له شيء.
 */

export interface WishlistMoney {
  minorUnits: string;
  currency: string;
  formatted: string;
}

export type WishlistState = 'unavailable' | 'sold_out' | 'drop' | 'rise' | 'low' | 'ok';

export interface WishlistItem {
  productId: string;
  slug: string;
  nameAr: string;
  image: string | null;
  shop: { slug: string; nameAr: string };
  savedPrice: WishlistMoney;
  currentPrice: WishlistMoney | null;
  delta: WishlistMoney | null;
  state: WishlistState;
  available: number;
  hasVariants: boolean;
  variantId: string | null;
  savedAt: string;
}

export interface WishlistView {
  items: WishlistItem[];
  count: number;
  max: number;
}

/** «منتج واحد محفوظ» · «منتجان محفوظان» · «3 منتجات محفوظة» · «11 منتجاً محفوظاً» */
export function savedCount(n: number): string {
  if (n === 1) return 'منتج واحد محفوظ';
  if (n === 2) return 'منتجان محفوظان';
  if (n >= 3 && n <= 10) return `${n} منتجات محفوظة`;
  return `${n} منتجاً محفوظاً`;
}

// ------------------------------------------------------------ المخزن

let ids: ReadonlySet<string> | null = null;
/** صاحب المعرّفات المحفوظة — دخول حساب آخر في التبويب نفسه يعيد الجلب */
let owner: string | null = null;
let loading = false;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

/** معرّف المستخدم من الرمز — قراءة بلا تحقق، لقرار «هل أجلب» وحده */
function currentUser(): string | null {
  const access = session.read()?.accessToken;
  if (!access) return null;
  try {
    const payload = access.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

function ensureLoaded(): void {
  const user = currentUser();
  if (!user) {
    if (ids || owner) {
      ids = null;
      owner = null;
      emit();
    }
    return;
  }
  if (owner === user && (ids || loading)) return;
  owner = user;
  ids = null;
  loading = true;
  api<{ ids: string[] }>('/me/wishlist/ids')
    .then((d) => {
      if (owner === user) {
        ids = new Set(d.ids);
        emit();
      }
    })
    .catch(() => undefined) // القلب يبقى فارغاً؛ الضغط عليه يعمل ويصحّح الحالة
    .finally(() => {
      loading = false;
    });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureLoaded();
  return () => {
    listeners.delete(cb);
  };
}

/** معرّفات المحفوظ، أو `null` للضيف وقبل وصولها */
export function useWishlistIds(): ReadonlySet<string> | null {
  return useSyncExternalStore(
    subscribe,
    () => ids,
    () => null,
  );
}

function patch(productId: string, saved: boolean): void {
  if (!ids) return;
  const next = new Set(ids);
  if (saved) next.add(productId);
  else next.delete(productId);
  ids = next;
  emit();
}

/**
 * احفظ أو أزل — تفاؤلي: القلب يتبدّل فوراً ويرتدّ إن رفض الخادم،
 * والخطأ يُرمى برسالة الخادم كما هي (السقف، منتج لم يعد معروضاً).
 */
export async function setSaved(productId: string, saved: boolean): Promise<void> {
  const before = ids?.has(productId) ?? !saved;
  patch(productId, saved);
  try {
    await api(`/me/wishlist/${productId}`, { method: saved ? 'PUT' : 'DELETE' });
  } catch (err) {
    patch(productId, before);
    throw err;
  }
}

export const getWishlist = (): Promise<WishlistView> => api<WishlistView>(`/me/wishlist?currency=${displayCurrency()}`);

// ------------------------------------------------------------ الإشعار العابر

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * منطقة حيّة واحدة للصفحة كلها، تُنشأ عند أول قلب يظهر — لا منطقة لكل
 * بطاقة (أربع وعشرون منطقة حيّة يقرؤها قارئ الشاشة ضجيجاً).
 */
export function ensureToastRegion(): void {
  if (typeof document === 'undefined' || document.getElementById('wish-toast')) return;
  const el = document.createElement('p');
  el.id = 'wish-toast';
  el.className = 'wish-toast';
  el.setAttribute('role', 'status');
  document.body.appendChild(el);
}

export function wishToast(message: string): void {
  ensureToastRegion();
  const el = document.getElementById('wish-toast');
  if (!el) return;
  el.textContent = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.textContent = '';
  }, 4000);
}
