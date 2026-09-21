import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/public';
import { NotificationsModule } from '../notifications/public';
import { AdminVendorsController, VendorOnboardingController } from './api/vendors.controllers';
import { VendorDirectory } from './application/vendor-directory.service';
import { VendorOnboardingService } from './application/vendor-onboarding.service';
import { VendorReviewService } from './application/vendor-review.service';
import { VendorDocumentStorage } from './infrastructure/document-storage';

@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [VendorOnboardingController, AdminVendorsController],
  providers: [VendorDirectory, VendorOnboardingService, VendorReviewService, VendorDocumentStorage],
  exports: [VendorDirectory],
})
export class VendorsModule {}
