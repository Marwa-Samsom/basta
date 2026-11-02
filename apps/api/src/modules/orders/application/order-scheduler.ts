import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { hoursAr } from '../../../common/arabic-count';
import { writeErrorLog } from '../../../common/observability/error-log';
import { everyAfterBoot } from '../../../common/periodic';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { settingNumber } from '../domain/setting-value';
import { OrderLifecycleService, stalledRefund } from './order-lifecycle.service';

const EVERY_FIVE_MINUTES = 300_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * المهام الآلية على الطلبات — الفاعل `system` وحده (ORDER-STATES §1):
 *
 *   · بائع لم يقبل خلال vendor_accept_timeout_hours ← إلغاء واسترداد آلي
 *   · تسليم بلغ موعده المحفوظ (holdReleaseAt) بلا نزاع مفتوح ← مكتمل
 *   · استرداد بقي «معلّقاً» (سقوط بين الالتزام والبوابة) ← يُعاد تنفيذه
 *
 * كل انتقال شرطيّ على الحالة الحالية، فتكرار المهمة أو تزامن نسختين آمن.
 */
@Injectable()
export class OrderScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OrderScheduler');
  private stop: (() => void) | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['VITEST'] || process.env['DISABLE_SCHEDULERS'] === 'true') return;
    this.stop = everyAfterBoot(() => void this.tick(), EVERY_FIVE_MINUTES);
  }

  onModuleDestroy(): void {
    this.stop?.();
  }

  async tick(now: Date = new Date()): Promise<{ canceled: number; completed: number; refunds: number }> {
    if (this.running) return { canceled: 0, completed: 0, refunds: 0 };
    this.running = true;
    try {
      return {
        canceled: await this.cancelUnaccepted(now),
        completed: await this.completeDelivered(now),
        refunds: await this.retryRefunds(now),
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`فشلت مهام الطلبات: ${e.message}`, e.stack);
      writeErrorLog({
        timestamp: new Date().toISOString(),
        requestId: 'scheduler:orders',
        level: 'error',
        message: e.message,
        ...(e.stack ? { stack: e.stack } : {}),
      });
      return { canceled: 0, completed: 0, refunds: 0 };
    } finally {
      this.running = false;
    }
  }

  async cancelUnaccepted(now: Date): Promise<number> {
    const hours = await this.setting('vendor_accept_timeout_hours', 48);
    const stale = await this.prisma.subOrder.findMany({
      where: { status: 'awaiting_vendor', placedAt: { lt: new Date(now.getTime() - hours * HOUR) } },
      select: { id: true },
      // الأقدم أولاً: بلا ترتيب قد يعود الصفّ المتعثّر أولاً في كل دورة فيحجب ما بعده
      orderBy: { placedAt: 'asc' },
      take: 100,
    });
    let done = 0;
    for (const s of stale) {
      done += await this.attempt(s.id, () =>
        this.lifecycle.transition(s.id, 'canceled_by_admin', { kind: 'system', userId: null }, {
          reason: `لم يقبله البائع خلال ${hoursAr(hours)}`,
        }),
      );
    }
    return done;
  }

  /**
   * الإكمال على موعد التسليم المحفوظ (holdReleaseAt) كتحرير المال — لا على الإعداد الحالي.
   * كان «التسليم + hold_period_days اليوم»: رفع الفترة بعد التسليم يُبقي الطلب مفتوحاً
   * للنزاع أياماً بعد أن تحرّر ماله، وخفضها يُكمله قبل موعده (ACFG-025، 24 أكتوبر 2026).
   */
  async completeDelivered(now: Date): Promise<number> {
    const days = await this.setting('hold_period_days', 14, 0);
    const due = await this.prisma.subOrder.findMany({
      where: {
        status: 'delivered',
        OR: [
          { holdReleaseAt: { lte: now } },
          // تسليم سبق حفظ الموعد مع الطلب — يبقى على الحساب القديم
          { holdReleaseAt: null, deliveredAt: { lt: new Date(now.getTime() - days * DAY) } },
        ],
        // نزاع مفتوح يجمّد الإكمال ولو انقضت المدة — ADR-007
        disputes: { none: { status: { in: ['open', 'escalated'] } } },
      },
      select: { id: true },
      orderBy: { deliveredAt: 'asc' },
      take: 100,
    });
    let done = 0;
    for (const s of due) {
      done += await this.attempt(s.id, () =>
        this.lifecycle.transition(s.id, 'completed', { kind: 'system', userId: null }),
      );
    }
    return done;
  }

  /**
   * المعلّق أقدم من دقيقة، والعالق في processing بعد مهلة التنفيذ — سقط منفّذه
   * بين الحجز والتسجيل، وكان يبقى هناك إلى الأبد. الإعادة آمنة: مفتاح البوابة
   * ثابت للاسترداد فلا يُردّ مرتين.
   */
  async retryRefunds(now: Date): Promise<number> {
    const due = await this.prisma.refund.findMany({
      where: {
        OR: [{ status: 'pending', createdAt: { lt: new Date(now.getTime() - 60_000) } }, stalledRefund(now)],
      },
      select: { id: true },
      take: 50,
    });
    let done = 0;
    for (const r of due) if (await this.lifecycle.executeRefund(r.id, now)) done++;
    return done;
  }

  private async attempt(id: string, fn: () => Promise<void>): Promise<number> {
    try {
      await fn();
      return 1;
    } catch (err) {
      // الحالة تغيّرت بين القراءة والكتابة (قبِل البائع للتوّ): ليس خطأً
      this.logger.warn(`تخطّي ${id}: ${(err as Error).message}`);
      return 0;
    }
  }

  /** الإعداد بحدّه الأدنى في شاشة الإعدادات — التعليق يقبل الصفر، ومهلة القبول لا (VOPS-072) */
  private async setting(key: string, fallback: number, min = 1): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return settingNumber(row?.valueJson, fallback, min);
  }
}
