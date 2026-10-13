import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import { ATTRIBUTE_INPUT_TYPES, type AttributeInputType } from '../../application/category.service';

const MAX_STOCK = 1_000_000;

// ============================================================================ الفئات والسمات

export class CreateCategoryDto {
  @ApiPropertyOptional({ description: 'غائب = فئة جذرية' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الفئة الأب غير صالح.' })
  parentId?: string;

  @ApiProperty({ example: 'men-clothing' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'المعرّف النصّي حروف لاتينية صغيرة وأرقام بشرطات.' })
  @Length(2, 80)
  slug!: string;

  @ApiProperty({ example: 'ملابس رجالية' })
  @IsString()
  @Length(2, 120, { message: 'الاسم العربي من حرفين إلى 120 حرفاً.' })
  nameAr!: string;

  @ApiPropertyOptional({ example: "Men's clothing" })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  iconKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sort?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'المعرّف النصّي حروف لاتينية صغيرة وأرقام بشرطات.' })
  @Length(2, 80)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  iconKey?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ description: 'false يُخفي الفئة وفرعها من الشجرة العامة' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class MoveCategoryDto {
  @ApiPropertyOptional({ description: 'null أو غائب = نقل إلى الجذر', nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الفئة الأب غير صالح.' })
  parentId?: string | null;
}

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

export class LinkAttributeDto {
  @ApiProperty({ description: 'إلزامية تمنع نشر منتج لم يملأها' })
  @IsBoolean()
  isRequired!: boolean;

  @IsOptional()
  @IsInt()
  sort?: number;
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
  @ApiProperty()
  @IsUUID('4', { message: 'معرّف الفئة غير صالح.' })
  categoryId!: string;

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
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الفئة غير صالح.' })
  categoryId?: string;

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
  @IsIn(['draft', 'pending_review', 'active', 'rejected', 'archived'])
  status?: 'draft' | 'pending_review' | 'active' | 'rejected' | 'archived';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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

export class ApproveProductDto {
  /** نسخة المحتوى التي فتحها المراجِع (contentRevision في تفاصيل المنتج) */
  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt({ message: 'أرسل نسخة المحتوى التي راجعتها.' })
  @Min(0)
  contentRevision!: number;
}

export class RejectProductDto {
  @ApiProperty({ example: 'الصور لا تطابق المنتج الموصوف.' })
  @IsString()
  @Length(5, 500, { message: 'سبب الرفض من 5 أحرف إلى 500 — البائع يصلح بناءً عليه.' })
  reason!: string;
}
