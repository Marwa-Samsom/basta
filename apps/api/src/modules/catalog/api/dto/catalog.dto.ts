import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ATTRIBUTE_INPUT_TYPES, type AttributeInputType } from '../../application/attribute.service';

const MAX_STOCK = 1_000_000;

// ============================================================================ فئات المتجر

export class VendorCategoryDto {
  @ApiProperty({ example: 'ملابس رجالية' })
  @IsString({ message: 'اكتب اسم الفئة.' })
  @Length(1, 80, { message: 'اسم الفئة من حرف إلى 80 حرفاً.' })
  nameAr!: string;
}

export class ReorderVendorCategoriesDto {
  /** كل فئات المتجر بترتيبها الجديد — الأولى أولاً */
  @ApiProperty({ type: [String] })
  @IsArray({ message: 'أرسل معرّفات الفئات بترتيبها.' })
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true, message: 'معرّف فئة غير صالح.' })
  ids!: string[];
}

// ============================================================================ السمات

export class AttributeValueCreateDto {
  @ApiProperty({ example: 'أحمر' })
  @IsString()
  @Length(1, 80)
  valueAr!: string;

  @ApiPropertyOptional({ example: 'Red' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  valueEn?: string;

  @ApiPropertyOptional({ example: '#C62828' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'اللون بصيغة #RRGGBB.' })
  hexColor?: string;
}

export class CreateAttributeDto {
  @ApiProperty({ example: 'size' })
  @Matches(/^[a-z][a-z0-9_]{1,40}$/, { message: 'رمز السمة حروف لاتينية صغيرة وأرقام و _ ويبدأ بحرف.' })
  code!: string;

  @ApiProperty({ example: 'المقاس' })
  @IsString()
  @Length(2, 80)
  nameAr!: string;

  @ApiPropertyOptional({ example: 'Size' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  nameEn?: string;

  @ApiProperty({ enum: ATTRIBUTE_INPUT_TYPES })
  @IsIn([...ATTRIBUTE_INPUT_TYPES], { message: 'نوع السمة غير معروف.' })
  inputType!: AttributeInputType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  isFilterable?: boolean;

  @ApiPropertyOptional({ description: 'سمة تميّز المتغيّرات (مقاس، لون) — نوعها select حصراً' })
  @IsOptional()
  @IsBoolean()
  isVariantAxis?: boolean;

  @IsOptional()
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ type: [AttributeValueCreateDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AttributeValueCreateDto)
  values?: AttributeValueCreateDto[];
}

// ============================================================================ المنتجات

export class OptionChoiceDto {
  @ApiProperty()
  @IsUUID('4', { message: 'معرّف السمة غير صالح.' })
  attributeId!: string;

  @ApiProperty()
  @IsUUID('4', { message: 'معرّف القيمة غير صالح.' })
  valueId!: string;
}

export class VariantDto {
  @ApiPropertyOptional({ description: 'في التعديل: معرّف متغيّر قائم. غائب = متغيّر جديد' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف المتغيّر غير صالح.' })
  id?: string;

  @ApiProperty({ example: 'TS01-RED-M' })
  @IsString()
  @Length(1, 64, { message: 'SKU من محرف إلى 64 محرفاً.' })
  sku!: string;

  @ApiProperty({ example: '79.00', description: 'نصّ بعملة تسوية البائع — الدينار ثلاث خانات' })
  @IsString({ message: 'السعر يُرسل نصّاً مثل "79.00" لا رقماً — الأرقام العشرية تفقد الدقة.' })
  @Length(1, 32)
  price!: string;

  @ApiPropertyOptional({ example: '99.00', nullable: true })
  @IsOptional()
  @IsString({ message: 'السعر قبل الخصم يُرسل نصّاً.' })
  @Length(1, 32)
  compareAtPrice?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @IsOptional()
  @IsInt({ message: 'الوزن عدد صحيح بالغرام.' })
  @Min(0)
  weightGrams?: number | null;

  @ApiPropertyOptional({ type: [OptionChoiceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => OptionChoiceDto)
  options?: OptionChoiceDto[];

  @ApiPropertyOptional({ description: 'إلزامي للمتغيّر الجديد. في التعديل: الجرد الفعلي' })
  @IsOptional()
  @IsInt({ message: 'الكمية عدد صحيح.' })
  @Min(0, { message: 'الكمية لا تكون سالبة.' })
  @Max(MAX_STOCK)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  lowStockThreshold?: number | null;
}

export class AttributeValueDto {
  @ApiProperty()
  @IsUUID('4', { message: 'معرّف السمة غير صالح.' })
  attributeId!: string;

  @ApiPropertyOptional({ description: 'لسمة من نوع select' })
  @IsOptional()
  @IsUUID('4')
  valueId?: string;

  @ApiPropertyOptional({ description: 'لسمة نصّية' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  textEn?: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  number?: number;

  @IsOptional()
  @IsBoolean()
  boolean?: boolean;
}

export class CreateProductDto {
  /** إلزامية منذ 18 أكتوبر 2026 — لا يُضاف منتج بلا فئة (والمتجر يبدأ بثماني فئات) */
  @ApiProperty({ description: 'فئة من فئات متجرك' })
  @IsDefined({ message: 'اختر فئة للمنتج — أو أضف فئة جديدة لمتجرك.' })
  @IsUUID('4', { message: 'معرّف الفئة غير صالح.' })
  vendorCategoryId!: string;

  @IsOptional()
  @IsUUID('4')
  brandId?: string | null;

  @ApiProperty({ example: 'قميص قطني' })
  @IsString()
  @Length(2, 200, { message: 'الاسم العربي من حرفين إلى 200 حرف.' })
  nameAr!: string;

  @ApiPropertyOptional({ example: 'Cotton T-shirt' })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  nameEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionAr?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionEn?: string | null;

  @ApiPropertyOptional({ type: [AttributeValueDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AttributeValueDto)
  attributes?: AttributeValueDto[];

  @ApiProperty({ type: [VariantDto], description: 'متغيّر واحد على الأقل — السعر والمخزون عليه' })
  @IsArray()
  @ArrayMinSize(1, { message: 'المنتج يحتاج متغيّراً واحداً على الأقل.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants!: VariantDto[];
}

export class UpdateProductDto {
  /** غائبة = لا تتغيّر؛ ولا تُرسل null — المنتج لا يخرج من كل فئة */
  @ApiPropertyOptional({ description: 'فئة من فئات متجرك — غائبة لا تغيّرها' })
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsUUID('4', { message: 'اختر فئة للمنتج — لا يبقى منتج بلا فئة.' })
  vendorCategoryId?: string;

  @IsOptional()
  @IsUUID('4')
  brandId?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  nameEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionAr?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionEn?: string | null;

  @ApiPropertyOptional({ type: [AttributeValueDto], description: 'تستبدل السمات القائمة كلها' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AttributeValueDto)
  attributes?: AttributeValueDto[];

  @ApiPropertyOptional({
    type: [VariantDto],
    description: 'المجموعة الحيّة كاملةً: القائم الغائب عنها يُؤرشف',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'المنتج يحتاج متغيّراً واحداً على الأقل.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];
}

export class AdjustStockDto {
  @ApiPropertyOptional({ description: 'حدث: -2 تلفت قطعتان، +5 مرتجع' })
  @IsOptional()
  @IsInt({ message: 'التغيير عدد صحيح.' })
  @Min(-MAX_STOCK)
  @Max(MAX_STOCK)
  delta?: number;

  @ApiPropertyOptional({ description: 'جرد فعلي: الكمية الموجودة الآن' })
  @IsOptional()
  @IsInt({ message: 'الكمية عدد صحيح.' })
  @Min(0)
  @Max(MAX_STOCK)
  setTo?: number;

  @ApiProperty({ enum: ['manual_adjust', 'damage', 'return'] })
  @IsIn(['manual_adjust', 'damage', 'return'], { message: 'السبب: manual_adjust أو damage أو return.' })
  reason!: 'manual_adjust' | 'damage' | 'return';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  lowStockThreshold?: number;
}

export class ListProductsQueryDto {
  @IsOptional()
  @IsIn(['draft', 'active', 'rejected', 'archived'])
  status?: 'draft' | 'active' | 'rejected' | 'archived';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** فئة من فئات المتجر، أو none لما بلا فئة — للبائع وحده */
  @IsOptional()
  @Matches(/^(none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, { message: 'الفئة معرّف أو none.' })
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  /** بتاريخ آخر تعديل — الأحدث أولاً افتراضياً */
  @IsOptional()
  @IsIn(['newest', 'oldest'], { message: 'الترتيب newest (الأحدث أولاً) أو oldest (الأقدم أولاً).' })
  sort?: 'newest' | 'oldest';
}

/** مع أي خيار تظهر الصورة — قيمة (اللون الأحمر) أو متغيّر بعينه أو لا شيء (للجميع) */
export class LinkImageDto {
  @ApiPropertyOptional({ nullable: true, description: 'قيمة خيار — تظهر الصورة مع كل متغيّر يحملها' })
  @IsOptional()
  @IsUUID('4', { message: 'قيمة الخيار غير صالحة.' })
  optionValueId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'متغيّر بعينه' })
  @IsOptional()
  @IsUUID('4', { message: 'المتغيّر غير صالح.' })
  variantId?: string | null;
}

export class ReorderImagesDto {
  /** كل صور المنتج بترتيبها الجديد — الأولى هي الرئيسية */
  @ApiProperty({ type: [String], example: ['3f1c…', '9a2e…'] })
  @IsArray({ message: 'أرسل معرّفات الصور بترتيبها.' })
  @ArrayMinSize(1, { message: 'أرسل معرّفات الصور بترتيبها.' })
  @ArrayMaxSize(10, { message: 'للمنتج عشر صور على الأكثر.' })
  @IsUUID('4', { each: true, message: 'معرّف صورة غير صالح.' })
  imageIds!: string[];
}

export class RejectProductDto {
  @ApiProperty({ example: 'الصور لا تطابق المنتج الموصوف.' })
  @IsString()
  @Length(5, 500, { message: 'سبب الإيقاف من 5 أحرف إلى 500 — البائع يصلح بناءً عليه.' })
  reason!: string;
}
