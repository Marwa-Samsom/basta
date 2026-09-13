/**
 * قواعد الكتالوج بلا قاعدة بيانات — المرحلة 05.
 * كل اختبار هنا يحاول تمرير ما يجب رفضه، لا يؤكّد ما يجب قبوله فقط.
 */
import { describe, expect, it } from 'vitest';
import { DuplicateError, InvalidInputError, NotFoundError } from '../../common/errors/domain-error';
import { ScopedRepository, type ScopedDelegate } from '../../common/prisma/scoped-repository';
import { vendorScopeOf } from '../../common/security/actor';
import {
  ancestorPaths,
  buildTree,
  placementUnder,
  planMove,
} from './domain/category-tree';
import {
  ImportFileRejectedError,
  normalizeDigits,
  parseRow,
  planImport,
  resolveHeaders,
  type ImportLookups,
  type ParsedRow,
} from './domain/import-plan';
import { productSlug } from './domain/slug';
import {
  assertVariantMatrix,
  missingRequiredAttributes,
  optionsKeyOf,
} from './domain/variant-matrix';

const COLOR = 'c0000000-0000-4000-8000-000000000001';
const SIZE = 'c0000000-0000-4000-8000-000000000002';
const RED = 'v0000000-0000-4000-8000-000000000001';
const BLUE = 'v0000000-0000-4000-8000-000000000002';
const M = 'v0000000-0000-4000-8000-000000000003';
const L = 'v0000000-0000-4000-8000-000000000004';

// ============================================================================
describe('مصفوفة المتغيّرات — SRS V-02', () => {
  it('مفتاح التركيبة لا يتأثر بترتيب الخيارات', () => {
    expect(
      optionsKeyOf([
        { attributeId: SIZE, valueId: M },
        { attributeId: COLOR, valueId: RED },
      ]),
    ).toBe(
      optionsKeyOf([
        { attributeId: COLOR, valueId: RED },
        { attributeId: SIZE, valueId: M },
      ]),
    );
  });

  it('منتج بثلاثة متغيّرات بتركيبات مختلفة يُقبل', () => {
    const keys = assertVariantMatrix([
      { sku: 'TS-RED-M', options: [{ attributeId: COLOR, valueId: RED }, { attributeId: SIZE, valueId: M }] },
      { sku: 'TS-RED-L', options: [{ attributeId: COLOR, valueId: RED }, { attributeId: SIZE, valueId: L }] },
      { sku: 'TS-BLUE-M', options: [{ attributeId: SIZE, valueId: M }, { attributeId: COLOR, valueId: BLUE }] },
    ]);
    expect(new Set(keys).size).toBe(3);
  });

  it('التركيبة المكررة داخل المنتج تُرفض ولو اختلف ترتيب الخيارات', () => {
    expect(() =>
      assertVariantMatrix([
        { sku: 'A-1', options: [{ attributeId: COLOR, valueId: RED }, { attributeId: SIZE, valueId: M }] },
        { sku: 'A-2', options: [{ attributeId: SIZE, valueId: M }, { attributeId: COLOR, valueId: RED }] },
      ]),
    ).toThrow(DuplicateError);
  });

  it('SKU المكرر يُرفض، والمسافات حوله لا تُخفي التكرار', () => {
    expect(() =>
      assertVariantMatrix([
        { sku: 'A-1', options: [{ attributeId: SIZE, valueId: M }] },
        { sku: ' A-1 ', options: [{ attributeId: SIZE, valueId: L }] },
      ]),
    ).toThrow(DuplicateError);
  });

  it('متغيّرات بسمات مختلفة، أو أكثر من متغيّر بلا خيارات، تُرفض', () => {
    expect(() =>
      assertVariantMatrix([
        { sku: 'A-1', options: [{ attributeId: SIZE, valueId: M }] },
        { sku: 'A-2', options: [{ attributeId: COLOR, valueId: RED }] },
      ]),
    ).toThrow(InvalidInputError);
    expect(() =>
      assertVariantMatrix([
        { sku: 'A-1', options: [] },
        { sku: 'A-2', options: [] },
      ]),
    ).toThrow(InvalidInputError);
  });

  it('السمة نفسها مرتين في متغيّر واحد، و SKU بمحارف غير صالحة، ولا متغيّرات أصلاً — كلها تُرفض', () => {
    expect(() =>
      optionsKeyOf([
        { attributeId: SIZE, valueId: M },
        { attributeId: SIZE, valueId: L },
      ]),
    ).toThrow(InvalidInputError);
    expect(() => assertVariantMatrix([{ sku: 'قميص أحمر', options: [] }])).toThrow(InvalidInputError);
    expect(() => assertVariantMatrix([])).toThrow(InvalidInputError);
  });

  it('السمات الإلزامية غير المملوءة تُسمّى بأسمائها', () => {
    expect(
      missingRequiredAttributes(
        [
          { attributeId: 'a', nameAr: 'الخامة' },
          { attributeId: 'b', nameAr: 'المقاس' },
        ],
        new Set(['b']),
      ),
    ).toEqual(['الخامة']);
  });
});

