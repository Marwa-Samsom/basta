import { describe, expect, it } from 'vitest';
import {
  buildFilter,
  buildSort,
  INDEX_SETTINGS,
  MAX_PAGE_SIZE,
  pageOf,
  SYNONYMS,
} from './domain/search-query';

describe('مرشّحات البحث', () => {
  it('فئة المتجر تُرشَّح داخل متجرها — المتجر والفئة شرطان معاً', () => {
    expect(buildFilter({ vendorId: 'v', storeCategoryId: 'c' })).toEqual(['vendorId = "v"', 'storeCategoryId = "c"']);
  });

  it('بعملة العرض: عملتها بسعرها الخام، وغيرها بدولار الفهرس — 10 دنانير ليست أرخص من 20 ريالاً', () => {
    expect(buildFilter({ displayCurrency: 'JOD', minPriceMinor: 10_000, minPriceUsd: 13.8, maxPriceMinor: 20_000, maxPriceUsd: 27.6 })).toEqual([
      '(currency = "JOD" AND priceMinor >= 10000) OR (currency != "JOD" AND priceUsd >= 13.8)',
      '(currency = "JOD" AND priceMinor <= 20000) OR (currency != "JOD" AND priceUsd <= 27.6)',
    ]);
  });

  it('السعر مدىً، والمخزون شرطاً', () => {
    expect(buildFilter({ minPriceMinor: 1000, maxPriceMinor: 5000, inStockOnly: true })).toEqual([
      'priceMinor >= 1000',
      'priceMinor <= 5000',
      'available > 0',
    ]);
  });

  it('كل سمة مطلوبة شرط مستقل — أحمر **و** مقاس M لا أحدهما', () => {
    const filter = buildFilter({ attributeValueIds: ['v-red', 'v-m'] });
    expect(filter).toEqual(['attributeValueIds = "v-red"', 'attributeValueIds = "v-m"']);
  });

  it('الاقتباس داخل القيمة يُهرَّب فلا يكسر المرشّح', () => {
    const filter = buildFilter({ vendorId: 'a"b' });
    expect(filter[0]).toBe('vendorId = "a\\"b"');
  });

  it('بلا مدخلات لا مرشّحات — القائمة الفارغة تعني «كل المعروض»', () => {
    expect(buildFilter({})).toEqual([]);
  });
});

describe('الترتيب والصفحات', () => {
  it('الصلة ترتيب المحرّك نفسه فلا تُرسَل', () => {
    expect(buildSort('relevance')).toEqual([]);
    expect(buildSort(undefined)).toEqual([]);
  });

  it('السعر بدولار الفهرس لا بالوحدة الخام بين العملات، والأحدث بتاريخ النشر لا الإنشاء (DISC-029)', () => {
    expect(buildSort('price_asc')).toEqual(['priceUsd:asc']);
    expect(buildSort('price_desc')).toEqual(['priceUsd:desc']);
    expect(buildSort('newest')).toEqual(['publishedAt:desc']);
  });

  it('حجم الصفحة محدود: طلب 1000 لا يسحب الفهرس كله', () => {
    expect(pageOf({ pageSize: 1000 })).toEqual({ page: 1, pageSize: MAX_PAGE_SIZE });
    expect(pageOf({ page: 0, pageSize: 0 })).toEqual({ page: 1, pageSize: 1 });
    expect(pageOf({})).toEqual({ page: 1, pageSize: 24 });
  });
});

describe('إعدادات الفهرس', () => {
  it('كل حقل يُرشَّح به مُعلَن — وإلا رفض المحرّك المرشّح وقت التنفيذ', () => {
    const used = [
      ...buildFilter({
        vendorId: 'v',
        storeCategoryId: 'c',
        brandId: 'b',
        attributeValueIds: ['a'],
        minPriceMinor: 1,
        inStockOnly: true,
      }),
      ...buildFilter({ displayCurrency: 'JOD', maxPriceMinor: 1, maxPriceUsd: 1 }),
    ].flatMap((f) => [...String(f).matchAll(/([a-zA-Z]+) (?:>=|<=|!=|=|>|<) /g)].map((m) => m[1]!));

    // كل «حقل عامل» في المرشّح، ولو داخل تعبير مركّب بـ AND و OR
    expect(used).toContain('priceUsd');
    for (const field of used) {
      expect(INDEX_SETTINGS.filterableAttributes).toContain(field);
    }
  });

  it('كل حقل يُرتَّب به مُعلَن كذلك', () => {
    for (const key of ['price_asc', 'price_desc', 'newest'] as const) {
      for (const rule of buildSort(key)) {
        expect(INDEX_SETTINGS.sortableAttributes).toContain(rule.split(':')[0]);
      }
    }
  });

  it('عتبة الخطأ الإملائي تبدأ عند أربعة أحرف — الكلمة العربية قصيرة', () => {
    expect(INDEX_SETTINGS.typoTolerance.minWordSizeForTypos.oneTypo).toBeLessThanOrEqual(4);
  });

  it('DISC-019: خطأ واحد من أربعة أحرف بالضبط (ما دونها لا يُصحَّح)، وخطآن من ثمانية', () => {
    expect(INDEX_SETTINGS.typoTolerance.enabled).toBe(true);
    expect(INDEX_SETTINGS.typoTolerance.minWordSizeForTypos).toEqual({ oneTypo: 4, twoTypos: 8 });
  });

  it('المرادفات العامّية متبادلة: من يبحث «جوال» يجد «هاتف» والعكس', () => {
    expect(SYNONYMS['جوال']).toContain('هاتف');
    expect(SYNONYMS['هاتف']).toContain('جوال');
    expect(SYNONYMS['بنطلون']).toContain('بنطال');
    expect(SYNONYMS['بنطال']).toContain('بنطلون');
  });

  it('DISC-020: «موبايل» و«شنطة» و«لابتوب» في جدول المرادفات بأسمائها الفصيحة', () => {
    expect(SYNONYMS['موبايل']).toContain('هاتف');
    expect(SYNONYMS['شنطة']).toContain('حقيبة');
    expect(SYNONYMS['حقيبة']).toContain('شنطة');
    expect(SYNONYMS['لابتوب']).toContain('حاسوب');
  });

  it('الاسم العربي أول الحقول القابلة للبحث — ترتيبها يرجّح الصلة', () => {
    expect(INDEX_SETTINGS.searchableAttributes[0]).toBe('nameAr');
  });
});
