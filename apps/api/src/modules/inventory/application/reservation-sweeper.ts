import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { writeErrorLog } from '../../../common/observability/error-log';
import { EXPIRE_BATCH, InventoryService } from './inventory.service';

const EVERY_MINUTE = 60_000;

/**
 * تحرير الحجوزات المنتهية كل دقيقة — S-03، المهمة الحرجة الأولى في MODULES.md.
 *
 * مؤقّت داخل العملية لا طابور: Redis غير متاح على هذا الجهاز (المرحلة 03)،
 * و BullMQ يحلّ محلّه متى توفّر. المهمة عديمة الأثر عند التكرار، فتشغيلها من
 * نسختين في اللحظة نفسها لا يُنقص المحجوز مرتين.
 *
 * الفشل لا يوقف المؤقّت ولا يمرّ صامتاً: يُكتب في logs/errors.jsonl.
 */
@Injectable()
export class ReservationSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ReservationSweeper');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly inventory: InventoryService) {}

  onApplicationBootstrap(): void {
    // الاختبارات تستدعي tick() صراحةً بوقت محدَّد — مؤقّت حقيقي يجعلها غير حتمية
    if (process.env['VITEST'] || process.env['DISABLE_SCHEDULERS'] === 'true') return;
    this.timer = setInterval(() => void this.tick(), EVERY_MINUTE);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      let total = 0;
      let batch: number;
      do {
        batch = await this.inventory.expireDue(now);
        total += batch;
      } while (batch === EXPIRE_BATCH);

      if (total > 0) this.logger.log(`حُرّر ${total} حجزاً منتهياً`);
      return total;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`تعذّر تحرير الحجوزات المنتهية: ${e.message}`, e.stack);
      writeErrorLog({
        timestamp: new Date().toISOString(),
        requestId: 'scheduler:reservation-sweeper',
        level: 'error',
        message: e.message,
        ...(e.stack ? { stack: e.stack } : {}),
      });
      return 0;
    } finally {
      this.running = false;
    }
  }
}
