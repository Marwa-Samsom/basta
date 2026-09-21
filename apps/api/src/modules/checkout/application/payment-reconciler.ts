import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { writeErrorLog } from '../../../common/observability/error-log';
import { CheckoutService } from './checkout.service';

const EVERY_MINUTE = 60_000;

/**
 * مصالحة الدفعات المعلّقة كل دقيقة — بوابة 08 البند الرابع.
 *
 * انقطاع الاتصال أثناء الدفع يترك طلباً «لا نعرف»: قد يكون المال خُصم. المهمة
 * تسأل البوابة عن كل معلّق أقدم من دقيقة وتحسمه. مؤقّت داخل العملية الآن،
 * وينتقل إلى pg-boss مع باقي المهام (ADR-014). عديمة الأثر عند التكرار:
 * كل انتقال شرطيّ على pending_payment.
 */
@Injectable()
export class PaymentReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PaymentReconciler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly checkout: CheckoutService) {}

  onApplicationBootstrap(): void {
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
      return await this.checkout.reconcilePending(now);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`فشلت مصالحة الدفعات: ${e.message}`, e.stack);
      writeErrorLog({
        timestamp: new Date().toISOString(),
        requestId: 'scheduler:payment-reconciler',
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
