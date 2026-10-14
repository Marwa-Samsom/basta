import { Transform } from 'class-transformer';

/**
 * الأرقام العربية-الهندية (٠١٢٣٤٥٦٧٨٩) والفارسية (۰۱۲۳۴۵۶۷۸۹) إلى لاتينية.
 *
 * لوحة مفاتيح الجوال العربية تكتبها افتراضياً، وكانت خانات الرمز والهاتف تحذفها بصمت
 * (`\D` لا يعرفها) أو يرفضها الخادم «صيغة غير صحيحة» — رمز التحقق «٤٨٢٩١٣» صحيح
 * ويُرفض. التوحيد للحقول التي هي أرقام بطبيعتها وحدها: اسم منتج فيه «٢٠٢٤» يبقى كما كُتب.
 */
export function toLatinDigits(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** يوحّد أرقام الحقل قبل التحقق منه — ValidationPipe يطبّق التحويل أولاً (transform: true) */
export const LatinDigits = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? toLatinDigits(value).trim() : value));
