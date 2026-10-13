'use client';

/** أشكال الكتالوج كما يعيدها الخادم — المال نصّ لا رقم (ADR-001). */

export interface Price {
  minorUnits: string;
  currency: string;
  formatted: string;
}

export interface StockSummary {
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isLow: boolean;
}

export interface VariantOption {
  attributeId: string;
  attributeCode: string;
  nameAr: string;
  valueId: string;
  valueAr: string;
  hexColor: string | null;
}

export interface Variant {
  id: string;
  sku: string;
  options: VariantOption[];
  price: Price;
  compareAtPrice: Price | null;
  barcode: string | null;
  weightGrams: number | null;
  isActive: boolean;
  stock: StockSummary;
}

export interface ProductAttribute {
  attributeId: string;
  code: string;
  nameAr: string;
  valueId: string | null;
  valueAr: string | null;
  number: string | null;
  boolean: boolean | null;
}

export interface ProductImage {
  id: string;
  variantId: string | null;
  altAr: string | null;
  width: number | null;
  height: number | null;
  sort: number;
  /** full.webp · full.avif · medium.webp · medium.avif · thumb.webp — مسارات موقَّعة */
  urls: Record<string, string>;
}

export interface ProductDetail {
  id: string;
  slug: string;
  status: ProductStatus;
  rejectReason: string | null;
  nameAr: string;
  nameEn: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  category: { id: string; slug: string; nameAr: string };
  brandId: string | null;
  hasVariants: boolean;
  currency: string;
  attributes: ProductAttribute[];
  variants: Variant[];
  images: ProductImage[];
  publishedAt: string | null;
  updatedAt: string;
}

export type ProductStatus = 'draft' | 'pending_review' | 'active' | 'rejected' | 'archived';

export interface ProductListItem {
  id: string;
  nameAr: string;
  nameEn: string | null;
  status: ProductStatus;
  variantCount: number;
  priceFrom: Price | null;
  priceTo: Price | null;
  onHand: number;
  available: number;
  isLow: boolean;
  thumbnail: string | null;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LowStockRow {
  variantId: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  sku: string;
  productId: string;
  productNameAr: string;
}

export interface Category {
  id: string;
  parentId: string | null;
  slug: string;
  nameAr: string;
  depth: number;
  children?: Category[];
}

export interface EffectiveAttribute {
  attributeId: string;
  code: string;
  nameAr: string;
  inputType: 'select' | 'text' | 'number' | 'boolean';
  isRequired: boolean;
  isVariantAxis: boolean;
  values: { id: string; valueAr: string; hexColor: string | null }[];
}

/** §9 — التسميات والنبرة واحدة في كل شاشة تعرض حالة منتج */
export const PRODUCT_STATUS: Readonly<
  Record<ProductStatus, { label: string; tone: string; hint: string }>
> = Object.freeze({
  draft: { label: 'مسوّدة', tone: 'badge--pending', hint: 'لم تُرسل للمراجعة بعد.' },
  pending_review: { label: 'قيد المراجعة', tone: 'badge--review', hint: 'بانتظار مراجعة الإدارة.' },
  active: { label: 'منشور', tone: 'badge--approved', hint: 'يظهر للمشترين.' },
  rejected: { label: 'مرفوض', tone: 'badge--rejected', hint: 'اقرأ السبب وصحّح ثم أعد الإرسال.' },
  archived: { label: 'مؤرشف', tone: 'badge--pending', hint: 'لا يظهر ولا يُباع.' },
});

/** عدد بأرقام لاتينية دائماً — DESIGN-SYSTEM §7 */
export const num = (value: number): string =>
  new Intl.NumberFormat('ar-JO-u-nu-latn').format(value);
