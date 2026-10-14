import { LatinDigits } from '../../../common/digits';
import {
  Body,
  Controller,
  Delete,
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
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { Actor } from '../../../common/security/actor';
import { CurrentActor } from '../../../common/security/decorators';
import { AddressesService } from '../application/addresses.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('العنوان غير موجود.') });

const PHONE = /^\+?[0-9 ]{7,20}$/;
const COUNTRY = /^[A-Za-z]{2}$/;

/**
 * حدود الحقول تطابق `AddressDto` في إتمام الشراء أو تضيق عنها: عنوان محفوظ
 * يُملأ في نموذج الدفع كما هو، فلا يُرفض هناك ما قُبل هنا.
 */
export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @IsString()
  @Length(2, 120)
  recipientName!: string;

  @Matches(PHONE, { message: 'رقم الهاتف غير صالح — أرقام فقط، ويجوز أن يبدأ بـ +.' })
  @LatinDigits()
  phone!: string;

  @Matches(COUNTRY, { message: 'البلد برمز من حرفين.' })
  country!: string;

  @IsString()
  @Length(1, 80)
  region!: string;

  @IsString()
  @Length(1, 80)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  area?: string;

  @IsString()
  @Length(2, 160)
  street!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  recipientName?: string;

  @IsOptional()
  @Matches(PHONE, { message: 'رقم الهاتف غير صالح — أرقام فقط، ويجوز أن يبدأ بـ +.' })
  @LatinDigits()
  phone?: string;

  @IsOptional()
  @Matches(COUNTRY, { message: 'البلد برمز من حرفين.' })
  country?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  region?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  area?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * ST-26 — عناوين المستخدم الداخل، أيّاً كان دوره. لا مسار يأخذ معرّف مستخدم:
 * المالك هو الفاعل دائماً، ومعرّف العنوان وحده لا يفتح شيئاً.
 */
@ApiTags('my-addresses')
@ApiBearerAuth()
@Controller('me/addresses')
export class MyAddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  async list(@CurrentActor() a: Actor) {
    return { items: await this.addresses.list(a.userId) };
  }

  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.addresses.get(a.userId, id);
  }

  @Post()
  create(@CurrentActor() a: Actor, @Body() dto: CreateAddressDto) {
    const { isDefault, ...input } = dto;
    return this.addresses.create(a.userId, input, isDefault === true);
  }

  @Patch(':id')
  update(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string, @Body() dto: UpdateAddressDto) {
    const { isDefault, ...patch } = dto;
    return this.addresses.update(a.userId, id, patch, isDefault === true);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  makeDefault(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.addresses.setDefault(a.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.addresses.remove(a.userId, id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(@CurrentActor() a: Actor, @Param('id', uuidParam) id: string) {
    return this.addresses.restore(a.userId, id);
  }
}
