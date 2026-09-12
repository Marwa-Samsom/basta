/**
 * التحقق الثنائي — إلزامي على كل حساب إداري ولا يمكن تعطيله (SRS A-07).
 *
 * السبب: حساب إداري واحد مخترَق يكفي للموافقة على سحب رصيد أو تعديل
 * نسبة عمولة. كلمة المرور وحدها لا تكفي لحماية صلاحية بهذا الأثر.
 *
 * ملاحظة على الاعتمادية: otplib 13 واجهة دوالّية تختلف جذرياً عن 12
 * (التي كانت تصدّر `authenticator`)، وتتطلّب حقن إضافتَي التعمية و Base32
 * صراحةً. الغلاف هنا يعزل ذلك كله، فترقية المكتبة تمسّ هذا الملف وحده.
 */
import {
  NobleCryptoPlugin,
  ScureBase32Plugin,
  generateSecret,
  generateURI,
  verifySync,
} from 'otplib';

const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

export const APP_NAME = 'بسطة';

export const generateTotpSecret = (): string => generateSecret();

/**
 * الرابط الذي يُحوَّل إلى رمز QR في الواجهة.
 * الاسم بالإنجليزية عمداً: تطبيقات المصادقة تعرض المُصدِر حرفياً، وبعضها
 * لا يعرض العربية بشكل سليم في قائمة الحسابات.
 */
export const totpUri = (secret: string, accountLabel: string): string =>
  generateURI({ strategy: 'totp', secret, label: accountLabel, issuer: 'Basta' });

/**
 * يُرجع `false` لكل ما ليس رمزاً صحيحاً: مشوّهاً كان أو منتهياً أو بسرّ تالف.
 * التحقق يجب أن يقول «مرفوض» لا أن يرمي خطأً يكشف حالة الحساب.
 */
export function verifyTotp(token: string, secret: string): boolean {
  const cleaned = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;

  try {
    return verifySync({ strategy: 'totp', secret, token: cleaned, crypto, base32 }).valid;
  } catch {
    return false;
  }
}

/**
 * القاعدة التي لا تُخرَق: الإداري بلا 2FA لا يحصل على رمز وصول كامل.
 * يحصل على رمز محدود لا يفتح إلا مسار تهيئة 2FA — فلا يستطيع تجاهل
 * التفعيل والمضيّ في عمله.
 */
export function adminNeedsTotpSetup(roles: readonly string[], totpEnabledAt: Date | null): boolean {
  return roles.includes('admin') && totpEnabledAt === null;
}

/**
 * دَين تقني موثّق — مقاومة إعادة التشغيل.
 *
 * رمز TOTP صالح لنافذته كاملة (90 ثانية بنافذة ±1)، فمن يلتقطه يستطيع
 * إعادة استعماله داخلها. المكتبة تدعم `afterTimeStep` لرفض ما سبق آخر
 * خطوة استُعملت، لكنه يتطلّب عموداً يخزّن آخر خطوة لكل مستخدم.
 *
 * القرار: مؤجَّل إلى المرحلة 12 (التصليب الأمني) لا مُهمَل. المخاطرة
 * محدودة لأن المهاجم يحتاج كلمة المرور والرمز معاً داخل تسعين ثانية،
 * والمكسب لا يوازي توسيع المخطط في منتصف المرحلة 04.
 */
export const REPLAY_PROTECTION_PENDING = true;
