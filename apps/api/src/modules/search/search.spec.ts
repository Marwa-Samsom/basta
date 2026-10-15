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

  it('السعر والأحدث يُرسلان صراحةً', () => {
    expect(buildSort('price_asc')).toEqual(['priceMinor:asc']);
    expect(buildSort('price_desc')).toEqual(['priceMinor:desc']);
    expect(buildSort('newest')).toEqual(['createdAt:desc']);
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
    ].map((f) => String(f).split(' ')[0]);

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

  it('المرادفات العامّية متبادلة: من يبحث «جوال» يجد «هاتف» والعكس', () => {
    expect(SYNONYMS['جوال']).toContain('هاتف');
    expect(SYNONYMS['هاتف']).toContain('جوال');
    expect(SYNONYMS['بنطلون']).toContain('بنطال');
    expect(SYNONYMS['بنطال']).toContain('بنطلون');
  });

  it('الاسم العربي أول الحقول القابلة للبحث — ترتيبها يرجّح الصلة', () => {
    expect(INDEX_SETTINGS.searchableAttributes[0]).toBe('nameAr');
  });
});
