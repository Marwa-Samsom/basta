/**
 * الاستيراد الجماعي — SRS V-03.
 *
 * قاعدتان تبدوان متعارضتين وليستا كذلك:
 *  • ملف 500 سطر فيه 12 خطأ يستورد 488 ويبلّغ عن 12 — السطر الخاطئ لا يُسقط الملف.
 *  • الملف الفاسد لا يترك بيانات جزئية.
 * الفصل بينهما هنا: هذا الملف **يقرّر** سطراً سطراً بلا قاعدة بيانات، ثم تكتب
 * الخدمة القرار كله في معاملة واحدة. الخطأ في سطر يُستبعد قبل الكتابة، والخطأ
 * أثناء الكتابة يُلغي الكل. لا توجد حالة «نصف الملف كُتب».
 */
import { DomainError } from '../../../common/errors/domain-error';
import { MoneyError, parse as parseMoney } from '../../../common/money/money';
import {
  MAX_VARIANTS_PER_PRODUCT,
  SKU_PATTERN,
  axesKeyOf,
  optionsKeyOf,
  type OptionChoice,
} from './variant-matrix';

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

export type ImportColumnKey =
  | 'productRef'
  | 'sku'
  | 'nameAr'
  | 'nameEn'
  | 'descriptionAr'
  | 'descriptionEn'
  | 'category'
  | 'price'
  | 'compareAtPrice'
  | 'stock'
  | 'lowStockThreshold'
  | 'option1Name'
  | 'option1Value'
  | 'option2Name'
  | 'option2Value'
  | 'barcode'
  | 'weightGrams';

export interface ImportColumn {
  readonly key: ImportColumnKey;
  /** العنوان في القالب العربي */
  readonly header: string;
  readonly aliases: readonly string[];
  readonly required: boolean;
  readonly example: readonly [string, string];
}

/** ترتيب القالب. العناوين العربية هي الأصل، والإنجليزية مقبولة لملفات مصدّرة من أنظمة أخرى */
export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'productRef', header: 'رمز_المنتج', aliases: ['product_ref'], required: true, example: ['TSHIRT-01', 'TSHIRT-01'] },
  { key: 'sku', header: 'SKU', aliases: ['sku'], required: true, example: ['TS01-RED-M', 'TS01-RED-L'] },
  { key: 'nameAr', header: 'الاسم_عربي', aliases: ['name_ar'], required: true, example: ['قميص قطني', 'قميص قطني'] },
  { key: 'nameEn', header: 'الاسم_إنجليزي', aliases: ['name_en'], required: false, example: ['Cotton T-shirt', 'Cotton T-shirt'] },
  { key: 'descriptionAr', header: 'الوصف_عربي', aliases: ['description_ar'], required: false, example: ['قطن مصري 100%', 'قطن مصري 100%'] },
  { key: 'descriptionEn', header: 'الوصف_إنجليزي', aliases: ['description_en'], required: false, example: ['100% Egyptian cotton', '100% Egyptian cotton'] },
  { key: 'category', header: 'الفئة', aliases: ['category'], required: false, example: ['قمصان', 'قمصان'] },
  { key: 'price', header: 'السعر', aliases: ['price'], required: true, example: ['79.00', '79.00'] },
  { key: 'compareAtPrice', header: 'السعر_قبل_الخصم', aliases: ['compare_at_price'], required: false, example: ['99.00', ''] },
  { key: 'stock', header: 'الكمية', aliases: ['stock', 'qty'], required: true, example: ['25', '10'] },
  { key: 'lowStockThreshold', header: 'حد_التنبيه', aliases: ['low_stock_threshold'], required: false, example: ['5', '5'] },
  { key: 'option1Name', header: 'الخيار_1', aliases: ['option1_name'], required: false, example: ['اللون', 'اللون'] },
  { key: 'option1Value', header: 'قيمة_الخيار_1', aliases: ['option1_value'], required: false, example: ['أحمر', 'أحمر'] },
  { key: 'option2Name', header: 'الخيار_2', aliases: ['option2_name'], required: false, example: ['المقاس', 'المقاس'] },
  { key: 'option2Value', header: 'قيمة_الخيار_2', aliases: ['option2_value'], required: false, example: ['M', 'L'] },
  { key: 'barcode', header: 'الباركود', aliases: ['barcode'], required: false, example: ['', ''] },
  { key: 'weightGrams', header: 'الوزن_غرام', aliases: ['weight_grams'], required: false, example: ['180', '200'] },
];

