import { LatinDigits } from '../../../../common/digits';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../../domain/password';
import { NormalizeEmail } from '../../../../common/email';

/** قاعدة كلمة المرور نفسها في التسجيل — لا قاعدتان لشيء واحد */
const PASSWORD_RULE = [MIN_PASSWORD_LENGTH, 200, { message: `كلمة المرور من ${MIN_PASSWORD_LENGTH} محارف على الأقل.` }] as const;
const CODE_RULE = /^\d{6}$/;

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'نور الحاج' })
  @IsOptional()
  @IsString()
  @Length(2, 120, { message: 'الاسم من حرفين إلى 120 حرفاً.' })
  fullName?: string;

  /** نصّ فارغ يمسح الرقم — الجوال اختياري كما في التسجيل */
  @ApiPropertyOptional({ example: '+962790000000', description: 'نصّ فارغ يمسح الرقم' })
  @IsOptional()
  @IsString()
  @ValidateIf((o: UpdateProfileDto) => o.phone !== '')
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'الهاتف بصيغة دولية تبدأ بـ + ورمز الدولة.' })
  @LatinDigits()
  phone?: string;
}

export class CurrencyPreferenceDto {
  @ApiProperty({ example: 'SAR' })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'عملة غير مدعومة.' })
  currency!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @Length(...PASSWORD_RULE)
  newPassword!: string;
}

export class VerifyCodeDto {
  @ApiProperty({ example: '482913' })
  @Matches(CODE_RULE, { message: 'الرمز ستة أرقام.' })
  @LatinDigits()
  code!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail({}, { message: 'صيغة البريد غير صحيحة.' })
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail({}, { message: 'صيغة البريد غير صحيحة.' })
  email!: string;

  @ApiProperty({ example: '482913' })
  @Matches(CODE_RULE, { message: 'الرمز ستة أرقام.' })
  @LatinDigits()
  code!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @Length(...PASSWORD_RULE)
  newPassword!: string;
}
