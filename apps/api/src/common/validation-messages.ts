import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';
import { toEnglish } from './i18n/translate';

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
  title: 'العنوان',
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

/** الأسماء نفسها حين يكون الموقع بالإنجليزية (زرّ اللغة، 2 نوفمبر 2026) */
const FIELD_LABELS_EN: Readonly<Record<string, string>> = {
  recipientName: 'Recipient name',
  phone: 'Phone',
  guestPhone: 'Phone',
  country: 'Country',
  region: 'Governorate or region',
  city: 'City',
  area: 'Area',
  street: 'Street and building number',
  building: 'Building',
  floor: 'Floor',
  landmark: 'Landmark',
  label: 'Address name',
  email: 'Email',
  guestEmail: 'Email',
  password: 'Password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  fullName: 'Name',
  code: 'Code',
  totp: 'Verification code',
  reason: 'Reason',
  description: 'Description',
  note: 'Note',
  reference: 'Reference',
  transferReference: 'Transfer reference',
  tracking: 'Tracking number',
  qty: 'Quantity',
  quantity: 'Quantity',
  items: 'Items',
  rating: 'Rating',
  body: 'Text',
  bodyAr: 'Text',
  title: 'Title',
  titleAr: 'Title',
  nameAr: 'Arabic name',
  nameEn: 'English name',
  descriptionAr: 'Description',
  sku: 'Product code (SKU)',
  price: 'Price',
  priceMinorUnits: 'Price',
  stock: 'Stock',
  iban: 'Account number (IBAN)',
  holderName: 'Account holder name',
  bankName: 'Bank name',
  value: 'Value',
  page: 'Page number',
  search: 'Search',
  status: 'Status',
};

const ARABIC = /[؀-ۿ]/;
const num = (message: string): string | null => /(-?\d+(?:\.\d+)?)/.exec(message)?.[1] ?? null;

function labelOf(property: string): string {
  return FIELD_LABELS[property] ?? 'أحد الحقول';
}

/**
 * القيد نفسه بالإنجليزية — يُبنى مع العربي لا يُترجم منه: نوع القيد واسم الحقل معروفان
 * هنا. الرسالة العربية المكتوبة في الـ DTO تُترجم من القاموس (common/i18n/en.ts).
 */
export function englishConstraint(constraint: string, property: string, message: string): string {
  if (ARABIC.test(message)) return toEnglish(message);
  const label = FIELD_LABELS_EN[property] ?? 'A field';
  const n = num(message);
  switch (constraint) {
    case 'whitelistValidation':
      return 'The request has an unknown field — refresh the page and try again.';
    case 'isDefined':
    case 'isNotEmpty':
      return `${label}: required.`;
    case 'isString':
      return `${label}: text required.`;
    case 'isEmail':
      return 'Invalid email format.';
    case 'isLength':
    case 'length':
    case 'minLength':
    case 'maxLength':
      if (/longer than or equal to/.test(message) && n) return `${label}: at least ${n} characters.`;
      if (/shorter than or equal to/.test(message) && n) return `${label}: at most ${n} characters.`;
      return `${label}: length not accepted.`;
    case 'isInt':
    case 'isNumber':
    case 'isNumberString':
    case 'isNumeric':
      return `${label}: a whole number is required.`;
    case 'min':
      return n ? `${label}: must be at least ${n}.` : `${label}: below the allowed minimum.`;
    case 'max':
      return n ? `${label}: must be at most ${n}.` : `${label}: above the allowed maximum.`;
    case 'arrayMinSize':
      return n ? `${label}: at least ${n}.` : `${label}: not enough.`;
    case 'arrayMaxSize':
      return n ? `${label}: at most ${n}.` : `${label}: more than allowed.`;
    case 'isUuid':
    case 'isUUID':
      return `${label}: invalid identifier.`;
    case 'isIn':
    case 'isEnum':
      return `${label}: value not allowed.`;
    case 'isBoolean':
      return `${label}: yes or no.`;
    case 'isArray':
      return `${label}: a list is required.`;
    case 'matches':
      return `${label}: invalid format.`;
    case 'nestedValidation':
      return `${label}: invalid data.`;
    default:
      return `${label}: invalid value.`;
  }
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
function messagesBy(
  errors: readonly ValidationError[],
  phrase: (constraint: string, property: string, message: string) => string,
): string[] {
  const out: string[] = [];
  const walk = (list: readonly ValidationError[]) => {
    for (const e of list) {
      for (const [constraint, message] of Object.entries(e.constraints ?? {})) {
        out.push(phrase(constraint, e.property, message));
      }
      if (e.children?.length) walk(e.children);
    }
  };
  walk(errors);
  return [...new Set(out)];
}

export function arabicMessages(errors: readonly ValidationError[]): string[] {
  return messagesBy(errors, arabicConstraint);
}

export function englishMessages(errors: readonly ValidationError[]): string[] {
  return messagesBy(errors, englishConstraint);
}

/**
 * الردّ يحمل اللغتين: `message` بالعربية كما كان، و `messageEn` يأخذ مكانه معالجُ الأخطاء
 * حين يطلب الموقع الإنجليزية — ولا يخرج `messageEn` للعميل أبداً (all-exceptions.filter).
 */
export function arabicValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: arabicMessages(errors),
        messageEn: englishMessages(errors),
        error: 'Bad Request',
        statusCode: 400,
      }),
  });
}
