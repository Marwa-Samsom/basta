import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map, type Observable } from 'rxjs';
import { TokenService } from '../application/token.service';
import { refreshCookie } from './session-cookie';

type WithRefresh = { refreshToken?: unknown };

/**
 * كل ردّ يحمل رمز تحديث — الدخول والتدوير وطلب فتح متجر، وأي مسار يُضاف
 * لاحقاً — يُنقل رمزه إلى الكوكي ويُحذف من الجسم. عامّ لا في كل متحكّم: مسار
 * جديد يصدر رموزاً لا يستطيع أن ينسى ذلك فيعيد الرمز إلى متناول السكربت.
 */
@Injectable()
export class SessionCookieInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (!body || typeof body !== 'object') return body;
        const holder = holderOf(body as Record<string, unknown>);
        if (!holder || typeof holder.refreshToken !== 'string') return body;
        reply.header('set-cookie', refreshCookie(holder.refreshToken, TokenService.refreshTtlMs()));
        delete holder.refreshToken;
        return body;
      }),
    );
  }
}

/** الزوج في أعلى الجسم (التدوير) أو تحت `tokens` (الدخول وفتح المتجر) */
function holderOf(body: Record<string, unknown>): WithRefresh | null {
  if ('refreshToken' in body) return body;
  const tokens = body['tokens'];
  return tokens && typeof tokens === 'object' && 'refreshToken' in tokens ? (tokens as WithRefresh) : null;
}
