import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { displayCurrency } from './currency';
import { localList, useLocalList } from './recent';
import type { ProductPage } from './storefront';

/**
 * قائمة المقارنة — ST-10. حتى أربعة منتجات. كان شرطها «القسم نفسه»، وسقطت الأقسام
 * العامة حين صارت الفئات لكل متجر (14 أكتوبر 2026): المشتري يختار ما يقارنه، وصفوف
 * الجدول هي السمات المشتركة بينها.
 */

export const COMPARE_MAX = 4;

export interface CompareItem {
  slug: string;
  nameAr: string;
  thumb: string | null;
}

/** عناصر محفوظة قبل التغيير تحمل حقول القسم أيضاً — تُقبل، والزائد لا يُقرأ */
const isCompare = (v: unknown): v is CompareItem => {
  const o = v as Partial<CompareItem> | null;
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof o.slug === 'string' &&
    o.slug.length > 0 &&
    typeof o.nameAr === 'string' &&
    (o.thumb === null || typeof o.thumb === 'string')
  );
};

export const compareList = localList<CompareItem>('basta.compare', isCompare);

export const useCompare = (): readonly CompareItem[] => useLocalList(compareList);

export type AddResult = 'added' | 'exists' | 'full';

export function addToCompare(item: CompareItem): AddResult {
  const list = compareList.read();
  if (list.some((x) => x.slug === item.slug)) return 'exists';
  if (list.length >= COMPARE_MAX) return 'full';
  compareList.write([...list, { slug: item.slug, nameAr: item.nameAr, thumb: item.thumb }]);
  return 'added';
}

export function removeFromCompare(slug: string): void {
  compareList.write(compareList.read().filter((x) => x.slug !== slug));
}

export function clearCompare(): void {
  compareList.write([]);
}

// ---------------------------------------------------- بيانات حيّة من المتجر

/** المنتج كما يعرضه المتجر الآن، أو null إن لم يعد منشوراً */
export async function fetchPublicProduct(slug: string): Promise<ProductPage | null> {
  try {
    // بعملة الصفحة التي يُعرض فيها — المقارنة و«شاهدتَ مؤخراً» بالعملة نفسها
    return await api<ProductPage>(`/storefront/products/${encodeURIComponent(slug)}?currency=${displayCurrency()}`, {
      auth: false,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** حالة كل منتج: undefined يُحمَّل · null لم يعد معروضاً · 'error' تعذّر الجلب */
export type Fetched = ProductPage | null | 'error' | undefined;

/**
 * يجلب صفحات منتجات بالتوازي. المفتاح نصّ الروابط مجتمعة: إضافة منتج أو
 * إزالته تعيد الجلب، وإعادة التصيير بالقائمة نفسها لا تعيده.
 * `attempt` يزيد لإعادة المحاولة بعد خطأ شبكة.
 */
export function useProductPages(slugs: readonly string[], attempt = 0): Record<string, Fetched> {
  const key = slugs.join('\n');
  const [pages, setPages] = useState<Record<string, Fetched>>({});

  useEffect(() => {
    if (!key) return;
    let alive = true;
    for (const slug of key.split('\n')) {
      fetchPublicProduct(slug)
        .then((p) => {
          if (alive) setPages((prev) => ({ ...prev, [slug]: p }));
        })
        .catch(() => {
          if (alive) setPages((prev) => ({ ...prev, [slug]: 'error' }));
        });
    }
    return () => {
      alive = false;
    };
  }, [key, attempt]);

  return pages;
}

// ---------------------------------------------------------- مساعدات العرض

/** السعر الأدنى، و«من» قبله حين تختلف أسعار المتغيّرات */
export function priceLabel(p: ProductPage): { prefix: string | null; formatted: string } {
  const prices = new Set(p.variants.map((v) => v.price.minorUnits));
  return { prefix: prices.size > 1 ? 'من' : null, formatted: p.priceFrom.formatted };
}

/** «متوفّر» · «بقي N فقط» · «نفد» — بعتبة صفحة المنتج نفسها */
export function stockOf(p: ProductPage): { tone: 'success' | 'warning' | 'danger'; label: string } {
  if (p.isSoldOut || p.available <= 0) return { tone: 'danger', label: 'نفد من المخزون' };
  if (p.available <= 3) return { tone: 'warning', label: `بقي ${p.available} فقط` };
  return { tone: 'success', label: 'متوفّر' };
}
