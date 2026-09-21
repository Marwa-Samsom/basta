import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ForbiddenActorError, vendorScopeOf, type Actor } from '../../../common/security/actor';
import { CurrentActor, Public, RequirePermission, Roles } from '../../../common/security/decorators';
import { TrackingService } from '../application/tracking.service';
import { TRACKING_ORDER, type TrackingCode } from '../domain/carrier';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('الطلب غير موجود.') });

function vendorIdOf(actor: Actor): string {
  try {
    return vendorScopeOf(actor).vendorId;
  } catch (err) {
    if (err instanceof ForbiddenActorError) throw new ForbiddenException(err.message);
    throw err;
  }
}

export class CarrierEventDto {
  @IsIn([...TRACKING_ORDER, 'failed'])
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  location?: string;
}

@ApiTags('vendor-shipping')
@ApiBearerAuth()
@Roles('vendor_owner', 'vendor_staff')
@Controller('vendor/shipping')
export class VendorShippingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('carriers')
  carriers() {
    return this.tracking.carriers();
  }

  @Post('waybill/:subOrderId')
  @HttpCode(HttpStatus.CREATED)
  waybill(@CurrentActor() actor: Actor, @Param('subOrderId', uuidParam) subOrderId: string) {
    return this.tracking.createWaybill(vendorIdOf(actor), subOrderId);
  }
}

@ApiTags('tracking')
@Controller('track')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Public()
  @Get(':trackingNumber')
  track(@Param('trackingNumber') trackingNumber: string) {
    return this.tracking.track(trackingNumber.trim().slice(0, 40));
  }
}

/** محاكاة إشعار شركة الشحن — للإدارة وحدها في البيئة المحلية */
@ApiTags('admin-shipping')
@ApiBearerAuth()
@Roles('admin')
@RequirePermission('orders.manage')
@Controller('admin/shipping')
export class AdminShippingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post(':trackingNumber/events')
  @HttpCode(HttpStatus.OK)
  async event(@Param('trackingNumber') trackingNumber: string, @Body() dto: CarrierEventDto) {
    return { recorded: await this.tracking.record(trackingNumber, dto.code as TrackingCode, new Date(), dto.location) };
  }
}
