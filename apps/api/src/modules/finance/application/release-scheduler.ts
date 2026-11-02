import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { writeErrorLog } from '../../../common/observability/error-log';
import { everyAfterBoot } from '../../../common/periodic';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LedgerService } from './ledger.service';

const HOURLY = 3_600_000;

/**
 * تحرير الرصيد — ADR-007. الشرط مركّب:
 *   انقضت فترة التعليق من التسليم (holdReleaseAt)
 *   **و** لا نزاع مفتوح ولا إرجاع قيد المعالجة
 *   **و** لم يُحرَّر من قبل (والفهرس الفريد يحرس ذلك في القاعدة)
 * كل فرعي في معاملته: فشل واحد لا يوقف الباقي.
 */
@Injectable()
export class ReleaseScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ReleaseScheduler');
  private stop: (() => void) | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['VITEST'] || process.env['DISABLE_SCHEDULERS'] === 'true') return;
    this.stop = everyAfterBoot(() => void this.tick(), HOURLY);
  }

  onModuleDestroy(): void {
    this.stop?.();
  }

  async tick(now: Date = new Date(), batch = 500): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.subOrder.findMany({
        where: {
          holdReleaseAt: { lte: now },
          // ما حُسم لا يعود — ولو لم يُنقل منه شيء (مسترَدّ كله)
          holdSettledAt: null,
          status: { in: ['delivered', 'completed', 'refunded'] },
          disputes: { none: { status: { in: ['open', 'escalated'] } } },
          returns: { none: { status: 'requested' } },
          ledgerEntries: { some: { entryType: 'sale_credit' }, none: { entryType: 'hold_release_out' } },
        },
        select: { id: true },
        orderBy: { holdReleaseAt: 'asc' },
        take: batch,
      });
      let n = 0;
      for (const s of due) {
        try {
          const moved = await this.prisma.$transaction((tx) => this.ledger.release(tx, s.id));
          if (moved > 0n) n++;
        } catch (err) {
          this.logger.warn(`تخطّي تحرير ${s.id}: ${(err as Error).message}`);
        }
      }
      return n;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`فشل تحرير الأرصدة: ${e.message}`, e.stack);
      writeErrorLog({
        timestamp: new Date().toISOString(),
        requestId: 'scheduler:release',
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
