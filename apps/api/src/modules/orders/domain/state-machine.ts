/**
 * آلة حالات الطلب الفرعي — ORDER-STATES.md §1، مترجمةً حرفياً.
 *
 * **كل انتقال غير مذكور هنا مرفوض على مستوى الخادم.** الواجهة تخفي الزرّ،
 * وهذا الملف يرفض الطلب — الاثنان معاً. الجدول بيانات لا شروط متفرّقة في
 * المتحكّمات: انتقال يُضاف في مكان واحد ويُختبر في مكان واحد.
 */

import { ConflictError, InvalidInputError } from '../../../common/errors/domain-error';

export type SubOrderStatus =
  | 'awaiting_vendor'
  | 'accepted'
  | 'preparing'
  | 'ready_to_ship'
  | 'shipped'
  | 'delivery_failed'
  | 'delivered'
  | 'return_requested'
  | 'returned'
  | 'completed'
  | 'rejected_by_vendor'
  | 'canceled_by_customer'
  | 'canceled_by_admin'
  | 'refunded';

/** من يملك الانتقال. `system` للمهام الآلية وحدها، ولا يمرّ من أي مسار HTTP */
export type TransitionActor = 'vendor' | 'customer' | 'admin' | 'carrier' | 'system';

interface Rule {
  readonly to: SubOrderStatus;
  readonly actors: readonly TransitionActor[];
  readonly requiresReason?: true;
  readonly requiresTracking?: true;
}

const RULES: Readonly<Record<SubOrderStatus, readonly Rule[]>> = Object.freeze({
  awaiting_vendor: [
    { to: 'accepted', actors: ['vendor'] },
    { to: 'rejected_by_vendor', actors: ['vendor'], requiresReason: true },
    { to: 'canceled_by_customer', actors: ['customer'] },
    { to: 'canceled_by_admin', actors: ['admin', 'system'], requiresReason: true },
  ],
  accepted: [
    { to: 'preparing', actors: ['vendor'] },
    { to: 'canceled_by_customer', actors: ['customer'] },
    { to: 'canceled_by_admin', actors: ['admin'], requiresReason: true },
  ],
  // نقطة اللاعودة للمشتري: البائع بدأ التجهيز وتكبّد كلفة
  preparing: [
    { to: 'ready_to_ship', actors: ['vendor'] },
    { to: 'canceled_by_admin', actors: ['admin'], requiresReason: true },
  ],
  ready_to_ship: [
    { to: 'shipped', actors: ['vendor'], requiresTracking: true },
    { to: 'canceled_by_admin', actors: ['admin'], requiresReason: true },
  ],
  shipped: [
    { to: 'delivered', actors: ['vendor', 'carrier', 'admin'] },
    { to: 'delivery_failed', actors: ['vendor', 'carrier'] },
  ],
  delivery_failed: [
    { to: 'shipped', actors: ['vendor', 'carrier'] },
    { to: 'returned', actors: ['vendor', 'admin'] },
  ],
  delivered: [
    { to: 'return_requested', actors: ['customer'] },
    // النظام وحده يكمل: 14 يوماً بلا نزاع — لا يُعلنها بائع ولا مشترٍ
    { to: 'completed', actors: ['system'] },
  ],
  return_requested: [
    { to: 'returned', actors: ['vendor', 'admin'] },
    { to: 'delivered', actors: ['vendor', 'admin'], requiresReason: true },
  ],
  returned: [{ to: 'refunded', actors: ['system', 'admin'] }],
  rejected_by_vendor: [{ to: 'refunded', actors: ['system'] }],
  canceled_by_customer: [{ to: 'refunded', actors: ['system'] }],
  canceled_by_admin: [{ to: 'refunded', actors: ['system'] }],
  completed: [],
  refunded: [],
});

