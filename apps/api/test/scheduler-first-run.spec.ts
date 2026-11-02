import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAlertsScheduler } from '../src/modules/admin/application/admin-alerts.scheduler';
import { LowStockNotifier } from '../src/modules/catalog/application/low-stock-notifier';
import { ReleaseScheduler } from '../src/modules/finance/application/release-scheduler';
import { OrderScheduler } from '../src/modules/orders/application/order-scheduler';
import { TrackingService } from '../src/modules/shipping/application/tracking.service';

/**
 * المهام الطويلة تدور أول مرة بعد الإقلاع بقليل لا بعد فترتها كاملة (SYS-024، 2 نوفمبر 2026).
 * كان تحرير الأرصدة أول مرة بعد ساعة من الإقلاع، وإعادة التشغيل قبلها تعيد العدّ: طلب فرعي
 * مستحقّ منذ 6:45 بقي «معلّقاً» حتى الدورة الأولى بعد الإقلاع التالي بساعة.
 */
describe('المهام الدورية الطويلة: دورة أولى بعد الإقلاع', () => {
  const vitest = process.env['VITEST'];
  beforeEach(() => {
    vi.useFakeTimers();
    // المهام تسكت في الاختبارات عمداً — هنا نختبر مؤقّتها نفسه
    delete process.env['VITEST'];
  });
  afterEach(() => {
    process.env['VITEST'] = vitest;
    vi.useRealTimers();
  });

  type Job = { onApplicationBootstrap(): void; onModuleDestroy(): void };
  const none = {} as never;
  const jobs: { name: string; make: () => Job; run: string; every: number }[] = [
    { name: 'تحرير الأرصدة (كل ساعة)', make: () => new ReleaseScheduler(none, none), run: 'tick', every: 3_600_000 },
    { name: 'الطلبات (كل 5 دقائق)', make: () => new OrderScheduler(none, none), run: 'tick', every: 300_000 },
    { name: 'تتبّع الشحن (كل 10 دقائق)', make: () => new TrackingService(none, {} as never, none), run: 'advanceAll', every: 600_000 },
    { name: 'تنبيهات الإدارة (كل 10 دقائق)', make: () => new AdminAlertsScheduler(none, none, none), run: 'tick', every: 600_000 },
    { name: 'نقص المخزون (كل 10 دقائق)', make: () => new LowStockNotifier(none, none, none), run: 'tick', every: 600_000 },
  ];

  for (const job of jobs) {
    it(`${job.name}: أول دورة خلال 15 ثانية من الإقلاع، ثم كل فترتها، وتقف مع الإيقاف`, () => {
      const instance = job.make();
      const run = vi.spyOn(instance as unknown as Record<string, () => Promise<number>>, job.run).mockResolvedValue(0);
      instance.onApplicationBootstrap();

      vi.advanceTimersByTime(15_000);
      expect(run).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(job.every);
      expect(run).toHaveBeenCalledTimes(2);

      instance.onModuleDestroy();
      vi.advanceTimersByTime(job.every * 2);
      expect(run).toHaveBeenCalledTimes(2);
    });
  }
});
