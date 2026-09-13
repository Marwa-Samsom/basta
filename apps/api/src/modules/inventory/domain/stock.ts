/**
 * قواعد المخزون الصافية — ADR-006.
 *
 * لا قاعدة بيانات هنا: الدوال تقرّر، والخدمة تنفّذ القرار داخل معاملة
 * بعد قفل الصفوف. فصلهما يجعل كل قرار قابلاً للاختبار بلا تزامن حقيقي،
 * ويترك للتزامن الحقيقي اختباراً واحداً يثبت القفل نفسه.
 */
import { DomainError, InvalidInputError } from '../../../common/errors/domain-error';

export const MOVEMENT_REASONS = [
  'sale',
  'return',
  'cancel',
  'manual_adjust',
  'import',
  'damage',
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** أكبر كمية في سطر واحد — حدّ منطقي يمنع خطأ إدخال يجمّد مخزون بائع كاملاً. */
export const MAX_LINE_QTY = 10_000;
export const MAX_ON_HAND = 1_000_000;

export interface StockLevel {
  readonly onHand: number;
  readonly reserved: number;
  readonly lowStockThreshold: number;
}

/** المتاح = onHand − reserved. محسوب لا مخزَّن (ERD). */
export const availableOf = (level: Pick<StockLevel, 'onHand' | 'reserved'>): number =>
  Math.max(0, level.onHand - level.reserved);

export class StockBelowReservedError extends DomainError {
  readonly code = 'STOCK_BELOW_RESERVED';
  readonly httpStatus = 409;

  constructor(target: number, reserved: number) {
    super(
      `لا يمكن جعل المخزون ${target} لأن ${reserved} قطعة محجوزة الآن لمشترين في صفحة الدفع. ` +
        `اختر ${reserved} أو أكثر، أو انتظر حتى تنتهي مهلة الحجز (15 دقيقة).`,
      { target, reserved },
    );
  }
}

export interface ReservationLineInput {
  readonly variantId: string;
  readonly qty: number;
  /** اسم يُعرض للمشتري إن نفد — المخزون لا يعرف أسماء المنتجات، فيمرّرها المستدعي */
  readonly label: string;
}

function assertQty(qty: number, field: string, max: number): void {
  if (!Number.isInteger(qty) || qty < 0 || qty > max) {
    throw new InvalidInputError(`${field} يجب أن تكون عدداً صحيحاً بين 0 و ${max}، والمُدخل ${qty}.`, {
      field,
      value: qty,
    });
  }
}

/**
 * يدمج الأسطر المكرّرة للمتغيّر نفسه ويرتّبها بمعرّف المتغيّر تصاعدياً.
 *
 * الترتيب ليس تجميلاً: معاملتان تقفلان المتغيّرين (أ، ب) بترتيبين متعاكسين
 * تتعطّلان تبادلياً. الترتيب الثابت يجعل ذلك مستحيلاً (ADR-006).
 */
export function normalizeReservationLines(
  lines: readonly ReservationLineInput[],
): ReservationLineInput[] {
  if (lines.length === 0) {
    throw new InvalidInputError('لا أسطر للحجز — السلة فارغة.');
  }

  const merged = new Map<string, ReservationLineInput>();
  for (const line of lines) {
    if (line.qty < 1) {
      throw new InvalidInputError(
        `الكمية المطلوبة من «${line.label}» يجب أن تكون 1 أو أكثر، والمُدخل ${line.qty}.`,
        { variantId: line.variantId, qty: line.qty },
      );
    }
    assertQty(line.qty, 'الكمية المطلوبة', MAX_LINE_QTY);
    const prev = merged.get(line.variantId);
    merged.set(line.variantId, prev ? { ...prev, qty: prev.qty + line.qty } : { ...line });
  }

  const result = [...merged.values()].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  );
  for (const line of result) assertQty(line.qty, 'الكمية المطلوبة', MAX_LINE_QTY);
  return result;
}

export type StockChange = { readonly delta: number } | { readonly setTo: number };

export interface AdjustmentPlan {
  /** صفر يعني لا أثر — لا حركة تُكتب (القاعدة ترفض حركة delta = 0) */
  readonly delta: number;
  readonly onHand: number;
}

/**
 * يقرّر أثر تعديل يدوي على صف مقفول.
 *
 * `setTo` هو الجرد الفعلي («عندي 10»)، و `delta` هو الحدث («تلفت قطعتان»).
 * الاثنان يُترجمان إلى delta واحد فيبقى مجموع الحركات = onHand (INV-04).
 */
export function planAdjustment(current: StockLevel, change: StockChange): AdjustmentPlan {
  const target = 'setTo' in change ? change.setTo : current.onHand + change.delta;

  if (!Number.isInteger(target)) {
    throw new InvalidInputError(`الكمية يجب أن تكون عدداً صحيحاً، والناتج ${target}.`);
  }
  if (target < 0) {
    throw new InvalidInputError(
      `التعديل يجعل المخزون ${target}، والمخزون لا يكون سالباً. المتوفّر حالياً ${current.onHand}.`,
      { onHand: current.onHand, target },
    );
  }
  if (target > MAX_ON_HAND) {
    throw new InvalidInputError(`الحد الأعلى للمخزون ${MAX_ON_HAND} قطعة لكل متغيّر.`);
  }
  if (target < current.reserved) {
    throw new StockBelowReservedError(target, current.reserved);
  }

  return { delta: target - current.onHand, onHand: target };
}

export type LowStockTransition = 'entered' | 'left' | 'unchanged';

/**
 * العتبة على onHand لا على المتاح: الحجوزات تتذبذب كل دقيقة، ورصد المتاح
 * يُطلق تنبيهاً ويمسحه مراراً لمشترٍ دخل صفحة الدفع وخرج.
 * العتبة صفر تعني «نبّهني عند النفاد فقط».
 */
export function lowStockTransition(
  onHandAfter: number,
  threshold: number,
  flagged: boolean,
): LowStockTransition {
  const low = onHandAfter <= threshold;
  if (low && !flagged) return 'entered';
  if (!low && flagged) return 'left';
  return 'unchanged';
}

export function assertThreshold(threshold: number): void {
  assertQty(threshold, 'حد تنبيه النفاد', MAX_ON_HAND);
}

export function assertInitialStock(onHand: number): void {
  assertQty(onHand, 'الكمية', MAX_ON_HAND);
}
