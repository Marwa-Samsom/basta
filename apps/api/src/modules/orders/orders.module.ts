import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/public';
import { InventoryModule } from '../inventory/public';
import { PaymentsModule } from '../payments/public';
import {
  AdminOrdersController,
  CustomerOrdersController,
  VendorOrdersController,
} from './api/orders.controllers';
import { OrderLifecycleService } from './application/order-lifecycle.service';
import { OrderQueryService } from './application/order-query.service';
import { OrderScheduler } from './application/order-scheduler';

@Module({
  imports: [InventoryModule, PaymentsModule, FinanceModule],
  controllers: [VendorOrdersController, CustomerOrdersController, AdminOrdersController],
  providers: [OrderLifecycleService, OrderQueryService, OrderScheduler],
  exports: [OrderLifecycleService, OrderQueryService, OrderScheduler],
})
export class OrdersModule {}
