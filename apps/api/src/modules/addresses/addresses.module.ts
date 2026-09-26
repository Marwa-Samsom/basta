import { Module } from '@nestjs/common';
import { MyAddressesController } from './api/addresses.controller';
import { AddressesService } from './application/addresses.service';

/**
 * دفتر عناوين المشتري — ST-26. وحدة صغيرة مستقلة: لا تعتمد على وحدة أخرى،
 * وإتمام الشراء لا يعتمد عليها (يأخذ العنوان في جسم الطلب ويحفظ لقطته).
 */
@Module({
  controllers: [MyAddressesController],
  providers: [AddressesService],
  exports: [AddressesService],
})
export class AddressesModule {}
