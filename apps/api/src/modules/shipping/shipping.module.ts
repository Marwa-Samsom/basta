import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/public';
import {
  AdminShippingController,
  TrackingController,
  VendorShippingController,
} from './api/shipping.controllers';
import { VendorShippingZonesController } from './api/zones.controller';
import { TrackingService } from './application/tracking.service';
import { ShippingZonesService } from './application/zones.service';
import { FakeCarrier } from './infrastructure/fake-carrier';

@Module({
  imports: [OrdersModule],
  controllers: [VendorShippingController, VendorShippingZonesController, TrackingController, AdminShippingController],
  providers: [TrackingService, ShippingZonesService, FakeCarrier],
  exports: [TrackingService, ShippingZonesService],
})
export class ShippingModule {}