// ============================================================================
describe('شجرة الفئات', () => {
  it('المسار يُبنى من الأب والعمق يتبعه، والمستوى الخامس يُرفض', () => {
    const root = placementUnder(null, 'r');
    const l1 = placementUnder(root, 'a');
    const l2 = placementUnder(l1, 'b');
    const l3 = placementUnder(l2, 'c');
    expect(l3).toEqual({ path: '/r/a/b/c/', depth: 3 });
    expect(() => placementUnder(l3, 'd')).toThrow(InvalidInputError);
  });

  it('بادئات المسار من الجذر حتى الفئة — مصدر السمات الموروثة', () => {
    expect(ancestorPaths('/1/abc/def/')).toEqual(['/1/', '/1/abc/', '/1/abc/def/']);
  });

  it('نقل فئة تحت أحد فروعها يُرفض — كان سيصنع حلقة', () => {
    expect(() =>
      planMove({ id: 'a', path: '/r/a/', depth: 1 }, { path: '/r/a/b/', depth: 2 }, 2),
    ).toThrow(InvalidInputError);
  });

  it('النقل الذي يدفع أعمق الفروع خارج الحد يُرفض', () => {
    expect(() => planMove({ id: 'a', path: '/r/a/', depth: 1 }, { path: '/x/y/', depth: 1 }, 3)).toThrow(
      InvalidInputError,
    );
    expect(planMove({ id: 'a', path: '/r/a/', depth: 1 }, null, 2)).toEqual({
      oldPrefix: '/r/a/',
      newPrefix: '/a/',
      depthShift: -1,
    });
  });

  it('الشجرة تُرتَّب بالحقل sort والأيتام لا تُرفع إلى الجذر', () => {
    const tree = buildTree([
      { id: 'r', parentId: null, sort: 0 },
      { id: 'b', parentId: 'r', sort: 2 },
      { id: 'a', parentId: 'r', sort: 1 },
      { id: 'orphan', parentId: 'inactive-parent', sort: 0 },
    ]);
    expect(tree.map((n) => n.id)).toEqual(['r']);
    expect(tree[0]?.children.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

// ============================================================================
describe('الاستيراد — تحليل الملف', () => {
  const HEADERS = ['رمز_المنتج', 'SKU', 'الاسم_عربي', 'الفئة', 'السعر', 'السعر_قبل_الخصم', 'الكمية', 'الخيار_1', 'قيمة_الخيار_1'];
  const columns = resolveHeaders(HEADERS);
  const row = (overrides: Partial<Record<string, string>> = {}) =>
    HEADERS.map(
      (h) =>
        overrides[h] ??
        ({ رمز_المنتج: 'P1', SKU: 'P1-M', الاسم_عربي: 'قميص', الفئة: 'fashion', السعر: '79.00', الكمية: '5' } as Record<string, string>)[h] ??
        '',
    );

  it('العناوين العربية والإنجليزية مقبولة معاً', () => {
    expect(resolveHeaders(['product_ref', 'sku', 'name_ar', 'category', 'price', 'stock']).size).toBe(6);
  });

  it('عمود مجهول أو مكرر أو إلزامي ناقص يرفض الملف كله', () => {
    expect(() => resolveHeaders([...HEADERS, 'السعر_الجديد'])).toThrow(ImportFileRejectedError);
    expect(() => resolveHeaders([...HEADERS, 'price'])).toThrow(ImportFileRejectedError);
    expect(() => resolveHeaders(['SKU', 'الاسم_عربي'])).toThrow(ImportFileRejectedError);
  });

  it('الدينار بثلاث خانات: «12.500» تعني 12500 لا 1250، والريال يرفض الخانة الثالثة', () => {
    const jod = parseRow(row({ السعر: '12.500' }), columns, 2, 'JOD');
    expect(jod.ok && jod.row.priceMinorUnits).toBe(12_500n);
    const sar = parseRow(row({ السعر: '1.234' }), columns, 2, 'SAR');
    expect(sar.ok).toBe(false);
  });

  it('الأرقام الهندية تُقبل، و 12.0 من Excel عدد صحيح، و 12.5 كمية مرفوضة', () => {
    expect(normalizeDigits('٢٥')).toBe('25');
    const arabic = parseRow(row({ الكمية: '٢٥' }), columns, 2, 'SAR');
    expect(arabic.ok && arabic.row.stock).toBe(25);
    const excel = parseRow(row({ الكمية: '12.0' }), columns, 2, 'SAR');
    expect(excel.ok && excel.row.stock).toBe(12);
    expect(parseRow(row({ الكمية: '12.5' }), columns, 2, 'SAR').ok).toBe(false);
  });

  it('يجمع كل أسباب رفض السطر لا أولها — البائع يصلح مرة واحدة', () => {
    const result = parseRow(
      row({ SKU: '', السعر: 'مجاناً', السعر_قبل_الخصم: '', الخيار_1: 'اللون' }),
      columns,
      7,
      'SAR',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected.line).toBe(7);
      expect(result.rejected.reasons.map((r) => r.column)).toEqual(
        expect.arrayContaining(['SKU', 'السعر', 'قيمة_الخيار_1']),
      );
    }
  });

  it('السعر قبل الخصم الأدنى من السعر يُرفض', () => {
    expect(parseRow(row({ السعر_قبل_الخصم: '50.00' }), columns, 2, 'SAR').ok).toBe(false);
  });
});

// ============================================================================
describe('الاستيراد — خطة الكتابة', () => {
  const FASHION = 'f0000000-0000-4000-8000-000000000001';
  const GROCERY = 'f0000000-0000-4000-8000-000000000002';
  const color = { id: COLOR, nameAr: 'اللون', values: new Map([['أحمر', RED], ['أزرق', BLUE]]), valueLabels: ['أحمر', 'أزرق'] };
  const size = { id: SIZE, nameAr: 'المقاس', values: new Map([['m', M], ['l', L]]), valueLabels: ['M', 'L'] };

  const lookups: ImportLookups = {
    categories: new Map([
      ['fashion', { id: FASHION, nameAr: 'ملابس', axisIds: new Set([COLOR, SIZE]) }],
      ['grocery', { id: GROCERY, nameAr: 'بقالة', axisIds: new Set<string>() }],
    ]),
    axes: new Map([
      ['اللون', color],
      ['color', color],
      ['المقاس', size],
    ]),
    existingSkus: new Map([['OLD-1', { variantId: 'old-variant', productId: 'old-product' }]]),
  };

  const parsed = (line: number, over: Partial<ParsedRow> = {}): ParsedRow => ({
    line,
    productRef: 'P1',
    sku: `P1-${line}`,
    nameAr: 'قميص',
    nameEn: null,
    descriptionAr: null,
    descriptionEn: null,
    category: 'fashion',
    priceMinorUnits: 7900n,
    compareAtPriceMinorUnits: null,
    stock: 3,
    lowStockThreshold: null,
    options: [{ name: 'المقاس', value: 'M' }],
    barcode: null,
    weightGrams: null,
    ...over,
  });

  it('أسطر رمز منتج واحد تصير منتجاً واحداً بمتغيّراته', () => {
    const plan = planImport(
      [parsed(2), parsed(3, { options: [{ name: 'المقاس', value: 'L' }] })],
      [],
      lookups,
    );
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0]?.variants.map((v) => v.line)).toEqual([2, 3]);
    expect(plan.rejected).toHaveLength(0);
  });

  it('SKU موجود في المتجر يحدّث ولا يُنشئ، و SKU مكرر في الملف يُرفض بسطره الأول', () => {
    const plan = planImport(
      [parsed(2, { sku: 'OLD-1' }), parsed(3, { sku: 'DUP' }), parsed(4, { sku: 'DUP', options: [{ name: 'المقاس', value: 'L' }] })],
      [],
      lookups,
    );
    expect(plan.updates.map((u) => u.variantId)).toEqual(['old-variant']);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0]?.reasons[0]?.message).toContain('السطر 3');
  });

  it('فئة مجهولة، وسمة لا تخصّ الفئة، وقيمة غير معرّفة — كلٌّ يرفض سطره وحده', () => {
    const plan = planImport(
      [
        parsed(2, { productRef: 'A', category: 'toys' }),
        parsed(3, { productRef: 'B', category: 'grocery' }),
        parsed(4, { productRef: 'C', options: [{ name: 'اللون', value: 'بنفسجي' }] }),
        parsed(5, { productRef: 'D' }),
      ],
      [],
      lookups,
    );
    expect(plan.rejected.map((r) => r.line)).toEqual([2, 3, 4]);
    expect(plan.rejected[2]?.reasons[0]?.message).toContain('أحمر، أزرق');
    expect(plan.products.map((p) => p.productRef)).toEqual(['D']);
  });

  it('سطر يخالف أول أسطر رمز منتجه في الاسم أو السمات أو يكرر تركيبته يُرفض', () => {
    const plan = planImport(
      [
        parsed(2),
        parsed(3, { nameAr: 'بنطال', options: [{ name: 'المقاس', value: 'L' }] }),
        parsed(4, { options: [{ name: 'اللون', value: 'أحمر' }] }),
        parsed(5),
      ],
      [],
      lookups,
    );
    expect(plan.rejected.map((r) => r.line)).toEqual([3, 4, 5]);
    expect(plan.products[0]?.variants).toHaveLength(1);
  });
});

