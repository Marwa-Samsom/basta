import { Module } from '@nestjs/common';
import { VendorDirectory } from './application/vendor-directory.service';

@Module({
  providers: [VendorDirectory],
  exports: [VendorDirectory],
})
export class VendorsModule {}
