import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/public';
import { AdminFinanceController, VendorFinanceController } from './api/finance.controllers';
import { VendorReportsController } from './api/vendor-reports.controller';
import { FinanceService } from './application/finance.service';
import { LedgerService } from './application/ledger.service';
import { ReleaseScheduler } from './application/release-scheduler';
import { VendorReportsService } from './application/vendor-reports.service';

/**
 * المال — ADR-005 و ADR-007 و ADR-013. الطبقة الأدنى بعد المخزون: لا تعرف
 * الطلبات ولا الدفع؛ الدفع يستدعي postSale، والطلبات تستدعي الاسترداد، كلٌّ
 * داخل معاملته. تقارير البائع (VD-19) قراءة من الدفتر وحده، لا تكتب فيه.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [VendorFinanceController, VendorReportsController, AdminFinanceController],
  providers: [LedgerService, FinanceService, ReleaseScheduler, VendorReportsService],
  exports: [LedgerService, FinanceService, ReleaseScheduler, VendorReportsService],
})
export class FinanceModule {}
