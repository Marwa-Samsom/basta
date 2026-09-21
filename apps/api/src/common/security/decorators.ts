import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Actor, Role } from './actor';

export const IS_PUBLIC = 'basta:public';
export const REQUIRED_ROLES = 'basta:roles';
export const REQUIRED_PERMISSION = 'basta:permission';
export const ALLOW_LIMITED = 'basta:allowLimited';

/** المسار مفتوح بلا مصادقة — يجب أن يكون صريحاً، فالأصل هو الحماية. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

/** يُسمح بالرمز المحدود — لمسار تهيئة 2FA وحده. */
export const AllowLimited = () => SetMetadata(ALLOW_LIMITED, true);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!req.actor) throw new UnauthorizedException('مطلوب تسجيل الدخول.');
  return req.actor;
});

export const OPTIONAL_AUTH = 'basta:optionalAuth';

/**
 * مسار مفتوح للضيف، ويتعرّف على المسجَّل إن أرسل رمزه — السلة وإتمام الشراء.
 * الفاعل يُقرأ بـ `@MaybeActor()` لا `@CurrentActor()`: غيابه حالة طبيعية هنا.
 */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);

export const MaybeActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Actor | null =>
    ctx.switchToHttp().getRequest<{ actor?: Actor }>().actor ?? null,
);
