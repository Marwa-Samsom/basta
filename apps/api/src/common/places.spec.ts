import { describe, expect, it } from 'vitest';
import { placeKey, samePlace } from './places';

describe('مقارنة أسماء الأماكن', () => {
  it('تتجاهل التشكيل والشدّة والتطويل والمسافات', () => {
    expect(samePlace('عمّان', 'عمان')).toBe(true);
    expect(samePlace('  عَمَّـان  ', 'عمان')).toBe(true);
    expect(samePlace('الرياض   الكبرى', 'الرياض الكبرى')).toBe(true);
  });

  it('توحّد الهمزات والتاء المربوطة والألف المقصورة', () => {
    expect(samePlace('الزرقا', 'الزرقاء')).toBe(true);
    expect(samePlace('إربد', 'اربد')).toBe(true);
    expect(samePlace('مكة المكرمة', 'مكه المكرمه')).toBe(true);
    expect(samePlace('الضحى', 'الضحي')).toBe(true);
  });

  it('تُسقط «محافظة» و«منطقة» في أوّل الاسم وحده', () => {
    expect(samePlace('محافظة عجلون', 'عجلون')).toBe(true);
    expect(samePlace('منطقة الرياض', 'الرياض')).toBe(true);
    // «المنطقة الشرقية» اسم المنطقة نفسه لا بادئة
    expect(placeKey('المنطقة الشرقية')).toBe('المنطقه الشرقيه');
  });

  it('لا تخلط مكانين مختلفين، والفارغ لا يطابق إلا الفارغ', () => {
    expect(samePlace('عمان', 'عجلون')).toBe(false);
    expect(samePlace('الزرقاء', 'الزرقاء الجديدة')).toBe(false);
    expect(samePlace('', null)).toBe(true);
    expect(samePlace('عمان', null)).toBe(false);
  });
});
