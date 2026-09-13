import { Module } from '@nestjs/common';
import { InventoryService } from './application/inventory.service';
import { ReservationSweeper } from './application/reservation-sweeper';

@Module({
  providers: [InventoryService, ReservationSweeper],
  exports: [InventoryService, ReservationSweeper],
})
export class InventoryModule {}
