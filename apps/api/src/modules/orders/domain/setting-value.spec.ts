import { describe, expect, it } from 'vitest';
import { settingNumber } from './setting-value';

describe('قيمة الإعداد بحدّها الأدنى (VOPS-072)', () => {
  it('الصفر مقبول حيث الحدّ الأدنى صفر — تعليق الرصيد ومهلة الإرجاع', () => {
    expect(settingNumber(0, 14, 0)).toBe(0);
    expect(settingNumber('0', 14, 0)).toBe(0);
    expect(settingNumber(7, 14, 0)).toBe(7);
  });

  it('ودون الحدّ الأدنى يعود إلى الافتراضي — مهلة القبول لا تكون صفراً', () => {
    expect(settingNumber(0, 48, 1)).toBe(48);
    expect(settingNumber(-1, 14, 0)).toBe(14);
  });

  it('التالف في القاعدة يعود إلى الافتراضي لا إلى صفر', () => {
    for (const raw of [null, undefined, '', '  ', 'abc', true, [], {}, Number.NaN, Infinity]) {
      expect(settingNumber(raw, 14, 0), String(raw)).toBe(14);
    }
  });
});
