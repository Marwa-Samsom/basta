/**
 * رموز التحقق لمرة واحدة — SRS C-01.
 *
 * قرارات مثبَّتة هنا لا في الإعدادات، لأنها أمنية لا تفضيلية:
 *   ستة أرقام · صلاحية عشر دقائق · خمس محاولات ثم إبطال.
 *
 * الرمز يُخزَّن مجزّأً كما تُخزَّن كلمة المرور: تسريب قاعدة البيانات
 * يجب ألّا يسلّم المهاجم رموزاً صالحة جاهزة.
 */
import { createHash, randomInt } from 'node:crypto';

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

/** `randomInt` مولّد معمّى، و`Math.random` غير صالح لأي غرض أمني. */
export function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export const otpExpiryFrom = (now: Date): Date =>
  new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);

export interface StoredOtp {
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export type OtpVerdict =
  | { kind: 'valid' }
  | { kind: 'wrong'; attemptsLeft: number }
  | { kind: 'exhausted' }
  | { kind: 'expired' }
  | { kind: 'already_used' }
  | { kind: 'not_found' };

/**
 * القرار خالص: لا وقت نظام ضمنيّ ولا قاعدة بيانات. كل فرع قابل للاختبار
 * بلا تهيئة، وهو ما يجعل تغطية الحالات الحدّية ممكنة أصلاً.
 *
 * ترتيب الفحوص مقصود: الاستهلاك ثم الاستنفاد ثم الانتهاء ثم المطابقة.
 * فحص المطابقة أخيراً يمنع استعمال الرمز المستهلَك أو المنتهي ولو كان صحيحاً.
 */
export function verifyOtp(stored: StoredOtp | null, submitted: string, now: Date): OtpVerdict {
  if (!stored) return { kind: 'not_found' };
  if (stored.consumedAt !== null) return { kind: 'already_used' };
  if (stored.attempts >= OTP_MAX_ATTEMPTS) return { kind: 'exhausted' };
  if (stored.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };

  if (hashOtp(submitted) !== stored.codeHash) {
    return { kind: 'wrong', attemptsLeft: OTP_MAX_ATTEMPTS - stored.attempts - 1 };
  }
  return { kind: 'valid' };
}

/** رسالة موجّهة للمستخدم: ما حدث وما الخطوة التالية، بلا كشف ولا لوم. */
export function otpMessage(verdict: OtpVerdict): string {
  switch (verdict.kind) {
    case 'valid':
      return 'تم التحقق.';
    case 'wrong':
      return verdict.attemptsLeft > 0
        ? `الرمز غير صحيح. بقيت لك ${verdict.attemptsLeft} محاولة.`
        : 'الرمز غير صحيح ونفدت المحاولات. اطلب رمزاً جديداً.';
    case 'exhausted':
      return 'نفدت محاولاتك على هذا الرمز. اطلب رمزاً جديداً.';
    case 'expired':
      return `انتهت صلاحية الرمز بعد ${OTP_TTL_MINUTES} دقائق. اطلب رمزاً جديداً.`;
    case 'already_used':
      return 'هذا الرمز استُعمل من قبل. اطلب رمزاً جديداً.';
    case 'not_found':
      return 'لا يوجد رمز نشط. اطلب رمزاً جديداً.';
  }
}
