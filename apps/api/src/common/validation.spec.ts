import { describe, expect, it } from 'vitest';
import { assertOneOf, isCalendarDate } from './validation';

describe('مدخلات تُرفض قبل القاعدة', () => {
  it('اليوم الحقيقي وحده: الصيغة لا تكفي', () => {
    for (const ok of ['2026-01-31', '2024-02-29', '2026-12-31']) expect(isCalendarDate(ok), ok).toBe(true);
    for (const bad of ['2026-13-01', '2026-02-30', '2025-02-29', '2026-00-10', '2026-1-01', '26-01-01', '2026-01-01T00:00:00Z', 'abc']) {
      expect(isCalendarDate(bad), bad).toBe(false);
    }
  });

  it('قيمة من التعداد أو 400', () => {
    expect(assertOneOf('paid', ['paid', 'failed'], 'الحالة')).toBe('paid');
    expect(() => assertOneOf('weird', ['paid', 'failed'], 'الحالة')).toThrow(/الحالة غير معروفة/);
  });
});
