import { Controller, Get, InternalServerErrorException } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { isSentryEnabled } from './observability/sentry';
import { Public } from './security/decorators';

/**
 * مفتوح صراحةً: موازن الأحمال ومراقبة الجاهزية لا يحملان رموزاً،
 * وفحص صحة محميّ يعني أن كل نشرة تبدو ميتة للمراقب.
 */
@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const started = Date.now();
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      sentry: isSentryEnabled() ? 'on' : 'off',
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
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
