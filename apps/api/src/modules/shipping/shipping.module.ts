import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/public';
import {
  AdminShippingController,
  TrackingController,
  VendorShippingController,
} from './api/shipping.controllers';
import { TrackingService } from './application/tracking.service';
import { FakeCarrier } from './infrastructure/fake-carrier';

@Module({
  imports: [OrdersModule],
  controllers: [VendorShippingController, TrackingController, AdminShippingController],
  providers: [TrackingService, FakeCarrier],
  exports: [TrackingService],
})
export class ShippingModule {}
