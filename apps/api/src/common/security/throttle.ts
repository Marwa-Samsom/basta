import { Injectable, SetMetadata } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';

/**
 * تحديد المعدّل — المرحلة 12، OWASP A04/A07.
 *
 * كان حدّاً واحداً عاماً: 100 طلب لكل عنوان في 15 دقيقة. في الإنتاج كل
 * صفحات المتجر تُصيَّر على خادم الواجهة فتصل من **عنوان واحد** — فيشترك
 * الموقع كله في 100 طلب، ولوحة مدير واحد تستنفدها. الحدّ الصارم مكانه
 * مسارات التخمين وحدها (الدخول والتسجيل والتحقق الثنائي — SRS C-01)، والعام
 * واسع يصدّ الإغراق لا الاستعمال.
 */
export const THROTTLE = {
  /** عام: 600 طلب في الدقيقة لكل عنوان */
  defaultLimit: Number(process.env['THROTTLE_DEFAULT_LIMIT'] ?? 600),
  defaultTtl: 60_000,
  /** التخمين: 10 محاولات في 15 دقيقة لكل عنوان — SRS C-01 */
  authLimit: Number(process.env['THROTTLE_AUTH_LIMIT'] ?? 10),
  authTtl: 900_000,
} as const;

const AUTH_LIMITED = 'basta:authLimited';

/** مسار يخضع لحدّ التخمين الصارم — الدخول والتسجيل والتحقق الثنائي */
export const AuthLimited = () => SetMetadata(AUTH_LIMITED, true);

@Injectable()
export class BastaThrottlerGuard extends ThrottlerGuard {
  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    if (props.throttler.name === 'auth') {
      const limited = this.reflector.getAllAndOverride<boolean>(AUTH_LIMITED, [props.context.getHandler(), props.context.getClass()]);
      if (!limited) return true;
    }
    return super.handleRequest(props);
  }
}
