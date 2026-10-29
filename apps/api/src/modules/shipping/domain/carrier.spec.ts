import { describe, expect, it } from 'vitest';
import { currentAttempt, nextCode, type TrackingCode } from './carrier';

const at = (min: number) => new Date(Date.UTC(2026, 9, 29, 12, min));
const ev = (code: TrackingCode, min: number) => ({ code, occurredAt: at(min) });
/** ما تختاره مهمة الشركة للشحنة: التالي بعد آخر حدث في المحاولة الجارية */
const next = (events: { code: string; occurredAt: Date }[], shippedAt: Date | null) =>
  nextCode((currentAttempt(events, shippedAt).at(-1)?.code as TrackingCode | undefined) ?? null);

describe('المحاولة الجارية للشحنة — إعادة الشحن بعد «تعذّر التوصيل» (VOPS-035)', () => {
  const failed = [ev('picked_up', 1), ev('in_transit', 2), ev('out_for_delivery', 3), ev('failed', 4)];

  it('بلا «تعذّر» الأحداث كلها، والمسار يمضي حتى التسليم', () => {
    const events = [ev('picked_up', 1), ev('in_transit', 2)];
    expect(currentAttempt(events, at(0))).toEqual(events);
    expect(next(events, at(0))).toBe('out_for_delivery');
    expect(next([], at(0))).toBe('picked_up');
  });

  it('«تعذّر» قبل إعادة الشحن: المحاولة الفاشلة نفسها، ولا تقدّم', () => {
    expect(currentAttempt(failed, at(0))).toEqual(failed);
    expect(next(failed, at(0))).toBeNull();
  });

  it('شُحنت من جديد بعد «تعذّر»: تبدأ من «استلمت الشركة» وما قبلها تاريخ', () => {
    expect(currentAttempt(failed, at(5))).toEqual([]);
    expect(next(failed, at(5))).toBe('picked_up');
    const again = [...failed, ev('picked_up', 6), ev('in_transit', 7)];
    expect(currentAttempt(again, at(5))).toEqual([ev('picked_up', 6), ev('in_transit', 7)]);
    expect(next(again, at(5))).toBe('out_for_delivery');
  });

  it('«تعذّر» ثانٍ بعد إعادة الشحن يبدأ محاولة ثالثة', () => {
    const twice = [...failed, ev('picked_up', 6), ev('failed', 7), ev('picked_up', 9)];
    expect(currentAttempt(twice, at(8))).toEqual([ev('picked_up', 9)]);
    expect(next(twice, at(8))).toBe('in_transit');
  });
});
