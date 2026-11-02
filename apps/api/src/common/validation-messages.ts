import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';

/**
 * رسائل التحقق بالعربية — المشتري كان يقرأ `address.recipientName must be longer than or
 * equal to 2 characters` تحت زرّ «ادفع».
 *
 * الرسالة المكتوبة في الـ DTO بالعربية تمرّ كما هي — هي مكتوبة للقارئ أصلاً. وما بقي
 * على رسالة class-validator الإنجليزية الافتراضية يُترجم بنوع قيده واسم حقله، والأعداد
 * (أقصر طول، أدنى قيمة) تُؤخذ من الرسالة نفسها. شكل الردّ لا يتغيّر: مصفوفة رسائل.
 */

/** أسماء الحقول كما يراها القارئ — حقل لا اسم له هنا يُذكر «أحد الحقول» لا اسمه البرمجي */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  recipientName: 'اسم المستلم',
  phone: 'الهاتف',
  guestPhone: 'الهاتف',
  country: 'البلد',
  region: 'المحافظة أو المنطقة',
  city: 'المدينة',
  area: 'الحي',
  street: 'الشارع ورقم البناء',
  building: 'البناء',
  floor: 'الطابق',
  landmark: 'العلامة المميّزة',
  label: 'اسم العنوان',
  email: 'البريد',
  guestEmail: 'البريد',
  password: 'كلمة المرور',
  currentPassword: 'كلمة المرور الحالية',
  newPassword: 'كلمة المرور الجديدة',
  fullName: 'الاسم',
  code: 'الرمز',
  totp: 'رمز التحقق',
  reason: 'السبب',
  description: 'الوصف',
  note: 'الملاحظة',
  reference: 'المرجع',
  transferReference: 'مرجع التحويل',
  tracking: 'رقم التتبّع',
  qty: 'الكمية',
  quantity: 'الكمية',
  items: 'القطع',
  rating: 'التقييم',
  body: 'النص',
  bodyAr: 'النص',
  title: 'العنوان',
  titleAr: 'العنوان',
  nameAr: 'الاسم بالعربية',
  nameEn: 'الاسم بالإنجليزية',
  descriptionAr: 'الوصف',
  sku: 'رمز المنتج (SKU)',
  price: 'السعر',
  priceMinorUnits: 'السعر',
  stock: 'المخزون',
  iban: 'رقم الحساب (IBAN)',
  holderName: 'اسم صاحب الحساب',
  bankName: 'اسم البنك',
  value: 'القيمة',
  page: 'رقم الصفحة',
  search: 'البحث',
  status: 'الحالة',
};

const ARABIC = /[؀-ۿ]/;
const num = (message: string): string | null => /(-?\d+(?:\.\d+)?)/.exec(message)?.[1] ?? null;

function labelOf(property: string): string {
  return FIELD_LABELS[property] ?? 'أحد الحقول';
}

/** رسالة قيد واحد بالعربية — من نوعه ونصّه الإنجليزي الافتراضي */
export function arabicConstraint(constraint: string, property: string, message: string): string {
  if (ARABIC.test(message)) return message;
  const label = labelOf(property);
  const n = num(message);
  switch (constraint) {
    case 'whitelistValidation':
      return 'في الطلب حقل غير معروف — حدّث الصفحة وأعد المحاولة.';
    case 'isDefined':
    case 'isNotEmpty':
      return `${label}: مطلوب.`;
    case 'isString':
      return `${label}: نصّ مطلوب.`;
    case 'isEmail':
      return 'صيغة البريد غير صحيحة.';
    case 'isLength':
    case 'length':
    case 'minLength':
    case 'maxLength':
      if (/longer than or equal to/.test(message) && n) return `${label}: ${n} أحرف على الأقل.`;
      if (/shorter than or equal to/.test(message) && n) return `${label}: ${n} حرفاً على الأكثر.`;
      return `${label}: الطول غير مقبول.`;
    case 'isInt':
    case 'isNumber':
    case 'isNumberString':
    case 'isNumeric':
      return `${label}: رقم صحيح مطلوب.`;
    case 'min':
      return n ? `${label}: لا يقلّ عن ${n}.` : `${label}: أقل من المسموح.`;
    case 'max':
      return n ? `${label}: لا يزيد عن ${n}.` : `${label}: أكبر من المسموح.`;
    case 'arrayMinSize':
      return n ? `${label}: ${n} على الأقل.` : `${label}: لا يكفي.`;
    case 'arrayMaxSize':
      return n ? `${label}: ${n} على الأكثر.` : `${label}: أكثر من المسموح.`;
    case 'isUuid':
    case 'isUUID':
      return `${label}: معرّف غير صالح.`;
    case 'isIn':
    case 'isEnum':
      return `${label}: قيمة غير مسموحة.`;
    case 'isBoolean':
      return `${label}: نعم أو لا.`;
    case 'isArray':
      return `${label}: قائمة مطلوبة.`;
    case 'matches':
      return `${label}: صيغة غير صحيحة.`;
    case 'nestedValidation':
      return `${label}: بيانات غير صالحة.`;
    default:
      return `${label}: قيمة غير صالحة.`;
  }
}

/** كل رسائل الأخطاء، والمتداخلة منها (address.recipientName)، بلا تكرار */
export function arabicMessages(errors: readonly ValidationError[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly ValidationError[]) => {
    for (const e of list) {
      for (const [constraint, message] of Object.entries(e.constraints ?? {})) {
        out.push(arabicConstraint(constraint, e.property, message));
      }
      if (e.children?.length) walk(e.children);
    }
  };
  walk(errors);
  return [...new Set(out)];
}

export function arabicValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new BadRequestException(arabicMessages(errors)),
  });
}
