/**
 * بناء استعلام البحث — بلا شبكة وبلا قاعدة بيانات، فيُختبر وحدوياً.
 *
 * الفلاتر تُبنى هنا لا في المتحكّم: مرشّح واحد منسيّ يعني منتج بائع معلَّق
 * يظهر في نتيجة بحث، وهي ثغرة عمل لا خلل عرض.
 */

export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'newest';

export interface SearchInput {
  readonly q?: string | undefined;
  readonly vendorId?: string | undefined;
  /** فئة من فئات المتجر — معناها داخل متجرها، فتأتي مع vendorId */
  readonly storeCategoryId?: string | undefined;
  readonly brandId?: string | undefined;
  /** قيم سمات مطلوبة كلها معاً (AND بين السمات، OR داخل السمة الواحدة) */
  readonly attributeValueIds?: readonly string[] | undefined;
  /** حدّا السعر بالوحدة الصغرى لعملة العرض (displayCurrency إن وُجدت) */
  readonly minPriceMinor?: number | undefined;
  readonly maxPriceMinor?: number | undefined;
  /**
   * عملة العرض وحدّاها بالدولار — يحسبها الكتالوج بسعر الصرف والهامش. منتج
   * بعملة العرض يُقارن بسعره كما هو، وغيره بدولاره (priceUsd)؛ بلاها يُقارن
   * priceMinor خاماً كما كان.
   */
  readonly displayCurrency?: string | undefined;
  readonly minPriceUsd?: number | undefined;
  readonly maxPriceUsd?: number | undefined;
  readonly inStockOnly?: boolean | undefined;
  readonly sort?: SortKey | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
}

export interface SearchDocument {
  readonly id: string;
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly descriptionAr: string | null;
  readonly brandNameAr: string | null;
  readonly vendorId: string;
  readonly vendorNameAr: string;
  readonly vendorSlug: string;
  readonly brandId: string | null;
  readonly storeCategoryId: string | null;
  readonly storeCategoryNameAr: string | null;
  /** قيم خصائص المنتج وقيم محاور متغيّراته معاً (اللون والمقاس) — منها الأوجه والتصفية */
  readonly attributeValueIds: readonly string[];
  readonly attributeValuesAr: readonly string[];
  /** قيم محاور المتغيّرات وحدها — وجودها في الوثيقة علامة أنها بُنيت بعد ضمّ المحاور (31 أكتوبر 2026) */
  readonly variantValueIds: readonly string[];
  readonly priceMinor: number;
  readonly currency: string;
  /** أرخص متغيّر بالدولار بلا هامش — مفتاح ترتيب واحد بين متاجر بعملات مختلفة. يغيب بلا سعر صرف */
  readonly priceUsd?: number;
  readonly available: number;
  readonly createdAt: number;
}

export const MAX_PAGE_SIZE = 48;

export const pageOf = (input: SearchInput): { page: number; pageSize: number } => ({
  page: Math.max(1, Math.floor(input.page ?? 1)),
  pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? 24))),
});

/** قيمة نصّية داخل مرشّح Meilisearch تُقتبَس، والاقتباس داخلها يُهرَّب. */
const quote = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;

/**
 * المرشّحات كمصفوفة: العناصر تُجمع بـ AND، والمصفوفة الداخلية بـ OR —
 * وهي الصيغة التي يفهمها Meilisearch مباشرةً.
 */
export function buildFilter(input: SearchInput): (string | string[])[] {
  const filter: (string | string[])[] = [];

  if (input.vendorId) filter.push(`vendorId = ${quote(input.vendorId)}`);
  if (input.storeCategoryId) filter.push(`storeCategoryId = ${quote(input.storeCategoryId)}`);
  if (input.brandId) filter.push(`brandId = ${quote(input.brandId)}`);

  const bound = (op: '>=' | '<=', minor: number | undefined, usd: number | undefined): void => {
    if (minor === undefined) return;
    if (!input.displayCurrency || usd === undefined) {
      filter.push(`priceMinor ${op} ${minor}`);
      return;
    }
    const own = quote(input.displayCurrency);
    filter.push(`(currency = ${own} AND priceMinor ${op} ${minor}) OR (currency != ${own} AND priceUsd ${op} ${usd})`);
  };
  bound('>=', input.minPriceMinor, input.minPriceUsd);
  bound('<=', input.maxPriceMinor, input.maxPriceUsd);
  if (input.inStockOnly) filter.push('available > 0');

  for (const valueId of input.attributeValueIds ?? []) {
    filter.push(`attributeValueIds = ${quote(valueId)}`);
  }

  return filter;
}

export function buildSort(sort: SortKey | undefined): string[] {
  switch (sort) {
    // بالدولار لا بالوحدة الخام: 10 دنانير أغلى من 20 ريالاً (18 أكتوبر 2026)
    case 'price_asc':
      return ['priceUsd:asc'];
    case 'price_desc':
      return ['priceUsd:desc'];
    case 'newest':
      return ['createdAt:desc'];
    default:
      return []; // الصلة — ترتيب المحرّك نفسه
  }
}

/**
 * مرادفات عامّية عربية. المحرّك يعالج الأخطاء الإملائية والهمزات وحده،
 * لكنه لا يعرف أن «جوال» هي «هاتف» — وهذه معرفة سوق لا لغة.
 */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  جوال: ['هاتف', 'موبايل', 'تلفون'],
  موبايل: ['هاتف', 'جوال'],
  تلفون: ['هاتف', 'جوال'],
  هاتف: ['جوال', 'موبايل'],
  لابتوب: ['حاسوب', 'لاب توب', 'كمبيوتر'],
  كمبيوتر: ['حاسوب', 'لابتوب'],
  بنطلون: ['بنطال', 'سروال'],
  بنطال: ['بنطلون', 'سروال'],
  سروال: ['بنطال', 'بنطلون'],
  تيشيرت: ['قميص', 'تي شيرت'],
  كنزة: ['بلوزة', 'سترة'],
  جزمة: ['حذاء', 'بوت'],
  حذاء: ['جزمة', 'بوت'],
  ساعة: ['ساعة يد'],
  شنطة: ['حقيبة', 'جزدان'],
  حقيبة: ['شنطة'],
});

/** إعدادات الفهرس — مصدر واحد يقرأه الإنشاء والتحديث والاختبار. */
export const INDEX_SETTINGS = Object.freeze({
  searchableAttributes: [
    'nameAr',
    'nameEn',
    'brandNameAr',
    'attributeValuesAr',
    'storeCategoryNameAr',
    'vendorNameAr',
    'descriptionAr',
    'slug',
  ],
  filterableAttributes: [
    'vendorId',
    'brandId',
    'storeCategoryId',
    'attributeValueIds',
    'variantValueIds',
    'priceMinor',
    'priceUsd',
    'available',
    'currency',
  ],
  sortableAttributes: ['priceMinor', 'priceUsd', 'createdAt'],
  typoTolerance: {
    enabled: true,
    // الكلمة العربية قصيرة: «قميص» خمسة أحرف، فعتبة الخطأ الواحد تبدأ عند أربعة
    minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
  },
  synonyms: SYNONYMS,
  pagination: { maxTotalHits: 5000 },
});