/** الملف كله مرفوض — لا سطر منه يُكتب. */
export class ImportFileRejectedError extends DomainError {
  readonly code = 'IMPORT_FILE_REJECTED';
  readonly httpStatus = 422;
}

const normalizeHeader = (h: string): string =>
  h.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** الأرقام الهندية والفارسية إلى لاتينية — البائع يكتب بلوحة مفاتيحه، لا بلوحتنا */
export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** مفتاح مطابقة الأسماء: فراغات موحّدة وحالة أحرف موحّدة */
export const lookupKey = (s: string): string =>
  normalizeDigits(s).trim().toLowerCase().replace(/\s+/g, ' ');

export function resolveHeaders(headers: readonly string[]): Map<ImportColumnKey, number> {
  const byName = new Map<string, ImportColumn>();
  for (const col of IMPORT_COLUMNS) {
    byName.set(normalizeHeader(col.header), col);
    for (const alias of col.aliases) byName.set(normalizeHeader(alias), col);
  }

  const resolved = new Map<ImportColumnKey, number>();
  const unknown: string[] = [];

  headers.forEach((raw, index) => {
    const name = normalizeHeader(raw);
    if (name === '') return;
    const col = byName.get(name);
    if (!col) {
      unknown.push(raw.trim());
      return;
    }
    if (resolved.has(col.key)) {
      throw new ImportFileRejectedError(`العمود «${col.header}» مذكور مرتين في سطر العناوين.`);
    }
    resolved.set(col.key, index);
  });

  // عمود مجهول يُرفض لا يُتجاهل: «السعر_الجديد» المُتجاهَل بصمت يعني أسعاراً لم تُحدَّث
  if (unknown.length > 0) {
    throw new ImportFileRejectedError(
      `أعمدة غير معروفة: ${unknown.join('، ')}. نزّل القالب واستعمل عناوينه كما هي.`,
      { unknown },
    );
  }

  const missing = IMPORT_COLUMNS.filter((c) => c.required && !resolved.has(c.key)).map(
    (c) => c.header,
  );
  if (missing.length > 0) {
    throw new ImportFileRejectedError(`أعمدة إلزامية ناقصة: ${missing.join('، ')}.`, { missing });
  }
  return resolved;
}

export interface RowReason {
  readonly column: string | null;
  readonly message: string;
}

export interface RejectedLine {
  readonly line: number;
  readonly sku: string | null;
  readonly reasons: readonly RowReason[];
}

export interface ParsedRow {
  readonly line: number;
  readonly productRef: string;
  readonly sku: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly descriptionAr: string | null;
  readonly descriptionEn: string | null;
  /** اسم فئة من فئات المتجر — تُنشأ إن غابت. فارغ = بلا فئة */
  readonly category: string | null;
  readonly priceMinorUnits: bigint;
  readonly compareAtPriceMinorUnits: bigint | null;
  readonly stock: number;
  readonly lowStockThreshold: number | null;
  readonly options: readonly { readonly name: string; readonly value: string }[];
  readonly barcode: string | null;
  readonly weightGrams: number | null;
}

const header = (key: ImportColumnKey): string =>
  IMPORT_COLUMNS.find((c) => c.key === key)?.header ?? key;

const LIMITS = { name: 200, description: 5000, productRef: 64, barcode: 64, maxStock: 1_000_000 };

