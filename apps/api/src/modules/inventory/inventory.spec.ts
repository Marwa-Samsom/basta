/**
 * قواعد المخزون بلا قاعدة بيانات — المرحلة 05.
 * التزامن الحقيقي يثبته inventory.integration.spec.ts؛ هنا القرار وحده.
 */
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../../common/errors/domain-error';
import {
  StockBelowReservedError,
  availableOf,
  lowStockTransition,
  normalizeReservationLines,
  planAdjustment,
} from './domain/stock';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

describe('أسطر الحجز', () => {
  it('تُدمج أسطر المتغيّر الواحد وتُرتَّب بالمعرّف — ترتيب القفل الثابت يمنع التعطّل المتبادل', () => {
    const lines = normalizeReservationLines([
      { variantId: B, qty: 1, label: 'ب' },
      { variantId: A, qty: 2, label: 'أ' },
      { variantId: B, qty: 3, label: 'ب' },
    ]);
    expect(lines).toEqual([
      { variantId: A, qty: 2, label: 'أ' },
      { variantId: B, qty: 4, label: 'ب' },
    ]);
  });

  it('ترفض الكمية الصفرية والسالبة والكسرية والسلة الفارغة', () => {
    for (const qty of [0, -1, 1.5]) {
      expect(() => normalizeReservationLines([{ variantId: A, qty, label: 'أ' }])).toThrow(InvalidInputError);
    }
    expect(() => normalizeReservationLines([])).toThrow(InvalidInputError);
  });

  it('ترفض كمية تتجاوز الحد بعد الدمج لا قبله فقط', () => {
    expect(() =>
      normalizeReservationLines([
        { variantId: A, qty: 6000, label: 'أ' },
        { variantId: A, qty: 6000, label: 'أ' },
      ]),
    ).toThrow(InvalidInputError);
  });
});

describe('التعديل اليدوي', () => {
  const level = { onHand: 10, reserved: 3, lowStockThreshold: 2 };

  it('الجرد الفعلي (setTo) يُترجم إلى delta واحد — مجموع الحركات يبقى onHand', () => {
    expect(planAdjustment(level, { setTo: 7 })).toEqual({ delta: -3, onHand: 7 });
    expect(planAdjustment(level, { delta: 5 })).toEqual({ delta: 5, onHand: 15 });
    expect(planAdjustment(level, { setTo: 10 })).toEqual({ delta: 0, onHand: 10 });
  });

  it('لا مخزون سالب', () => {
    expect(() => planAdjustment(level, { delta: -11 })).toThrow(InvalidInputError);
    expect(() => planAdjustment(level, { setTo: -1 })).toThrow(InvalidInputError);
  });

  it('لا خفض تحت المحجوز — تلك القطع وُعد بها مشترٍ في صفحة الدفع', () => {
    expect(() => planAdjustment(level, { setTo: 2 })).toThrow(StockBelowReservedError);
    expect(planAdjustment(level, { setTo: 3 }).onHand).toBe(3);
  });

  it('المتاح لا يكون سالباً ولو انحرف المحجوز', () => {
    expect(availableOf({ onHand: 2, reserved: 5 })).toBe(0);
    expect(availableOf({ onHand: 5, reserved: 2 })).toBe(3);
  });
});

describe('عتبة النفاد', () => {
  it('تُرصد عند النزول إليها وتُمسح عند تجاوزها صعوداً، ولا تتكرّر', () => {
    expect(lowStockTransition(5, 5, false)).toBe('entered');
    expect(lowStockTransition(4, 5, true)).toBe('unchanged');
    expect(lowStockTransition(6, 5, true)).toBe('left');
    expect(lowStockTransition(6, 5, false)).toBe('unchanged');
  });

  it('العتبة صفر تعني التنبيه عند النفاد وحده', () => {
    expect(lowStockTransition(1, 0, false)).toBe('unchanged');
    expect(lowStockTransition(0, 0, false)).toBe('entered');
  });
});
