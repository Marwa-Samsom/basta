import { Prisma } from '@prisma/client';
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
import { writeErrorLog } from '../observability/error-log';

/** جسم طلب لم يُقرأ — بحالة Fastify نفسها (400 أو 413 أو 415)، والافتراضي لما سوى الأخيرتين */
const UNREADABLE_BODY = {
  code: 'INVALID_INPUT',
  message: 'تعذّرت قراءة الطلب: صيغته غير صحيحة أو فيه حقول ممنوعة. راجعه وأعد المحاولة.',
};
const UNREADABLE: Record<number, { code: string; message: string }> = {
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'الطلب أكبر من الحدّ المسموح. صغّر ما ترسله وأعد المحاولة.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'صيغة الطلب غير مدعومة. أرسله بصيغة JSON.' },
};

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
    const reply = ctx.getResponse<{ status: (c: number) => { header: (k: string, v: string) => { send: (b: unknown) => void } } }>();
    /**
     * الخطأ JSON دائماً، ولو كان المسار يعلن نوعاً آخر: @Header('content-type', 'text/csv')
     * يُضبط قبل المعالج، فكان خطأ مسار تصدير (فترة مرفوضة مثلاً) يُرسَل كائناً بنوع
     * CSV فيرفضه Fastify — ويصل 500 بدل الرسالة.
     */
    const res = { status: (c: number) => ({ send: (b: unknown) => reply.status(c).header('content-type', 'application/json; charset=utf-8').send(b) }) };
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
      /**
       * خطأ من Fastify قبل أن يبلغ الطلب مساره، في قراءة الجسم: JSON مكسور، أو مفتاح
       * __proto__ أو constructor (حماية تلويث النموذج الأصلي)، أو جسم فارغ أو أكبر من
       * الحدّ. Nest يلفّه HttpException الأصل نفسه بنصّ Fastify الإنجليزي
       * (mapExternalException). يصل برمز ورسالة عربية كبقية أخطاء المدخلات —
       * و«Body is not valid JSON» لجسم صحيح فيه مفتاح محظور كان يضلّل أيضاً.
       *
       * الأصل وحده لا الصنف المشتق: ThrottlerException بنصّ خام أيضاً، ورسالته عربية
       * مكتوبة للمستخدم (throttle.ts) — كانت «محاولات كثيرة… انتظر 15 دقيقة» تصير
       * «تعذّرت قراءة الطلب» في صفحة الدخول.
       */
      if (typeof body === 'string' && exception.constructor === HttpException) {
        this.logger.warn(`${req.method} ${req.url} [${req.id ?? '—'}] ${status} ${body}`);
        res.status(status).send(UNREADABLE[status] ?? UNREADABLE_BODY);
        return;
      }
      res.status(status).send(typeof body === 'string' ? { message: body } : body);
      return;
    }

    /**
     * شبكة أخيرة لمدخل لم يُفحص قبل القاعدة: قيمة مكرّرة لعمود فريد (P2002)، وقيمة لا
     * تناسب نوع عمودها كمعرّف غير صالح (P2023). كلاهما من الطلب لا من الخادم — 409 و 400
     * برسالة، لا «خلل غير متوقّع». يُسجَّل تحذيراً ليُفحص المدخل في مكانه.
     */
    if (exception instanceof Prisma.PrismaClientKnownRequestError && (exception.code === 'P2002' || exception.code === 'P2023')) {
      this.logger.warn(`${req.method} ${req.url} [${req.id ?? '—'}] ${exception.code} ${exception.message.split('\n').pop() ?? ''}`);
      const conflict = exception.code === 'P2002';
      res.status(conflict ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST).send({
        code: conflict ? 'CONFLICT' : 'INVALID_INPUT',
        message: conflict ? 'القيمة مستعملة من قبل. غيّرها وأعد المحاولة.' : 'قيمة غير صالحة في الطلب. راجع المدخلات وأعد المحاولة.',
      });
      return;
    }

    const requestId = req.id ?? '—';
    const err = exception instanceof Error ? exception : new Error(String(exception));

    this.logger.error(`${req.method} ${req.url} [${requestId}]`, err.stack);

    /**
     * مسلكان متوازيان لا بديلان:
     * السجل الدائم يعمل دائماً ويضمن ألّا يمرّ خطأ صامتاً بلا استضافة،
     * و Sentry يضيف التنبيه الفوري متى توفّر مفتاحه.
     */
    writeErrorLog({
      timestamp: new Date().toISOString(),
      requestId,
      level: 'error',
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
      ...(req.method ? { method: req.method } : {}),
      ...(req.url ? { url: req.url } : {}),
    });
    captureError(exception, { url: req.url, method: req.method, requestId });

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'INTERNAL_ERROR',
      // الرقم يربط شكوى المستخدم بالسجل بلا كشف أي تفصيل عن البنية
      message: `حدث خلل غير متوقّع ولم يكتمل طلبك. أعد المحاولة، وإن تكرّر أبلغنا بالرقم ${requestId}.`,
      requestId,
    });
  }
}