/** يحلّل سطراً واحداً بمعزل عن غيره. يجمع كل أسباب رفضه لا أولها فقط — البائع يصلح مرة واحدة. */
export function parseRow(
  cells: readonly string[],
  columns: ReadonlyMap<ImportColumnKey, number>,
  line: number,
  currency: string,
): { ok: true; row: ParsedRow } | { ok: false; rejected: RejectedLine } {
  const reasons: RowReason[] = [];
  const cell = (key: ImportColumnKey): string => {
    const i = columns.get(key);
    return i === undefined ? '' : (cells[i] ?? '').trim();
  };
  const fail = (key: ImportColumnKey | null, message: string): void => {
    reasons.push({ column: key ? header(key) : null, message });
  };
  const optional = (key: ImportColumnKey, max: number): string | null => {
    const v = cell(key);
    if (v.length > max) fail(key, `أطول من ${max} محرفاً.`);
    return v === '' ? null : v;
  };
  const integer = (key: ImportColumnKey, max: number): number | null => {
    const v = normalizeDigits(cell(key));
    if (v === '') return null;
    // Excel يكتب 12 أحياناً 12.0 — مقبول، و 12.5 مرفوض
    if (!/^\d+(\.0+)?$/.test(v)) {
      fail(key, `«${cell(key)}» ليس عدداً صحيحاً موجباً.`);
      return null;
    }
    const n = Number.parseInt(v, 10);
    if (n > max) {
      fail(key, `الحد الأعلى ${max}.`);
      return null;
    }
    return n;
  };
  const price = (key: ImportColumnKey): bigint | null => {
    const v = cell(key);
    if (v === '') return null;
    try {
      const m = parseMoney(normalizeDigits(v), currency);
      if (m.minorUnits <= 0n) {
        fail(key, 'السعر يجب أن يكون أكبر من صفر.');
        return null;
      }
      return m.minorUnits;
    } catch (err) {
      fail(key, err instanceof MoneyError ? err.message : `«${v}» ليس مبلغاً صالحاً.`);
      return null;
    }
  };

  const width = Math.max(...columns.values()) + 1;
  if (cells.slice(width).some((c) => c.trim() !== '')) {
    fail(null, 'السطر يحوي خانات أكثر من العناوين — غالباً فاصلة داخل نص غير محاط بعلامتي تنصيص.');
  }

  const productRef = cell('productRef');
  if (productRef === '') fail('productRef', 'إلزامي — يجمع أسطر متغيّرات المنتج الواحد.');
  else if (productRef.length > LIMITS.productRef) {
    fail('productRef', `أطول من ${LIMITS.productRef} محرفاً.`);
  }

  const sku = cell('sku');
  if (sku === '') fail('sku', 'إلزامي.');
  else if (!SKU_PATTERN.test(sku)) {
    fail('sku', `«${sku}» غير صالح: حروف لاتينية وأرقام و . _ - / فقط، حتى 64 محرفاً.`);
  }

  const nameAr = cell('nameAr');
  if (nameAr === '') fail('nameAr', 'إلزامي.');
  else if (nameAr.length > LIMITS.name) fail('nameAr', `أطول من ${LIMITS.name} محرفاً.`);

  const category = optional('category', 80);

  if (cell('price') === '') fail('price', 'إلزامي.');
  const priceMinorUnits = price('price');
  const compareAtPriceMinorUnits = price('compareAtPrice');
  if (
    priceMinorUnits !== null &&
    compareAtPriceMinorUnits !== null &&
    compareAtPriceMinorUnits <= priceMinorUnits
  ) {
    fail('compareAtPrice', 'السعر قبل الخصم يجب أن يكون أعلى من السعر الحالي، أو اتركه فارغاً.');
  }

  if (cell('stock') === '') fail('stock', 'إلزامي — اكتب 0 إن لم يتوفّر مخزون.');
  const stock = integer('stock', LIMITS.maxStock);
  const lowStockThreshold = integer('lowStockThreshold', LIMITS.maxStock);
  const weightGrams = integer('weightGrams', 1_000_000);

  const options: { name: string; value: string }[] = [];
  for (const [nameKey, valueKey] of [
    ['option1Name', 'option1Value'],
    ['option2Name', 'option2Value'],
  ] as const) {
    const name = cell(nameKey);
    const value = cell(valueKey);
    if (name === '' && value === '') continue;
    if (name === '') fail(nameKey, `القيمة «${value}» بلا اسم خيار.`);
    else if (value === '') fail(valueKey, `الخيار «${name}» بلا قيمة.`);
    else options.push({ name, value });
  }
  const [firstOption, secondOption] = options;
  if (firstOption && secondOption && lookupKey(firstOption.name) === lookupKey(secondOption.name)) {
    fail('option2Name', `الخيار «${secondOption.name}» مذكور مرتين.`);
  }

  const nameEn = optional('nameEn', LIMITS.name);
  const descriptionAr = optional('descriptionAr', LIMITS.description);
  const descriptionEn = optional('descriptionEn', LIMITS.description);
  const barcode = optional('barcode', LIMITS.barcode);

  if (reasons.length > 0 || priceMinorUnits === null || stock === null) {
    return { ok: false, rejected: { line, sku: sku || null, reasons } };
  }

  return {
    ok: true,
    row: {
      line,
      productRef,
      sku,
      nameAr,
      nameEn,
      descriptionAr,
      descriptionEn,
      category,
      priceMinorUnits,
      compareAtPriceMinorUnits,
      stock,
      lowStockThreshold,
      options,
      barcode,
      weightGrams,
    },
  };
}

