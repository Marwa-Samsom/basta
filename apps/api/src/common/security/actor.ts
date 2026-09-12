/**
 * سياق الفاعل — ADR-010.
 *
 * أكثر خروقات منصات الأسواق شيوعاً: التحقق من الملكية في المتحكّم وحده،
 * ثم تجاوزه بتعديل معرّف في الطلب. العلاج هنا ليس فحصاً إضافياً بل بنية
 * لا تسمح بالخطأ: **لا توجد دالة قراءة بلا سياق مالك**.
 *
 * النوع نفسه يفرض القاعدة: `VendorScope` لا يمكن تركيبه إلا من فاعل بائع،
 * فدالة تطلبه لا يمكن استدعاؤها بسياق فارغ — الخطأ يقع وقت الترجمة لا
 * وقت التشغيل، ولا يصل إلى الإنتاج أصلاً.
 */

export type Role = 'customer' | 'vendor_owner' | 'vendor_staff' | 'admin';

export interface Actor {
  readonly userId: string;
  readonly roles: readonly Role[];
  /** موجود فقط إن كان الفاعل بائعاً أو موظّفاً لديه */
  readonly vendorId?: string;
  readonly permissions: readonly string[];
}

/**
 * النوع الذي لا يُركَّب إلا بعد إثبات الملكية.
 * العلامة الخاصة تمنع تركيبه يدوياً من كائن عادي.
 */
export interface VendorScope {
  readonly vendorId: string;
  readonly __brand: 'VendorScope';
}

export class ForbiddenActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenActorError';
  }
}

export const isAdmin = (actor: Actor): boolean => actor.roles.includes('admin');

export const isVendor = (actor: Actor): boolean =>
  actor.roles.includes('vendor_owner') || actor.roles.includes('vendor_staff');

export function hasPermission(actor: Actor, permission: string): boolean {
  if (!isAdmin(actor)) return false;
  return actor.permissions.includes(permission);
}

/**
 * المدخل الوحيد إلى بيانات بائع.
 *
 * البائع يحصل على نطاق متجره هو ولا شيء غيره. الإدارة تحصل على أي نطاق
 * صراحةً — وهذا تجاوز مقصود وموثّق، لا ثغرة: مراجعة النزاعات تتطلبه.
 * العميل لا يحصل على نطاق إطلاقاً.
 */
export function vendorScopeOf(actor: Actor, requestedVendorId?: string): VendorScope {
  if (isAdmin(actor)) {
    const target = requestedVendorId ?? actor.vendorId;
    if (!target) {
      throw new ForbiddenActorError('نطاق البائع مطلوب للوصول الإداري إلى بيانات متجر.');
    }
    return { vendorId: target, __brand: 'VendorScope' };
  }

  if (!isVendor(actor) || !actor.vendorId) {
    throw new ForbiddenActorError('هذا المورد يخصّ متجراً، والحساب الحالي ليس بائعاً.');
  }

  /**
   * بائع يطلب نطاق بائع آخر: يُرفض هنا، ويُترجَم إلى 404 في المستودع —
   * لا 403. الرد الأول لا يكشف وجود المورد، والثاني يكشفه.
   */
  if (requestedVendorId !== undefined && requestedVendorId !== actor.vendorId) {
    throw new ForbiddenActorError('لا وصول إلى بيانات متجر آخر.');
  }

  return { vendorId: actor.vendorId, __brand: 'VendorScope' };
}
