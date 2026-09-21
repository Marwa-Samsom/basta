import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { writeErrorLog } from '../../../common/observability/error-log';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OrderLifecycleService } from './order-lifecycle.service';

const EVERY_FIVE_MINUTES = 300_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * المهام الآلية على الطلبات — الفاعل `system` وحده (ORDER-STATES §1):
 *
 *   · بائع لم يقبل خلال vendor_accept_timeout_hours ← إلغاء واسترداد آلي
 *   · تسليم مضى عليه hold_period_days بلا نزاع مفتوح ولا طلب إرجاع ← مكتمل
 *   · استرداد بقي «معلّقاً» (سقوط بين الالتزام والبوابة) ← يُعاد تنفيذه
 *
 * كل انتقال شرطيّ على الحالة الحالية، فتكرار المهمة أو تزامن نسختين آمن.
 */
@Injectable()
export class OrderScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OrderScheduler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['VITEST'] || process.env['DISABLE_SCHEDULERS'] === 'true') return;
    this.timer = setInterval(() => void this.tick(), EVERY_FIVE_MINUTES);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
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
      take: 100,
    });
    let done = 0;
    for (const s of stale) {
      done += await this.attempt(s.id, () =>
        this.lifecycle.transition(s.id, 'canceled_by_admin', { kind: 'system', userId: null }, {
          reason: `لم يقبله البائع خلال ${hours} ساعة`,
        }),
      );
    }
    return done;
  }

  async completeDelivered(now: Date): Promise<number> {
    const days = await this.setting('hold_period_days', 14);
    const due = await this.prisma.subOrder.findMany({
      where: {
        status: 'delivered',
        deliveredAt: { lt: new Date(now.getTime() - days * DAY) },
        // نزاع مفتوح يجمّد الإكمال ولو انقضت المدة — ADR-007
        disputes: { none: { status: { in: ['open', 'escalated'] } } },
      },
      select: { id: true },
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

  async retryRefunds(now: Date): Promise<number> {
    const pending = await this.prisma.refund.findMany({
      where: { status: 'pending', createdAt: { lt: new Date(now.getTime() - 60_000) } },
      select: { id: true },
      take: 50,
    });
    let done = 0;
    for (const r of pending) if (await this.lifecycle.executeRefund(r.id)) done++;
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

  private async setting(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const v = Number(row?.valueJson);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }
}
