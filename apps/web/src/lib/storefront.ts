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
  priceRange: { minMinor: string; maxMinor: string; currency: string } | null;
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
  /** عملة الأسعار المعروضة — عملة المشتري، أو عملة المتجر إن تعذّر الصرف */
  currency: string;
  /** العملة التي سعّر بها المتجر */
  storeCurrency: string;
  /** فئة المنتج في متجره — null إن لم يضعه البائع في فئة */
  storeCategory: { id: string; nameAr: string } | null;
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
  images: { id: string; variantId: string | null; optionValueId: string | null; altAr: string | null; urls: Record<string, string> }[];
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
    /** سعر المتجر بعملته حين تختلف عن عملة العرض */
    originalPrice: Price | null;
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
  /** فئات المتجر التي فيها معروض — أزرار التصفية بترتيب البائع */
  categories: { id: string; nameAr: string; count: number }[];
  products: ProductCard[];
  page: number;
  pageSize: number;
  total: number;
}

/** بطاقة متجر في دليل المتاجر */
export interface ShopCard {
  id: string;
  slug: string;
  nameAr: string;
  descriptionAr: string | null;
  ratingAvg: number;
  ratingCount: number;
  productCount: number;
  categories: string[];
}

/**
 * جلب من الخادم مع إعادة توليد دورية (ISR): الصفحة تُبنى مرة وتُخدم مخزّنة
 * دقيقةً، فلا يضرب كل زائر قاعدة البيانات. والسعر والمخزون أحدث من دقيقة
 * في السلة والدفع لا هنا — صفحة المنتج تعرض، لا تحجز.
 */
async function get<T>(path: string, revalidate = 60, currency?: string): Promise<T> {
  // عملة العرض في العنوان: التخزين مفتاحه العنوان، فلكل عملة نسختها
  const url = currency ? `${path}${path.includes('?') ? '&' : '?'}currency=${currency}` : path;
  const res = await fetch(`${API_BASE}${url}`, { next: { revalidate } });
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

export const getProduct = (slug: string, currency?: string): Promise<ProductPage> =>
  get(`/storefront/products/${slugPath(slug)}`, 60, currency);

/** مراجعة موثّقة كما تُعرض — الاسم الأول وحده، والمتغيّر الذي اشتُري */
export interface ProductReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: string;
  author: string;
  variant: string | null;
  verified: boolean;
}

export interface ProductReviews {
  /** بمنزلة عشرية واحدة، و null بلا مراجعات */
  average: number | null;
  count: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  /** الأحدث أولاً، عشر في الصفحة */
  items: ProductReview[];
}

/**
 * مراجعات المنتج طازجة في كل زيارة كصفحة المتجر: من كتب مراجعته وفتح الصفحة يراها فوراً،
 * لا بعد دقيقة من التخزين. الصفحة الأولى هنا في HTML؛ ما بعدها يطلبه المتصفّح.
 */
export const getProductReviews = (productId: string): Promise<ProductReviews> => get(`/products/${productId}/reviews`, 0);

/**
 * صفحة المتجر تُقرأ طازجة في كل زيارة لا من التخزين: حالته (معلَّق أو معتمد) تتغيّر بقرار
 * إداري، والتخزين يخدم النسخة القديمة لأول زائر بعد انقضائه مهما قدمت — بعد إعادة «غزة»
 * ظهر «لا يستقبل طلبات حالياً» لأول زائرة بعد يوم كامل (J-18، 21 أكتوبر 2026). الطلب
 * الواحد للخادم أرخص من متجر يبدو مغلقاً وهو مفتوح، أو مفتوحاً وهو معلَّق.
 */
export function getShop(
  slug: string,
  opts: { category?: string | undefined; page?: number | undefined; currency?: string | undefined } = {},
): Promise<ShopPage> {
  const query = new URLSearchParams();
  if (opts.category) query.set('category', opts.category);
  if (opts.page && opts.page > 1) query.set('page', String(opts.page));
  const qs = query.toString();
  return get(`/storefront/shops/${slugPath(slug)}${qs ? `?${qs}` : ''}`, 0, opts.currency);
}

export interface CurrencyOption {
  code: string;
  nameAr: string;
  symbol: string;
}

/** العملات التي يختار منها المشتري وعملة الزائر الجديد — الخطأ لا يُسقط الرأس */
export const getCurrencies = (): Promise<{ defaultCurrency: string; currencies: CurrencyOption[] }> =>
  get<{ defaultCurrency: string; currencies: CurrencyOption[] }>('/storefront/currencies', 300).catch(() => ({
    defaultCurrency: 'JOD',
    currencies: [],
  }));

/** دليل المتاجر — حلّ محلّ «كل الأقسام» حين صارت الفئات لكل متجر (14 أكتوبر 2026) */
export function getShops(opts: { q?: string | undefined; page?: number | undefined } = {}): Promise<{
  items: ShopCard[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const query = new URLSearchParams();
  if (opts.q?.trim()) query.set('q', opts.q.trim());
  if (opts.page && opts.page > 1) query.set('page', String(opts.page));
  const qs = query.toString();
  return get(`/storefront/shops${qs ? `?${qs}` : ''}`, opts.q ? 0 : 120);
}

export interface Banner {
  id: string;
  titleAr: string | null;
  linkUrl: string | null;
  imageUrl: string;
}

export interface ContentPage {
  slug: string;
  titleAr: string;
  bodyAr: string;
  updatedAt: string;
}

/** ما تديره الإدارة (AD-18 و AD-19) — دقيقة تخزين تكفي، والخطأ لا يُسقط الرئيسية */
export const getBanners = (placement: string): Promise<Banner[]> =>
  get<Banner[]>(`/storefront/banners?placement=${placement}`, 60).catch(() => []);

export const getFeatured = (currency?: string): Promise<ProductCard[]> =>
  get<ProductCard[]>('/storefront/featured', 60, currency).catch(() => []);

/** حملة جارية في الرئيسية (AD-17) — بطاقاتها بمخطّط المميّز نفسه */
export interface Campaign {
  id: string;
  nameAr: string;
  placement: 'home_top' | 'home_middle';
  endsAt: string;
  couponCode: string | null;
  products: ProductCard[];
}

/** الخطأ يعني «لا حملات» لا صفحة ساقطة — والبناء لا يحتاج خادماً حيّاً */
export const getCampaigns = (currency?: string): Promise<Campaign[]> =>
  get<Campaign[]>('/storefront/campaigns', 60, currency).catch(() => []);

export const getPage = (slug: string): Promise<ContentPage> => get(`/pages/${slugPath(slug)}`, 300);

export function listProducts(params: Record<string, string | undefined>, currency?: string): Promise<ListResult> {
  const query = new URLSearchParams();
  // العملة من الكوكي لا من العنوان: رابط بحث منسوخ يفتح بعملة من يفتحه
  for (const [k, v] of Object.entries(params)) if (v && k !== 'currency') query.set(k, v);
  // البحث لا يُخزَّن: كل كلمة استعلام جديد، والتخزين يملأ الذاكرة بلا فائدة
  return get(`/storefront/products?${query.toString()}`, params['q'] ? 0 : 60, currency);
}

export const num = (value: number): string =>
  new Intl.NumberFormat('ar-JO-u-nu-latn').format(value);
