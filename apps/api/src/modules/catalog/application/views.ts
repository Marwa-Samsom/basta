/**
 * أشكال الاستجابة. المال يخرج نصّاً لا رقماً:
 * JSON لا يحمل BigInt، و Number يفقد الدقة فوق 2^53 — والمبلغ المُقرَّب بصمت
 * أسوأ من الخطأ الصاخب (ADR-001).
 */
import { format, money } from '../../../common/money/money';

export interface PriceView {
  readonly minorUnits: string;
  readonly currency: string;
  /** للعرض فقط — الحساب يكون على minorUnits */
  readonly formatted: string;
}

export const priceView = (minorUnits: bigint, currency: string): PriceView => ({
  minorUnits: minorUnits.toString(),
  currency,
  formatted: format(money(minorUnits, currency)),
});

export interface StockSummaryView {
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
  readonly lowStockThreshold: number;
  readonly isLow: boolean;
}

export interface VariantOptionView {
  readonly attributeId: string;
  readonly attributeCode: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly valueId: string;
  readonly valueAr: string;
  readonly valueEn: string | null;
  readonly hexColor: string | null;
}

export interface VariantView {
  readonly id: string;
  readonly sku: string;
  readonly options: readonly VariantOptionView[];
  readonly price: PriceView;
  readonly compareAtPrice: PriceView | null;
  readonly barcode: string | null;
  readonly weightGrams: number | null;
  readonly isActive: boolean;
  readonly stock: StockSummaryView;
}

export interface ProductAttributeView {
  readonly attributeId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly valueId: string | null;
  readonly valueAr: string | null;
  readonly valueEn: string | null;
  readonly number: string | null;
  readonly boolean: boolean | null;
}

export interface ProductImageView {
  readonly id: string;
  readonly variantId: string | null;
  readonly altAr: string | null;
  readonly altEn: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly sort: number;
  readonly urls: Readonly<Record<string, string>>;
}

export interface ProductDetailView {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly rejectReason: string | null;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly descriptionAr: string | null;
  readonly descriptionEn: string | null;
  readonly category: { id: string; slug: string; nameAr: string; nameEn: string | null };
  readonly brandId: string | null;
  readonly hasVariants: boolean;
  readonly currency: string;
  readonly attributes: readonly ProductAttributeView[];
  readonly variants: readonly VariantView[];
  readonly images: readonly ProductImageView[];
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProductListItemView {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly status: string;
  readonly variantCount: number;
  readonly priceFrom: PriceView | null;
  readonly priceTo: PriceView | null;
  readonly onHand: number;
  readonly available: number;
  readonly isLow: boolean;
  readonly thumbnail: string | null;
  readonly updatedAt: Date;
}

/** صف طابور مراجعة الإدارة — Q-15 */
export interface AdminProductListItemView {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly status: string;
  readonly rejectReason: string | null;
  readonly vendor: { readonly id: string; readonly nameAr: string; readonly status: string };
  readonly categoryNameAr: string;
  readonly variantCount: number;
  readonly priceFrom: PriceView | null;
  readonly thumbnail: string | null;
  readonly updatedAt: Date;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}
