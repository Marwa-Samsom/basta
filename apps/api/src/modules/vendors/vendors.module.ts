import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/public';
import { NotificationsModule } from '../notifications/public';
import { AdminVendorBankController, VendorBankController } from './api/vendor-bank.controllers';
import { AdminVendorsController, VendorOnboardingController } from './api/vendors.controllers';
import { VendorBankService } from './application/vendor-bank.service';
import { VendorDirectory } from './application/vendor-directory.service';
import { VendorOnboardingService } from './application/vendor-onboarding.service';
import { VendorReviewService } from './application/vendor-review.service';
import { VendorDocumentStorage } from './infrastructure/document-storage';

@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [VendorOnboardingController, AdminVendorsController, VendorBankController, AdminVendorBankController],
  providers: [VendorDirectory, VendorOnboardingService, VendorReviewService, VendorDocumentStorage, VendorBankService],
  exports: [VendorDirectory],
})
export class VendorsModule {}
