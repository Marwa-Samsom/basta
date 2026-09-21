/**
 * قراءة المتجر من الخادم — للمكوّنات التي تُصيَّر في الخادم.
 *
 * بوابة المرحلة 07 البند الرابع: **صفحة المنتج كاملة في مصدر HTML قبل
 * JavaScript.** لذلك تُجلب البيانات هنا لا في المتصفّح: محرّك البحث الذي
 * يقرأ الصفحة لا ينتظر سكربتاً، والمشتري على شبكة بطيئة يرى المنتج قبل أن
 * يصل ملف واحد.
 */

import { notFound } from 'next/navigation';

export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:4000/api/v1';

/** أصل الخادم بلا بادئة الواجهة — الصور تُخدم منه على /uploads */
export const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '');

export const imageUrl = (path: string | null): string | null =>
  path ? `${API_ORIGIN}${path}` : null;

export interface Price {
  minorUnits: string;
  currency: string;
  formatted: string;
}

export interface ProductCard {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  price: Price;
  compareAtPrice: Price | null;
  vendor: { id: string; slug: string; nameAr: string };
  thumbnail: string | null;
  available: number;
  isSoldOut: boolean;
}

export interface FacetBucket {
  id: string;
  label: string;
  count: number;
}

export interface Facets {
  brands: FacetBucket[];
  vendors: FacetBucket[];
  attributes: { attributeId: string; nameAr: string; values: FacetBucket[] }[];
  priceRange: { minMinor: string; maxMinor: string } | null;
}

export interface ListResult {
  items: ProductCard[];
  page: number;
  pageSize: number;
  total: number;
  engine: 'meili' | 'db';
  tookMs: number;
  facets: Facets;
}

export interface ProductPage {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  descriptionAr: string | null;
  currency: string;
  category: { id: string; slug: string; nameAr: string };
  brand: { id: string; nameAr: string } | null;
  vendor: {
    id: string;
    slug: string;
    nameAr: string;
    shippingPolicyAr: string | null;
    returnPolicyAr: string | null;
    ratingAvg: number;
    ratingCount: number;
  };
  images: { id: string; variantId: string | null; altAr: string | null; urls: Record<string, string> }[];
  attributes: {
    attributeId: string;
    nameAr: string;
    code: string;
    valueAr: string | null;
    hexColor: string | null;
    number: string | null;
    boolean: boolean | null;
  }[];
  variants: {
    id: string;
    sku: string;
    price: Price;
    compareAtPrice: Price | null;
    available: number;
    options: {
      attributeId: string;
      nameAr: string;
      code: string;
      valueId: string;
      valueAr: string;
      hexColor: string | null;
    }[];
  }[];
  available: number;
  isSoldOut: boolean;
  priceFrom: Price;
}

export interface ShopPage {
  vendor: {
    id: string;
    slug: string;
    nameAr: string;
    nameEn: string | null;
    descriptionAr: string | null;
    shippingPolicyAr: string | null;
    returnPolicyAr: string | null;
    ratingAvg: number;
    ratingCount: number;
    since: string;
    isSuspended: boolean;
  };
  products: ProductCard[];
  total: number;
}

export interface Category {
  id: string;
  parentId: string | null;
  slug: string;
  nameAr: string;
  depth: number;
  children?: Category[];
}

/**
 * جلب من الخادم مع إعادة توليد دورية (ISR): الصفحة تُبنى مرة وتُخدم مخزّنة
 * دقيقةً، فلا يضرب كل زائر قاعدة البيانات. والسعر والمخزون أحدث من دقيقة
 * في السلة والدفع لا هنا — صفحة المنتج تعرض، لا تحجز.
 */
async function get<T>(path: string, revalidate = 60): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { next: { revalidate } });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`تعذّر تحميل ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * معامل المسار كما يعطيه Next يصل **مشفَّراً** (`%D8%B9…`) للروابط العربية.
 * تشفيره ثانيةً يُنتج `%25D8…` فيردّ الخادم 404 — أو 414 حين يطول الرابط
 * إلى ثلاثة أضعافه. يُفكّ أولاً ثم يُشفَّر مرة واحدة: صحيح أيّاً كان ما وصل.
 */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // % مكسورة في الرابط: تُمرَّر كما هي فيردّ الخادم 404 لا 500
  }
}

const slugPath = (slug: string): string => encodeURIComponent(decodeParam(slug));

export const getProduct = (slug: string): Promise<ProductPage> =>
  get(`/storefront/products/${slugPath(slug)}`);

export const getShop = (slug: string): Promise<ShopPage> =>
  get(`/storefront/shops/${slugPath(slug)}`);

export const getCategories = (): Promise<Category[]> => get('/storefront/categories', 300);

export function listProducts(params: Record<string, string | undefined>): Promise<ListResult> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) query.set(k, v);
  // البحث لا يُخزَّن: كل كلمة استعلام جديد، والتخزين يملأ الذاكرة بلا فائدة
  return get(`/storefront/products?${query.toString()}`, params['q'] ? 0 : 60);
}

/** شجرة إلى قائمة مسطّحة — للعثور على فئة بالرابط */
export function flatten(tree: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (nodes: Category[]): void => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export const num = (value: number): string =>
  new Intl.NumberFormat('ar-JO-u-nu-latn').format(value);
