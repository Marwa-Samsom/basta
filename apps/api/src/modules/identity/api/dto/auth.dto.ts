import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../../domain/password';
import { NormalizeEmail } from '../../../../common/email';

/** رمز التطبيق (ستة أرقام)، أو رمز الاستعادة بشرطة أو بدونها وبأي حالة أحرف */
const SECOND_FACTOR = /^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/;

export class RegisterDto {
  @ApiProperty({ example: 'noor@example.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'صيغة البريد غير صحيحة.' })
  email!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, 200, {
    message: `كلمة المرور من ${MIN_PASSWORD_LENGTH} محارف على الأقل.`,
  })
  password!: string;

  @ApiProperty({ example: 'نور الحاج' })
  @IsString()
  @Length(2, 120, { message: 'الاسم من حرفين إلى 120 حرفاً.' })
  fullName!: string;

  @ApiPropertyOptional({ example: '+962790000000' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'الهاتف بصيغة دولية تبدأ بـ + ورمز الدولة.' })
  phone?: string;
}

export class LoginDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail({}, { message: 'صيغة البريد غير صحيحة.' })
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ description: 'رمز التحقق الثنائي (ستة أرقام) أو رمز استعادة — لمن فعّل التحقق بخطوتين' })
  @IsOptional()
  @Matches(SECOND_FACTOR, { message: 'رمز التحقق ستة أرقام، أو رمز استعادة من عشرة محارف.' })
  totp?: string;
}

export class TotpCodeDto {
  @ApiProperty({ description: 'رمز التطبيق أو رمز استعادة' })
  @Matches(SECOND_FACTOR, { message: 'رمز التحقق ستة أرقام، أو رمز استعادة من عشرة محارف.' })
  code!: string;
}

/** فارغ لأول تهيئة؛ وعلى تحقق مفعَّل (تغيير الجهاز) كلمة المرور ورمز من الجهاز الحالي معاً */
export class TotpSetupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @ApiPropertyOptional({ description: 'رمز الجهاز الحالي أو رمز استعادة' })
  @IsOptional()
  @Matches(SECOND_FACTOR, { message: 'رمز التحقق ستة أرقام، أو رمز استعادة من عشرة محارف.' })
  code?: string;
}

export class TotpDisableDto extends TotpCodeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  password!: string;
}

export class TotpConfirmDto {
  @ApiProperty()
  @Matches(/^\d{6}$/, { message: 'رمز التحقق ستة أرقام.' })
  token!: string;
}
