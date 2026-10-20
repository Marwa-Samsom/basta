import { describe, expect, it } from 'vitest';
import { ADMIN_PAGE, pageArgs, pageOf, termOf } from './paging';

describe('صفحات القوائم الإدارية', () => {
  it('رقم الصفحة: الأولى إن غاب أو لم يكن عدداً صحيحاً موجباً', () => {
    expect(pageOf(undefined)).toBe(1);
    expect(pageOf('')).toBe(1);
    expect(pageOf('abc')).toBe(1);
    expect(pageOf('0')).toBe(1);
    expect(pageOf('-3')).toBe(1);
    expect(pageOf('2.5')).toBe(1);
    expect(pageOf('3')).toBe(3);
  });

  it('الصفحة الثانية تبدأ حيث انتهت الأولى', () => {
    expect(pageArgs(1)).toEqual({ skip: 0, take: ADMIN_PAGE });
    expect(pageArgs(2)).toEqual({ skip: ADMIN_PAGE, take: ADMIN_PAGE });
    expect(pageArgs(3, 20)).toEqual({ skip: 40, take: 20 });
  });

  it('عبارة البحث منظّفة ومحدودة، والفارغة لا تُرسل', () => {
    expect(termOf(undefined)).toBeUndefined();
    expect(termOf('   ')).toBeUndefined();
    expect(termOf('  غزة ')).toBe('غزة');
    expect(termOf('x'.repeat(300))).toHaveLength(100);
  });
});
