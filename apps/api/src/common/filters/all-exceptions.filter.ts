import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { captureError } from '../observability/sentry';

/**
 * المترجم الوحيد بين أخطاء المجال والاستجابة.
 *
 * قاعدتان:
 *  1. خطأ المجال يصل للمستخدم برسالته العربية — هي مكتوبة له أصلاً.
 *  2. أي خطأ غير متوقّع يُسجَّل كاملاً ويصل للمستخدم مجرّداً: لا مسار ملف
 *     ولا استعلام ولا اسم عمود. رسالة الخطأ ليست مكاناً لكشف البنية.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<{ status: (c: number) => { send: (b: unknown) => void } }>();
    const req = ctx.getRequest<{ url?: string; method?: string; id?: string }>();

    if (exception instanceof DomainError) {
      res.status(exception.httpStatus).send({
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).send(typeof body === 'string' ? { message: body } : body);
      return;
    }

    const requestId = req.id ?? '—';
    this.logger.error(
      `${req.method} ${req.url} [${requestId}]`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    captureError(exception, { url: req.url, method: req.method, requestId });

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'INTERNAL_ERROR',
      // الرقم يربط شكوى المستخدم بالسجل بلا كشف أي تفصيل عن البنية
      message: `حدث خلل غير متوقّع ولم يكتمل طلبك. أعد المحاولة، وإن تكرّر أبلغنا بالرقم ${requestId}.`,
      requestId,
    });
  }
}
