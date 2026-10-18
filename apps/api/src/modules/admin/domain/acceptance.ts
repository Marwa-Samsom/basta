/**
 * «قاربت مهلة القبول» — قاعدة واحدة تعدّ بها بطاقة اللوحة وتصفّي بها قائمة
 * الطلبات (J-03، 18 أكتوبر 2026): كانت البطاقة تعدّ واحداً وتفتح كل «قيد
 * التنفيذ»، فيضيع الطلب بين المئات.
 */
export const ACCEPTANCE_WARNING_HOURS = 12;

/** فرعي ينتظر البائع وطُلب قبل هذه اللحظة بقي على انقضاء مهلته أقل من 12 ساعة */
export const acceptanceDueSince = (deadlineHours: number, now: Date): Date =>
  new Date(now.getTime() - Math.max(0, deadlineHours - ACCEPTANCE_WARNING_HOURS) * 3_600_000);

/** موعد الإلغاء الآلي لفرعي ينتظر البائع — مهمة الطلبات تلغيه بعده */
export const acceptBy = (placedAt: Date, deadlineHours: number): Date => new Date(placedAt.getTime() + deadlineHours * 3_600_000);
