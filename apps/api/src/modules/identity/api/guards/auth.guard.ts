import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Actor, Role } from '../../../../common/security/actor';
import { TokenService } from '../../application/token.service';
import {
  ALLOW_LIMITED,
  IS_PUBLIC,
  REQUIRED_PERMISSION,
  REQUIRED_ROLES,
} from '../../../../common/security/decorators';

/**
 * حارس واحد يفصل في الأربعة معاً: المصادقة، الرمز المحدود، الدور، الصلاحية.
 *
 * جمعها في حارس واحد مقصود: حرّاس متسلسلة تُرتَّب خطأً فيمرّ طلب بلا فحص
 * — وهو عطل صامت. الترتيب هنا مثبَّت في الكود لا في تركيب المزخرفات.
 *
 * الأصل الحماية: مسار بلا @Public يتطلّب رمزاً، فنسيان الحارس لا يفتح باباً.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      actor?: Actor;
    }>();

    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('مطلوب تسجيل الدخول.');
    }

    const claims = await this.tokens.verifyAccess(header.slice(7));

    // 1 · الرمز المحدود لا يفتح إلا ما سُمح له صراحةً
    const allowLimited = this.reflector.getAllAndOverride<boolean>(ALLOW_LIMITED, targets);
    if (claims.limited && !allowLimited) {
      throw new ForbiddenException(
        'فعّل التحقق الثنائي أولاً — إلزامي على الحسابات الإدارية قبل أي إجراء.',
      );
    }

    const actor: Actor = {
      userId: claims.sub,
      roles: claims.roles as Role[],
      permissions: claims.permissions,
      ...(claims.vendorId ? { vendorId: claims.vendorId } : {}),
    };
    req.actor = actor;

    // 2 · الدور
    const roles = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, targets);
    if (roles?.length && !roles.some((r) => actor.roles.includes(r))) {
      throw new ForbiddenException('هذا المسار لا يخصّ حسابك.');
    }

    // 3 · الصلاحية — إدارية حصراً، ولا تُمنح لغير الإداري ولو حملها بالاسم
    const permission = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION, targets);
    if (permission) {
      const allowed = actor.roles.includes('admin') && actor.permissions.includes(permission);
      if (!allowed) {
        throw new ForbiddenException(`تحتاج صلاحية «${permission}» لهذا الإجراء.`);
      }
    }

    return true;
  }
}
