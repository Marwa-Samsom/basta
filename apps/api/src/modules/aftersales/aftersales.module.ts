import { Module } from '@nestjs/common';
import {
  AdminDisputesController,
  CustomerDisputesController,
  ReviewsController,
  VendorDisputesController,
} from './api/aftersales.controllers';
import { DisputesService } from './application/disputes.service';
import { ReviewsService } from './application/reviews.service';

@Module({
  controllers: [CustomerDisputesController, VendorDisputesController, AdminDisputesController, ReviewsController],
  providers: [DisputesService, ReviewsService],
  exports: [DisputesService, ReviewsService],
})
export class AftersalesModule {}
