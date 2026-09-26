import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ForbiddenActorError, vendorScopeOf, type Actor } from '../../../common/security/actor';
import { CurrentActor, Roles } from '../../../common/security/decorators';
import { ShippingZonesService, type RateInput } from '../application/zones.service';
import { MAX_DAYS, MAX_RATES_PER_ZONE, MAX_REGIONS_PER_ZONE, RATE_METHODS } from '../domain/zones';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('غير موجود.') });

function vendorIdOf(actor: Actor): string {
  try {
    return vendorScopeOf(actor).vendorId;
  } catch (err) {
    if (err instanceof ForbiddenActorError) throw new ForbiddenException(err.message);
    throw err;
  }
}

/** مبلغ بالوحدات الصغرى نصاً — لا عدد عشري يمرّ في مال (ADR-001)، والسالب لا يطابق */
const MINOR = /^(0|[1-9][0-9]{0,14})$/;
const MINOR_MSG = 'المبلغ عدد صحيح غير سالب بالوحدات الصغرى.';

export class RegionDto {
  @Matches(/^[A-Za-z]{2}$/, { message: 'رمز البلد حرفان لاتينيان (SA، JO…).' })
  country!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  region?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string | null;
}

export class RateDto {
  @IsIn(RATE_METHODS)
  method!: string;

  @Matches(MINOR, { message: MINOR_MSG })
  priceMinorUnits!: string;

  @IsOptional()
  @Matches(MINOR, { message: MINOR_MSG })
  perKgMinorUnits?: string | null;

  @IsOptional()
  @Matches(MINOR, { message: MINOR_MSG })
  freeOverMinorUnits?: string | null;

  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  minDays!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  maxDays!: number;
}

export class RatePatchDto {
  @IsOptional()
  @IsIn(RATE_METHODS)
  method?: string;

  @IsOptional()
  @Matches(MINOR, { message: MINOR_MSG })
  priceMinorUnits?: string;

  @IsOptional()
  @Matches(MINOR, { message: MINOR_MSG })
  perKgMinorUnits?: string | null;

  @IsOptional()
  @Matches(MINOR, { message: MINOR_MSG })
  freeOverMinorUnits?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  minDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  maxDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ZoneDto {
  @IsString()
  @Length(2, 80)
  nameAr!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف بلداً أو مدينة واحدة على الأقل إلى التغطية.' })
  @ArrayMaxSize(MAX_REGIONS_PER_ZONE)
  @ValidateNested({ each: true })
  @Type(() => RegionDto)
  regions!: RegionDto[];

  @IsArray()
  @ArrayMinSize(1, { message: 'المنطقة تحتاج تسعيرة واحدة على الأقل.' })
  @ArrayMaxSize(MAX_RATES_PER_ZONE)
  @ValidateNested({ each: true })
  @Type(() => RateDto)
  rates!: RateDto[];
}

export class ZonePatchDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'أضف بلداً أو مدينة واحدة على الأقل إلى التغطية.' })
  @ArrayMaxSize(MAX_REGIONS_PER_ZONE)
  @ValidateNested({ each: true })
  @Type(() => RegionDto)
  regions?: RegionDto[];
}

const big = (v: string | null | undefined): bigint | null => (v === null || v === undefined ? null : BigInt(v));
const optBig = (v: string | null | undefined): bigint | null | undefined => (v === undefined ? undefined : big(v));

const rateInput = (r: RateDto): RateInput => ({
  method: r.method,
  priceMinor: BigInt(r.priceMinorUnits),
  perKgMinor: big(r.perKgMinorUnits),
  freeOverMinor: big(r.freeOverMinorUnits),
  minDays: r.minDays,
  maxDays: r.maxDays,
});

/**
 * VD-16 — مناطق الشحن. الموظّف يرى، والمالك وحده يغيّر: السعر الذي يدفعه
 * المشتري قرار مالي كالسحب.
 */
@ApiTags('vendor-shipping')
@ApiBearerAuth()
@Roles('vendor_owner', 'vendor_staff')
@Controller('vendor/shipping')
export class VendorShippingZonesController {
  constructor(private readonly zones: ShippingZonesService) {}

  @Get('zones')
  list(@CurrentActor() a: Actor) {
    return this.zones.list(vendorIdOf(a));
  }

  @Post('zones')
  @Roles('vendor_owner')
  create(@CurrentActor() a: Actor, @Body() dto: ZoneDto) {
    return this.zones.createZone(vendorIdOf(a), a.userId, {
      nameAr: dto.nameAr,
      isActive: dto.isActive ?? true,
      regions: dto.regions,
      rates: dto.rates.map(rateInput),
    });
  }

  @Patch('zones/:id')
  @Roles('vendor_owner')
  update(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: ZonePatchDto) {
    return this.zones.updateZone(vendorIdOf(a), a.userId, id, {
      nameAr: dto.nameAr,
      isActive: dto.isActive,
      regions: dto.regions,
    });
  }

  @Delete('zones/:id')
  @Roles('vendor_owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.zones.deleteZone(vendorIdOf(a), a.userId, id);
  }

  @Post('zones/:id/rates')
  @Roles('vendor_owner')
  addRate(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: RateDto) {
    return this.zones.addRate(vendorIdOf(a), a.userId, id, rateInput(dto));
  }

  @Patch('rates/:id')
  @Roles('vendor_owner')
  updateRate(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: RatePatchDto) {
    return this.zones.updateRate(vendorIdOf(a), a.userId, id, {
      method: dto.method,
      priceMinor: dto.priceMinorUnits === undefined ? undefined : BigInt(dto.priceMinorUnits),
      perKgMinor: optBig(dto.perKgMinorUnits),
      freeOverMinor: optBig(dto.freeOverMinorUnits),
      minDays: dto.minDays,
      maxDays: dto.maxDays,
      isActive: dto.isActive,
    });
  }
}
