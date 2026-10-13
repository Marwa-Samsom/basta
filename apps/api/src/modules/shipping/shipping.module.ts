import { Module } from '@nestjs/common';
import { loadEnv } from '../../common/config/env';
import { OrdersModule } from '../orders/public';
import {
  AdminShippingController,
  TrackingController,
  VendorShippingController,
} from './api/shipping.controllers';
import { VendorShippingZonesController } from './api/zones.controller';
import { TrackingService } from './application/tracking.service';
import { ShippingZonesService } from './application/zones.service';
import { CARRIER, type CarrierProvider } from './domain/carrier';
import { FakeCarrier } from './infrastructure/fake-carrier';

@Module({
  imports: [OrdersModule],
  controllers: [VendorShippingController, VendorShippingZonesController, TrackingController, AdminShippingController],
  providers: [
    TrackingService,
    ShippingZonesService,
    // الشركة من SHIPPING_CARRIER: الوهمية تُبنى في التطوير وحده (وتسقط في الإنتاج)،
    // و none لا شركة أصلاً — فلا يُبنى ما يُمنع إقلاعه
    {
      provide: CARRIER,
      useFactory: (): CarrierProvider | null => (loadEnv().shippingCarrier === 'fake' ? new FakeCarrier() : null),
    },
  ],
  exports: [TrackingService, ShippingZonesService],
})
export class ShippingModule {}