export interface AxisLookup {
  readonly id: string;
  readonly nameAr: string;
  /** مفتاح المطابقة (lookupKey) ← معرّف القيمة */
  readonly values: ReadonlyMap<string, string>;
  readonly valueLabels: readonly string[];
}

export interface ImportLookups {
  /** سمات المتغيّرات بالرمز والاسمين، بمفتاح lookupKey */
  readonly axes: ReadonlyMap<string, AxisLookup>;
  /** SKU الحيّة عند هذا البائع وحده */
  readonly existingSkus: ReadonlyMap<
    string,
    { readonly variantId: string; readonly productId: string }
  >;
}

export interface PlannedVariant {
  readonly line: number;
  readonly sku: string;
  readonly priceMinorUnits: bigint;
  readonly compareAtPriceMinorUnits: bigint | null;
  readonly stock: number;
  readonly lowStockThreshold: number | null;
  readonly barcode: string | null;
  readonly weightGrams: number | null;
  readonly options: readonly OptionChoice[];
  readonly optionsKey: string;
}

export interface PlannedProduct {
  readonly productRef: string;
  readonly line: number;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly descriptionAr: string | null;
  readonly descriptionEn: string | null;
  /** اسم فئة المتجر كما كُتب — الخدمة تطابقه أو تنشئه في معاملة الكتابة */
  readonly categoryName: string | null;
  readonly variants: PlannedVariant[];
}

/** SKU موجود عند البائع: السطر يحدّث السعر والمخزون، وحقول المنتج فيه تُتجاهل */
export interface PlannedUpdate {
  readonly line: number;
  readonly sku: string;
  readonly variantId: string;
  readonly productId: string;
  readonly priceMinorUnits: bigint;
  readonly compareAtPriceMinorUnits: bigint | null;
  readonly stock: number;
  readonly lowStockThreshold: number | null;
}

export interface ImportPlan {
  readonly products: readonly PlannedProduct[];
  readonly updates: readonly PlannedUpdate[];
  readonly rejected: readonly RejectedLine[];
}

interface Group {
  readonly product: PlannedProduct;
  readonly axes: string;
  readonly combos: Map<string, number>;
  readonly nameKey: string;
  readonly categoryKey: string;
}

/**
 * يقرّر مصير كل سطر صالح شكلياً بعد مطابقته بما في القاعدة.
 * الأسطر تُعالَج بترتيبها، فالسطر الأول المقبول لرمز منتج يحدّد حقوله.
 */
