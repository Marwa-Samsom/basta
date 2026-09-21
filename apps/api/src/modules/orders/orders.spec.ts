import { describe, expect, it } from 'vitest';
import { planFullRefund, planPartialRefund, toCharge } from './domain/refunds';
import {
  allowedFor,
  assertTransition,
  deriveParent,
  type SubOrderStatus,
  type TransitionActor,
} from './domain/state-machine';

describe('آلة الحالات — الانتقالات المرفوضة صراحةً (ORDER-STATES §1)', () => {
  const rejected: [SubOrderStatus, SubOrderStatus, TransitionActor][] = [
    ['delivered', 'preparing', 'vendor'],
    ['shipped', 'canceled_by_customer', 'customer'],
    ['preparing', 'canceled_by_customer', 'customer'],
    ['completed', 'refunded', 'admin'],
    ['refunded', 'awaiting_vendor', 'system'],
    ['awaiting_vendor', 'shipped', 'vendor'],
  ];

  for (const [from, to, actor] of rejected) {
    it(`${from} → ${to} مرفوض`, () => {
      expect(() => assertTransition(from, to, actor, { reason: 'سبب طويل بما يكفي', tracking: 'TRK-1234' })).toThrow();
    });
  }

  it('الفاعل الخطأ مرفوض كالانتقال المجهول', () => {
    expect(() => assertTransition('shipped', 'delivered', 'customer')).toThrow(/دورك/);
    expect(() => assertTransition('delivered', 'completed', 'vendor')).toThrow(/دورك/);
    expect(() => assertTransition('awaiting_vendor', 'accepted', 'customer')).toThrow(/دورك/);
  });
});

describe('آلة الحالات — الشروط', () => {
  it('الرفض يحتاج سبباً، والشحن يحتاج رقم تتبّع', () => {
    expect(() => assertTransition('awaiting_vendor', 'rejected_by_vendor', 'vendor')).toThrow(/السبب/);
    expect(() => assertTransition('ready_to_ship', 'shipped', 'vendor')).toThrow(/التتبّع/);
    expect(() =>
      assertTransition('ready_to_ship', 'shipped', 'vendor', { tracking: 'ARX-99812' }),
    ).not.toThrow();
  });

  it('المسار السعيد كاملاً مسموح بفاعليه', () => {
    const path: [SubOrderStatus, SubOrderStatus, TransitionActor][] = [
      ['awaiting_vendor', 'accepted', 'vendor'],
      ['accepted', 'preparing', 'vendor'],
      ['preparing', 'ready_to_ship', 'vendor'],
      ['shipped', 'delivered', 'carrier'],
      ['delivered', 'completed', 'system'],
    ];
    for (const [from, to, actor] of path) expect(() => assertTransition(from, to, actor)).not.toThrow();
  });

  it('الأزرار المتاحة لكل دور تُشتقّ من الجدول نفسه', () => {
    expect(allowedFor('awaiting_vendor', 'vendor')).toEqual(['accepted', 'rejected_by_vendor']);
    expect(allowedFor('accepted', 'customer')).toEqual(['canceled_by_customer']);
    expect(allowedFor('preparing', 'customer')).toEqual([]);
  });
});

describe('حالة الأب مشتقّة (ORDER-STATES §2)', () => {
  it('مكتمل حين تكتمل كلها، لا حين يكتمل واحد', () => {
    expect(deriveParent(['completed', 'completed'])).toBe('completed');
    expect(deriveParent(['completed', 'shipped'])).toBe('partially_completed');
  });

  it('إلغاء فرعي لا يجعل الأب ملغى وإخوته قائمون', () => {
    expect(deriveParent(['refunded', 'preparing', 'accepted'])).toBe('partially_completed');
    expect(deriveParent(['canceled_by_customer', 'canceled_by_admin'])).toBe('canceled');
    expect(deriveParent(['refunded', 'refunded'])).toBe('refunded');
  });
});

describe('الاسترداد', () => {
  const lines = [
    { orderItemId: 'a', lineTotalMinor: 30_000n, qty: 3, refundedQty: 0, commissionMinor: 3_000n },
    { orderItemId: 'b', lineTotalMinor: 10_000n, qty: 1, refundedQty: 0, commissionMinor: 1_000n },
  ];

  it('إرجاع قطعة من ثلاث يردّ ثلث السطر ويعكس ثلث عمولته', () => {
    const plan = planPartialRefund({
      lines,
      returned: [{ orderItemId: 'a', qty: 1 }],
      fxRateSnapshot: '1.0000000000',
      chargeTotalMinor: 42_500n,
      alreadyRefundedChargeMinor: 0n,
    });
    expect(plan.vendorMinor).toBe(10_000n);
    expect(plan.chargeMinor).toBe(10_000n);
    expect(plan.commissionReversedMinor).toBe(1_000n);
  });

  it('يُحوَّل بسعر اللقطة: ريال ← دينار', () => {
    // 1 وحدة دينار صغرى = 5.2356 وحدة ريال صغرى تقريباً (لقطة الطلب)
    expect(toCharge(10_000n, '5.2356020942')).toBe(1_910n);
  });

  it('لا يُرجع أكثر مما بقي من السطر', () => {
    expect(() =>
      planPartialRefund({
        lines: [{ ...lines[0]!, refundedQty: 2 }],
        returned: [{ orderItemId: 'a', qty: 2 }],
        fxRateSnapshot: '1',
        chargeTotalMinor: 42_500n,
        alreadyRefundedChargeMinor: 0n,
      }),
    ).toThrow(/بقي منه 1/);
  });

  it('لا يُردّ أكثر من المدفوع ولو اجتمعت فروق التقريب', () => {
    const plan = planPartialRefund({
      lines,
      returned: [
        { orderItemId: 'a', qty: 3 },
        { orderItemId: 'b', qty: 1 },
      ],
      fxRateSnapshot: '0.9999',
      chargeTotalMinor: 40_000n,
      alreadyRefundedChargeMinor: 0n,
    });
    expect(plan.chargeMinor).toBe(40_000n);
  });

  it('الكامل = ما بقي من المدفوع بالضبط، بلا تحويل ولا تقريب', () => {
    const plan = planFullRefund({
      vendorTotalMinor: 42_500n,
      commissionMinor: 4_000n,
      chargeTotalMinor: 8_123n,
      alreadyRefundedChargeMinor: 1_000n,
    });
    expect(plan.chargeMinor).toBe(7_123n);
  });
});
