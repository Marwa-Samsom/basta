import { Controller, Get, HttpStatus, InternalServerErrorException, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { isSentryEnabled } from './observability/sentry';
import { Public } from './security/decorators';

/**
 * مفتوح صراحةً: موازن الأحمال ومراقبة الجاهزية لا يحملان رموزاً،
 * وفحص صحة محميّ يعني أن كل نشرة تبدو ميتة للمراقب.
 */
/** قاعدة لا تجيب خلالها تُعدّ ساقطة */
const DB_TIMEOUT_MS = 2_000;

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * الجاهزية: هل يخدم هذا الخادم طلباً الآن؟ 503 حين لا تجيب القاعدة — كان 200 بحالة
   * «degraded» في الجسم، والموازن والمراقبة يقرآن الرمز لا الجسم، فيبقى الخادم في
   * الدوران يردّ 500 على كل طلب. والقاعدة المعلّقة كالساقطة: مهلة ثانيتين لا انتظار.
   */
  @Get()
  async check(@Res({ passthrough: true }) reply: FastifyReply) {
    const started = Date.now();
    let database: 'up' | 'down' = 'down';
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS).unref()),
      ]);
      database = 'up';
    } catch {
      database = 'down';
    }
    if (database === 'down') reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      sentry: isSentryEnabled() ? 'on' : 'off',
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * الحياة: العملية تجيب — لا قاعدة ولا شيء خارجها. لفحص الحاوية (HEALTHCHECK): سقوط
   * القاعدة لا يُصلحه إعادة تشغيل الخادم، فلا يُعاد تشغيله بسببه في حلقة.
   */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * خطأ مقصود لإثبات وصول التنبيه — بند في بوابة خروج المرحلة 03.
   * محجوب في الإنتاج: نقطة تُسقط الطلب عمداً لا مكان لها هناك.
   */
  @Get('boom')
  @ApiExcludeEndpoint()
  boom(): never {
    if (process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException('غير متاح');
    }
    throw new Error('خطأ مقصود للتحقق من وصول التنبيه إلى Sentry');
  }
}