// ============================================================================
describe('ScopedRepository.updateWhere', () => {
  const calls: Record<string, unknown>[] = [];
  const delegate: ScopedDelegate<unknown> = {
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    updateMany: async (args) => {
      calls.push(args.where);
      return { count: 2 };
    },
    deleteMany: async () => ({ count: 0 }),
  };
  const scope = vendorScopeOf({ userId: 'u', roles: ['vendor_owner'], vendorId: 'vendor-a', permissions: [] });

  it('يحقن فلتر المالك في الكتابة الجماعية', async () => {
    const repo = new ScopedRepository(delegate, scope, 'المتغيّر');
    await expect(repo.updateWhere({ productId: 'p' }, { archivedAt: new Date() })).resolves.toBe(2);
    expect(calls.at(-1)).toEqual({ productId: 'p', vendorId: 'vendor-a' });
  });

  it('يرفض vendorId مخالفاً صراحةً ولا يكتب شيئاً', async () => {
    const before = calls.length;
    const repo = new ScopedRepository(delegate, scope, 'المتغيّر');
    await expect(repo.updateWhere({ vendorId: 'vendor-b' }, {})).rejects.toBeInstanceOf(NotFoundError);
    expect(calls.length).toBe(before);
  });
});

describe('المعرّف النصّي للمنتج', () => {
  it('من الاسم الإنجليزي بلا تشكيل ولا رموز، و product حين يغيب', () => {
    expect(productSlug('Café Crème — Large!', 'ab12')).toBe('cafe-creme-large-ab12');
    expect(productSlug(null, 'ab12')).toBe('product-ab12');
    expect(productSlug('!!!', 'ab12')).toBe('product-ab12');
  });
});
