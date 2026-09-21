/**
 * مبالغ الاسترداد — بوابة المرحلة 09 البند الثاني.
 *
 * المال يعود **بعملة الدفع** (المشتري دفع بالدينار فيُردّ بالدينار)، ويُحسب
 * **بعملة البائع** أولاً (السطر مسعَّر بها). التحويل بسعر اللقطة لا بسعر
 * اليوم: استرداد طلب أمس بسعر اليوم يربح المشتري أو يخسر فرقاً لا علاقة له به.
 */

import { InvalidInputError } from '../../../common/errors/domain-error';

export interface RefundLine {
  readonly orderItemId: string;
  /** إجمالي السطر بعملة البائع كما دُفع (بعد خصمه، وبضريبته إن كانت مضافة) */
  readonly lineTotalMinor: bigint;
  readonly qty: number;
  readonly refundedQty: number;
  readonly commissionMinor: bigint;
}

export interface RefundPlan {
  /** بعملة البائع — ما يُعكس من مستحقاته (المرحلة 10 تقيّده في الدفتر) */
  readonly vendorMinor: bigint;
  /** بعملة الدفع — ما يُردّ للمشتري فعلاً */
  readonly chargeMinor: bigint;
  /** العمولة المعكوسة بنسبة المسترد — ORDER-STATES §1 القاعدة 3 */
  readonly commissionReversedMinor: bigint;
  readonly lines: readonly { orderItemId: string; qty: number }[];
}

/**
 * استرداد جزئي بالقطع المرتجعة. نصيب كل قطعة بالتقريب لأسفل، ولا يُردّ
 * الشحن في الإرجاع الجزئي — وصلت الشحنة، والإرجاع لبعضها.
 */
export function planPartialRefund(input: {
  readonly lines: readonly RefundLine[];
  readonly returned: readonly { orderItemId: string; qty: number }[];
  /** وحدات البائع الصغرى لكل وحدة صغرى من عملة الدفع — لقطة الطلب */
  readonly fxRateSnapshot: string;
  readonly chargeTotalMinor: bigint;
  readonly alreadyRefundedChargeMinor: bigint;
}): RefundPlan {
  let vendorMinor = 0n;
  let commission = 0n;
  const lines: { orderItemId: string; qty: number }[] = [];

  for (const r of input.returned) {
    const line = input.lines.find((l) => l.orderItemId === r.orderItemId);
    if (!line) throw new InvalidInputError('سطر ليس في هذا الطلب.', { orderItemId: r.orderItemId });
    if (!Number.isInteger(r.qty) || r.qty < 1) throw new InvalidInputError('كمية الإرجاع عدد موجب.');
    const remaining = line.qty - line.refundedQty;
    if (r.qty > remaining) {
      throw new InvalidInputError(`لا يمكن إرجاع ${r.qty} من سطر بقي منه ${remaining}.`);
    }
    vendorMinor += (line.lineTotalMinor * BigInt(r.qty)) / BigInt(line.qty);
    commission += (line.commissionMinor * BigInt(r.qty)) / BigInt(line.qty);
    lines.push({ orderItemId: r.orderItemId, qty: r.qty });
  }

  const charge = toCharge(vendorMinor, input.fxRateSnapshot);
  const ceiling = input.chargeTotalMinor - input.alreadyRefundedChargeMinor;
  return {
    vendorMinor,
    // لا يُردّ أكثر مما بقي من المدفوع — ولو اجتمعت فروق التقريب
    chargeMinor: charge > ceiling ? ceiling : charge,
    commissionReversedMinor: commission,
    lines,
  };
}

/** الاسترداد الكامل: كل ما بقي من المدفوع لهذا الفرعي، بالضبط لا بالتحويل */
export function planFullRefund(input: {
  readonly vendorTotalMinor: bigint;
  readonly commissionMinor: bigint;
  readonly chargeTotalMinor: bigint;
  readonly alreadyRefundedChargeMinor: bigint;
}): Pick<RefundPlan, 'vendorMinor' | 'chargeMinor' | 'commissionReversedMinor'> {
  return {
    vendorMinor: input.vendorTotalMinor,
    chargeMinor: input.chargeTotalMinor - input.alreadyRefundedChargeMinor,
    commissionReversedMinor: input.commissionMinor,
  };
}

/** من عملة البائع إلى عملة الدفع بسعر اللقطة — تقريب واحد */
export function toCharge(vendorMinor: bigint, fxRateSnapshot: string): bigint {
  const rate = Number(fxRateSnapshot);
  if (!Number.isFinite(rate) || rate <= 0) throw new InvalidInputError('سعر صرف اللقطة غير صالح.');
  return BigInt(Math.round(Number(vendorMinor) / rate));
}