export function planImport(
  rows: readonly ParsedRow[],
  rejectedAtParse: readonly RejectedLine[],
  lookups: ImportLookups,
): ImportPlan {
  const rejected: RejectedLine[] = [...rejectedAtParse];
  const updates: PlannedUpdate[] = [];
  const groups = new Map<string, Group>();
  const acceptedSkus = new Map<string, number>();

  const availableAxes = [...new Set([...lookups.axes.values()].map((a) => a.nameAr))];

  for (const row of [...rows].sort((a, b) => a.line - b.line)) {
    const reasons: RowReason[] = [];
    const fail = (key: ImportColumnKey | null, message: string): void => {
      reasons.push({ column: key ? header(key) : null, message });
    };

    const firstSeen = acceptedSkus.get(row.sku);
    if (firstSeen !== undefined) {
      rejected.push({
        line: row.line,
        sku: row.sku,
        reasons: [
          { column: header('sku'), message: `مكرر في الملف — ورد أولاً في السطر ${firstSeen}.` },
        ],
      });
      continue;
    }

    const existing = lookups.existingSkus.get(row.sku);
    if (existing) {
      updates.push({
        line: row.line,
        sku: row.sku,
        variantId: existing.variantId,
        productId: existing.productId,
        priceMinorUnits: row.priceMinorUnits,
        compareAtPriceMinorUnits: row.compareAtPriceMinorUnits,
        stock: row.stock,
        lowStockThreshold: row.lowStockThreshold,
      });
      acceptedSkus.set(row.sku, row.line);
      continue;
    }

    const options: OptionChoice[] = [];
    row.options.forEach((opt, i) => {
      const nameKey = i === 0 ? 'option1Name' : 'option2Name';
      const valueKey = i === 0 ? 'option1Value' : 'option2Value';
      const axis = lookups.axes.get(lookupKey(opt.name));
      if (!axis) {
        const offered = availableAxes.slice(0, 8).join('، ') || 'لا شيء بعد';
        fail(nameKey, `«${opt.name}» ليست سمة متغيّرات معرّفة. المتاح: ${offered}.`);
        return;
      }
      const valueId = axis.values.get(lookupKey(opt.value));
      if (!valueId) {
        const offered = axis.valueLabels.slice(0, 12).join('، ');
        fail(valueKey, `القيمة «${opt.value}» غير معرّفة للسمة «${axis.nameAr}». المتاح: ${offered}.`);
        return;
      }
      options.push({ attributeId: axis.id, valueId });
    });

    let optionsKey = '';
    if (reasons.length === 0) {
      if (new Set(options.map((o) => o.attributeId)).size !== options.length) {
        fail('option2Name', 'الخياران يشيران إلى السمة نفسها.');
      } else {
        optionsKey = optionsKeyOf(options);
      }
    }

    const group = groups.get(row.productRef);
    if (group && reasons.length === 0) {
      const ref = `لرمز المنتج «${row.productRef}»`;
      if (lookupKey(row.nameAr) !== group.nameKey) {
        fail('nameAr', `يخالف الاسم في السطر ${group.product.line} ${ref}.`);
      }
      if (lookupKey(row.category ?? '') !== group.categoryKey) {
        fail('category', `تخالف الفئة في السطر ${group.product.line} ${ref}.`);
      }
      if (axesKeyOf(options) !== group.axes) {
        fail(
          null,
          `خيارات هذا السطر لا تطابق خيارات السطر ${group.product.line} ${ref} — كل المتغيّرات تُعرَّف بالسمات ذاتها.`,
        );
      } else if (options.length === 0) {
        fail(
          null,
          `رمز المنتج «${row.productRef}» له أكثر من سطر بلا خيارات تميّزها (السطر ${group.product.line}).`,
        );
      }
      const clash = group.combos.get(optionsKey);
      if (reasons.length === 0 && clash !== undefined) {
        fail(null, `التركيبة نفسها وردت في السطر ${clash} ${ref}.`);
      }
      if (group.product.variants.length >= MAX_VARIANTS_PER_PRODUCT) {
        fail(null, `${ref} بلغ حد ${MAX_VARIANTS_PER_PRODUCT} متغيّر.`);
      }
    }

    if (reasons.length > 0) {
      rejected.push({ line: row.line, sku: row.sku, reasons });
      continue;
    }

    const variant: PlannedVariant = {
      line: row.line,
      sku: row.sku,
      priceMinorUnits: row.priceMinorUnits,
      compareAtPriceMinorUnits: row.compareAtPriceMinorUnits,
      stock: row.stock,
      lowStockThreshold: row.lowStockThreshold,
      barcode: row.barcode,
      weightGrams: row.weightGrams,
      options,
      optionsKey,
    };

    if (group) {
      group.product.variants.push(variant);
      group.combos.set(optionsKey, row.line);
    } else {
      groups.set(row.productRef, {
        product: {
          productRef: row.productRef,
          line: row.line,
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          descriptionAr: row.descriptionAr,
          descriptionEn: row.descriptionEn,
          categoryName: row.category,
          variants: [variant],
        },
        axes: axesKeyOf(options),
        combos: new Map([[optionsKey, row.line]]),
        nameKey: lookupKey(row.nameAr),
        categoryKey: lookupKey(row.category ?? ''),
      });
    }
    acceptedSkus.set(row.sku, row.line);
  }

  return {
    products: [...groups.values()].map((g) => g.product),
    updates,
    rejected: rejected.sort((a, b) => a.line - b.line),
  };
}
