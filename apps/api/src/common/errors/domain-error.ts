/**
 * أخطاء المجال.
 *
 * قاعدة كتابة الرسالة (DESIGN-SYSTEM §4): ما الذي حدث، ولماذا، وما الخطوة التالية.
 * «حدث خطأ ما» ليست رسالة خطأ — هي اعتراف بأن النظام لا يعرف ما جرى.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    if (details !== undefined) this.details = details;
  }
}

/** ADR-010: مورد بائع آخر يُرجع 404 لا 403 — حتى لا يكشف الرد وجوده أصلاً. */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
}

export class InsufficientStockError extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK';
  readonly httpStatus = 409;

  constructor(productName: string, available: number) {
    super(
      available > 0
        ? `بقي ${available} فقط من «${productName}». قلّل الكمية أو أزل الصنف لمتابعة الشراء.`
        : `نفد «${productName}». يمكنك إتمام باقي الطلب، أو إزالته ومتابعة الشراء.`,
      { productName, available },
    );
  }
}

export class ReservationExpiredError extends DomainError {
  readonly code = 'RESERVATION_EXPIRED';
  readonly httpStatus = 409;

  constructor() {
    super('انتهت مهلة حجز سلّتك. نعيد المحاولة الآن — إن توفّر المخزون يكتمل الطلب.');
  }
}

export class InvalidStateTransitionError extends DomainError {
  readonly code = 'INVALID_STATE_TRANSITION';
  readonly httpStatus = 409;

  constructor(from: string, to: string) {
    super(`الانتقال من «${from}» إلى «${to}» غير مسموح.`, { from, to });
  }
}

export class InsufficientBalanceError extends DomainError {
  readonly code = 'INSUFFICIENT_BALANCE';
  readonly httpStatus = 409;
}

export class BelowMinimumPayoutError extends DomainError {
  readonly code = 'BELOW_MINIMUM_PAYOUT';
  readonly httpStatus = 409;

  constructor(minimumFormatted: string) {
    super(
      `الحد الأدنى للسحب ${minimumFormatted}. رصيدك يتراكم حتى يتجاوزه، ولا يضيع منه شيء.`,
      { minimumFormatted },
    );
  }
}

/** مدخل يخالف قاعدة مجال لا يلتقطها التحقق الشكلي — رسالته تسمّي الحقل وسبيل التصحيح. */
export class InvalidInputError extends DomainError {
  readonly code = 'INVALID_INPUT';
  readonly httpStatus = 400;
}

/** تكرار يرفضه قيد تفرّد: SKU، تركيبة متغيّر، مسار فئة. */
export class DuplicateError extends DomainError {
  readonly code = 'DUPLICATE';
  readonly httpStatus = 409;
}

/**
 * تعارض حالة برسالة خاصة بموضعها.
 * `InvalidStateTransitionError` تصف انتقالاً بين حالتين مسمّاتين؛ وهذه لما
 * يكون السبب أدقّ من ذلك: «قيد المراجعة فلا يقبل التعديل»، «تغيّرت الحالة
 * فحدّث الصفحة»، «العملة مثبَّتة». الرسالة تقول ما العمل، لا ما مُنع فقط.
 */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
  readonly httpStatus = 409;
}

/**
 * فاعل يملك المسار ولا يملك هذا الفعل بعينه — صلاحية لا يحملها هو، أو هدف
 * محميّ منه. 403 لا 404: المورد ظاهر له أصلاً (قائمة المديرين مثلاً).
 */
export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
}
