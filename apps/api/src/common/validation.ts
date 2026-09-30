import { ValidateBy } from 'class-validator';
import { InvalidInputError } from './errors/domain-error';

/**
 * يوم موجود فعلاً بصيغة YYYY-MM-DD. الصيغة وحدها تقبل 2026-13-01، و JavaScript
 * يجعله Invalid Date فيصل Prisma ويرمي — 500 لخطأ في مدخل المستخدم. والتقويم
 * يُفحص بالذهاب والإياب: 2026-02-30 يصير 2026-03-02 فلا يطابق ما كُتب.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const DATE_MESSAGE = 'التاريخ بصيغة YYYY-MM-DD ويوم موجود في التقويم.';

/** للـ DTO: حقل تاريخ يوماً حقيقياً */
export const IsCalendarDate = (): PropertyDecorator =>
  ValidateBy({
    name: 'isCalendarDate',
    validator: { validate: (v: unknown) => typeof v === 'string' && isCalendarDate(v), defaultMessage: () => DATE_MESSAGE },
  });

/** للمعاملات المقروءة واحداً واحداً (@Query('x')): يوم حقيقي أو 400 */
export function assertCalendarDate(value: string): void {
  if (!isCalendarDate(value)) throw new InvalidInputError(DATE_MESSAGE, { value });
}

/**
 * قيمة من قائمة معروفة أو 400 — لمرشّح حالة يصل Prisma كما هو. قيمة خارج التعداد
 * كانت ترمي في Prisma فتصير 500.
 */
export function assertOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new InvalidInputError(`${label} غير معروفة: ${value}.`, { allowed });
  }
  return value as T;
}
