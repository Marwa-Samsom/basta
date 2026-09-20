import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { SETTLEMENT_CURRENCIES } from '../../domain/onboarding';

const COUNTRY = /^[A-Za-z]{2}$/;

export class ApplyVendorDto {
  @ApiProperty({ example: 'دار القطن' })
  @IsString()
  @Length(2, 80)
  nameAr!: string;

  @ApiPropertyOptional({ example: 'Dar AlQutn' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameEn?: string;

  @ApiPropertyOptional({ example: 'dar-alqutn', description: 'يُشتقّ من الاسم إن تُرك فارغاً' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  slug?: string;

  @ApiProperty({ example: 'JO' })
  @Matches(COUNTRY, { message: 'بلد المتجر يُكتب برمز من حرفين (JO، SA، AE…).' })
  country!: string;

  @ApiPropertyOptional({ enum: ['individual', 'company'] })
  @IsOptional()
  @IsIn(['individual', 'company'], { message: 'نوع النشاط: فرد أو شركة.' })
  businessType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mainCategoryId?: string;
}

export class UpdateShopDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 80)
  nameAr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(COUNTRY)
  country?: string;

  @ApiPropertyOptional({ enum: ['individual', 'company'] })
  @IsOptional()
  @IsIn(['individual', 'company'])
  businessType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mainCategoryId?: string;
}

export class UpdateStoreProfileDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionAr?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionEn?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  shippingPolicyAr?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  returnPolicyAr?: string;
}

export class BankAccountDto {
  @ApiProperty({ example: 'مروة سمسوم' })
  @IsString()
  @Length(3, 120)
  holderName!: string;

  @ApiProperty({ example: 'JO94CBJO0010000000000131000302' })
  @IsString()
  @Length(15, 40)
  iban!: string;

  @ApiProperty({ example: 'البنك العربي' })
  @IsString()
  @Length(2, 120)
  bankName!: string;

  @ApiPropertyOptional({ example: 'ARABJOAX' })
  @IsOptional()
  @IsString()
  @MaxLength(11)
  swift?: string;
}

export class SettlementCurrencyDto {
  @ApiProperty({ enum: SETTLEMENT_CURRENCIES })
  @IsIn(SETTLEMENT_CURRENCIES as unknown as string[], {
    message: 'العملة غير مدعومة للتسوية.',
  })
  currency!: string;

  @ApiPropertyOptional({
    description: 'التثبيت قرار لا رجعة فيه — يُرسل true بعد تأكيد البائع في نافذة التأكيد',
  })
  @IsOptional()
  @IsBoolean()
  lock?: boolean;
}

export class ReviewQueueQueryDto {
  @ApiPropertyOptional({ enum: ['in_review', 'pending', 'approved', 'rejected', 'suspended'] })
  @IsOptional()
  @IsIn(['in_review', 'pending', 'approved', 'rejected', 'suspended', 'banned'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  offset?: string;
}

export class RejectVendorDto {
  @ApiProperty({ example: 'صورة السجل التجاري غير واضحة — أعد تصويرها كاملة.' })
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class SuspendVendorDto {
  @ApiProperty({ example: 'شكاوى متكرّرة على عدم الشحن خلال المدة المعلنة.' })
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class DocumentDecisionDto {
  @ApiProperty()
  @IsBoolean()
  accept!: boolean;

  @ApiPropertyOptional({ description: 'مطلوب عند الرفض — يُعرض للبائع كما هو' })
  @IsOptional()
  @IsString()
  @Length(5, 500)
  reason?: string;
}
