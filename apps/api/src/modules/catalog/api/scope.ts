import { ForbiddenException, NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import {
  ForbiddenActorError,
  vendorScopeOf,
  type Actor,
  type VendorScope,
} from '../../../common/security/actor';

/**
 * ForbiddenActorError خطأ عادي لا خطأ مجال — بلا ترجمة يصل للمستخدم 500.
 * حساب بدور بائع بلا متجر مرتبط حالة حقيقية قبل اكتمال التسجيل (المرحلة 06).
 */
export function scopeOf(actor: Actor): VendorScope {
  try {
    return vendorScopeOf(actor);
  } catch (err) {
    if (err instanceof ForbiddenActorError) throw new ForbiddenException(err.message);
    throw err;
  }
}

/** معرّف غير صالح يُعامل كغير موجود — 404 لا 400، فلا يكشف الرد شكل المعرّفات */
export const uuidParam = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('المورد غير موجود.'),
});
