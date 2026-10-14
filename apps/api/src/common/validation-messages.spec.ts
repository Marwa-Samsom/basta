import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { arabicValidationPipe } from './validation-messages';
import { LatinDigits } from './digits';

class Address {
  @IsString()
  @Length(2, 120)
  recipientName!: string;

  @LatinDigits()
  @Matches(/^\+?[0-9 ]{7,20}$/, { message: 'رقم الهاتف غير صالح.' })
  phone!: string;
}

class Order {
  @ValidateNested()
  @Type(() => Address)
  address!: Address;

  @IsEmail()
  email!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsUUID()
  id!: string;

  @IsOptional()
  @MaxLength(5)
  note?: string;

  @IsOptional()
  @IsString()
  mysteryField?: string;
}

async function messages(body: Record<string, unknown>): Promise<string[]> {
  try {
    await arabicValidationPipe().transform(body, { type: 'body', metatype: Order });
    return [];
  } catch (err) {
    return ((err as { getResponse(): { message: string[] } }).getResponse()).message;
  }
}

const valid = {
  address: { recipientName: 'سارة', phone: '+962790000000' },
  email: 'a@b.co',
  qty: 1,
  id: '7f1e3c1a-1b2c-4d5e-8f90-123456789abc',
};

describe('رسائل التحقق بالعربية', () => {
  it('قيود بلا رسالة مكتوبة تُترجم باسم الحقل وعدده — لا إنجليزية تصل القارئ', async () => {
    const m = await messages({ ...valid, address: { recipientName: 'س', phone: '+962790000000' }, email: 'x', qty: 0, id: 'abc', note: 'طويلة جداً' });
    expect(m).toEqual(
      expect.arrayContaining([
        'اسم المستلم: 2 أحرف على الأقل.',
        'صيغة البريد غير صحيحة.',
        'الكمية: لا يقلّ عن 1.',
        'أحد الحقول: معرّف غير صالح.',
        'الملاحظة: 5 حرفاً على الأكثر.',
      ]),
    );
    expect(m.join(' ')).not.toMatch(/[A-Za-z]{3,}/);
  });

  it('الرسالة المكتوبة بالعربية تمرّ كما هي، والحقل الزائد يُرفض بلا اسمه البرمجي', async () => {
    const m = await messages({ ...valid, address: { recipientName: 'سارة', phone: 'abc' }, extra: 1 });
    expect(m).toContain('رقم الهاتف غير صالح.');
    expect(m).toContain('في الطلب حقل غير معروف — حدّث الصفحة وأعد المحاولة.');
  });

  it('الأرقام العربية في الهاتف تُقبل — تُوحَّد لاتينية قبل التحقق', async () => {
    expect(await messages({ ...valid, address: { recipientName: 'سارة', phone: '+٩٦٢٧٩٠٠٠٠٠٠٠' } })).toEqual([]);
    const out = (await arabicValidationPipe().transform(
      { ...valid, address: { recipientName: 'سارة', phone: '+٩٦٢٧٩٠٠٠٠٠٠٠' } },
      { type: 'body', metatype: Order },
    )) as Order;
    expect(out.address.phone).toBe('+962790000000');
  });
});
