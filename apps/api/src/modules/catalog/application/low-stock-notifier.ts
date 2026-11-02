import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { writeErrorLog } from '../../../common/observability/error-log';
import { everyAfterBoot } from '../../../common/periodic';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { InventoryService, availableOf } from '../../inventory/public';
import { NotificationsService } from '../../notifications/public';

const EVERY_TEN_MINUTES = 600_000;
/** أطول قائمة تُكتب في التنبيه — الباقي في صفحة المخزون */
const MAX_LISTED = 5;

/**
 * تنبيه البائع بنفاد المخزون — SRS V-04.
 *
 * المخزون يرصد لحظة النزول إلى العتبة ولا يرسل (لا يعرف البائع ولا المنتج).
 * هنا يُجمع المعلَّق لكل بائع في تنبيه **واحد**: بيعُ خمسة مقاسات في طلب
 * واحد لا يصير خمسة رسائل. والحجز والإدراج في معاملة واحدة — فإمّا حُجز
 * الصفّ وأُدرج تنبيهه، وإمّا لا هذا ولا ذاك.
 *
 * المنتج غير المنشور يُحجز بلا تنبيه: مسوّدة بمخزون صفر ليست خبراً، وتركها
 * معلَّقة يجعلها تتصدّر كل جولة فتحجب ما بعدها.
 */
@Injectable()
export class LowStockNotifier implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('LowStockNotifier');
  private stop: (() => void) | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['VITEST'] || process.env['DISABLE_SCHEDULERS'] === 'true') return;
    this.stop = everyAfterBoot(() => void this.tick(), EVERY_TEN_MINUTES);
  }

  onModuleDestroy(): void {
    this.stop?.();
  }

  async tick(): Promise<{ alerts: number; silenced: number }> {
    if (this.running) return { alerts: 0, silenced: 0 };
    this.running = true;
    try {
      return await this.run();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`فشل تنبيه نفاد المخزون: ${e.message}`, e.stack);
      writeErrorLog({
        timestamp: new Date().toISOString(),
        requestId: 'scheduler:low-stock',
        level: 'error',
        message: e.message,
        ...(e.stack ? { stack: e.stack } : {}),
      });
      return { alerts: 0, silenced: 0 };
    } finally {
      this.running = false;
    }
  }

  /** جولة واحدة بلا حارس التكرار — الاختبار يشغّل جولتين متزامنتين عليها */
  async run(): Promise<{ alerts: number; silenced: number }> {
    const pending = await this.inventory.pendingLowStock();
    if (pending.length === 0) return { alerts: 0, silenced: 0 };

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: pending.map((p) => p.variantId) } },
      select: {
        id: true,
        sku: true,
        vendorId: true,
        isActive: true,
        archivedAt: true,
        product: { select: { nameAr: true, status: true, deletedAt: true } },
      },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));

    const silenced: string[] = [];
    const perVendor = new Map<string, { variantId: string; line: string }[]>();
    for (const level of pending) {
      const v = byId.get(level.variantId);
      const onSale =
        v && v.isActive && !v.archivedAt && !v.product.deletedAt && v.product.status === 'active';
      if (!onSale) {
        silenced.push(level.variantId);
        continue;
      }
      const available = availableOf(level);
      const line = `${v.product.nameAr} (${v.sku}): ${available > 0 ? `بقي ${available}` : 'نفد'}`;
      perVendor.set(v.vendorId, [...(perVendor.get(v.vendorId) ?? []), { variantId: v.id, line }]);
    }

    if (silenced.length > 0) await this.inventory.claimLowStockAlerts(silenced);

    let alerts = 0;
    for (const [vendorId, rows] of perVendor) {
      alerts += await this.prisma.$transaction(async (tx) => {
        const claimed = new Set(await this.inventory.claimLowStockAlerts(rows.map((r) => r.variantId), tx));
        // ما حجزته جولة أخرى يخرج من القائمة — لا تنبيه مكرّر ولا سطر مكرّر
        const lines = rows.filter((r) => claimed.has(r.variantId)).map((r) => r.line);
        if (lines.length === 0) return 0;
        const items =
          lines.length > MAX_LISTED
            ? `${lines.slice(0, MAX_LISTED).join('، ')}، وغيرها في صفحة المخزون`
            : lines.join('، ');
        await this.notifications.enqueueVendor(
          { code: 'low_stock', vendorId, vars: { items, link: '/vendor/inventory' } },
          tx,
        );
        return 1;
      });
    }
    return { alerts, silenced: silenced.length };
  }
}
