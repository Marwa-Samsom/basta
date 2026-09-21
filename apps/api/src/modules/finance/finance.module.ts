import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/public';
import { AdminFinanceController, VendorFinanceController } from './api/finance.controllers';
import { FinanceService } from './application/finance.service';
import { LedgerService } from './application/ledger.service';
import { ReleaseScheduler } from './application/release-scheduler';

/**
 * المال — ADR-005 و ADR-007 و ADR-013. الطبقة الأدنى بعد المخزون: لا تعرف
 * الطلبات ولا الدفع؛ الدفع يستدعي postSale، والطلبات تستدعي الاسترداد، كلٌّ
 * داخل معاملته.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [VendorFinanceController, AdminFinanceController],
  providers: [LedgerService, FinanceService, ReleaseScheduler],
  exports: [LedgerService, FinanceService, ReleaseScheduler],
})
export class FinanceModule {}