export const STATUS_LABELS: Readonly<Record<SubOrderStatus, string>> = Object.freeze({
  awaiting_vendor: 'بانتظار قبول البائع',
  accepted: 'مقبول',
  preparing: 'قيد التجهيز',
  ready_to_ship: 'جاهز للشحن',
  shipped: 'تم الشحن',
  delivery_failed: 'تعذّر التوصيل',
  delivered: 'تم التسليم',
  return_requested: 'طلب إرجاع',
  returned: 'مُرجَع',
  completed: 'مكتمل',
  rejected_by_vendor: 'رفضه البائع',
  canceled_by_customer: 'ألغاه المشتري',
  canceled_by_admin: 'ألغته الإدارة',
  refunded: 'مُسترَد',
});

export class TransitionRejectedError extends ConflictError {
  constructor(from: SubOrderStatus, to: SubOrderStatus, why: string) {
    super(`لا يمكن نقل الطلب من «${STATUS_LABELS[from]}» إلى «${STATUS_LABELS[to]}»: ${why}`, {
      from,
      to,
    });
    this.name = 'TransitionRejectedError';
  }
}

/**
 * يفحص الانتقال كاملاً قبل أي كتابة: وجوده، وفاعله، وشرطه.
 * الفاعل الخطأ يُرفض كالانتقال المجهول — بائع لا يعلن «سُلّم» لطلب يملكه
 * المشتري، ومشترٍ لا يعلن «شُحن».
 */
export function assertTransition(
  from: SubOrderStatus,
  to: SubOrderStatus,
  actor: TransitionActor,
  input: { reason?: string | null; tracking?: string | null } = {},
): void {
  const rule = RULES[from].find((r) => r.to === to);
  if (!rule) {
    throw new TransitionRejectedError(
      from,
      to,
      RULES[from].length === 0 ? 'حالة نهائية.' : 'انتقال غير مسموح.',
    );
  }
  if (!rule.actors.includes(actor)) {
    throw new TransitionRejectedError(from, to, 'هذا الإجراء لا يخصّ دورك.');
  }
  if (rule.requiresReason && (input.reason?.trim().length ?? 0) < 5) {
    throw new InvalidInputError('السبب مطلوب ويُعرض للطرف الآخر كما يُكتب.');
  }
  if (rule.requiresTracking && (input.tracking?.trim().length ?? 0) < 4) {
    throw new InvalidInputError('رقم التتبّع مطلوب عند الشحن.');
  }
}

/** الانتقالات المتاحة لفاعل من حالة — ما تعرضه الواجهة أزراراً */
export const allowedFor = (from: SubOrderStatus, actor: TransitionActor): SubOrderStatus[] =>
  RULES[from].filter((r) => r.actors.includes(actor)).map((r) => r.to);

export const isCancellation = (s: SubOrderStatus): boolean =>
  s === 'rejected_by_vendor' || s === 'canceled_by_customer' || s === 'canceled_by_admin';

export const isFinal = (s: SubOrderStatus): boolean => RULES[s].length === 0;

// ------------------------------------------------------ حالة الأب — §2

export type ParentStatus = 'processing' | 'partially_completed' | 'completed' | 'canceled' | 'refunded';

/**
 * حالة الأب مشتقّة من أبنائه ولا تُحدَّث يدوياً أبداً. يمنع أشهر خلل في
 * الأسواق: أب يقول «مكتمل» وفيه فرعي عالق منذ أسبوعين.
 */
export function deriveParent(children: readonly SubOrderStatus[]): ParentStatus {
  if (children.length === 0) return 'processing';
  const all = (p: (s: SubOrderStatus) => boolean): boolean => children.every(p);
  if (all((s) => s === 'completed')) return 'completed';
  if (all((s) => s === 'refunded')) return 'refunded';
  if (all((s) => isCancellation(s) || s === 'refunded')) return 'canceled';
  const finished = children.filter((s) => isFinal(s)).length;
  return finished > 0 ? 'partially_completed' : 'processing';
}
