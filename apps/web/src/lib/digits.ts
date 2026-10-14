/**
 * الأرقام العربية-الهندية (٠-٩) والفارسية (۰-۹) إلى لاتينية — يعكس apps/api/src/common/digits.ts.
 *
 * لوحة الجوال العربية تكتبها افتراضياً، و`\D` لا يعرفها: خانة الرمز كانت تحذف «٤٨٢٩١٣»
 * كله بصمت فيبدو للمشتري أن لوحته معطّلة.
 */
export function toLatinDigits(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** الأرقام وحدها، بعد توحيدها — لخانات الرمز والكميات */
export const digitsOnly = (raw: string): string => toLatinDigits(raw).replace(/\D/g, '');
