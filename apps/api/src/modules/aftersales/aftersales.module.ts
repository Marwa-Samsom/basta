import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/public';
import {
  AdminDisputesController,
  CustomerDisputesController,
  ReviewsController,
  VendorDisputesController,
} from './api/aftersales.controllers';
import { DisputesService } from './application/disputes.service';
import { ReviewsService } from './application/reviews.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CustomerDisputesController, VendorDisputesController, AdminDisputesController, ReviewsController],
  providers: [DisputesService, ReviewsService],
  exports: [DisputesService, ReviewsService],
})
export class AftersalesModule {}
