/**
 * إعادة إرسال الإشعار بمهلة تطول — SYS-031، 26 أكتوبر 2026.
 *
 * كانت خمس محاولات كل 5 ثوانٍ تُستنفد في نحو 25 ثانية: انقطاع البريد دقيقة واحدة
 * يختم رمز الاستعادة «فشل» نهائياً، ولا شيء يعيده حين يعود الخادم. الآن ثماني
 * محاولات على قرابة ساعتين: الانقطاع القصير يمرّ بتأخير ثوانٍ، والطويل يُعطى فرصته
 * قبل أن يُختم.
 *
 * الانتظار بعد المحاولة الفاشلة رقم 1، 2، … — المحاولة الثامنة إن فشلت فهي الأخيرة.
 */
export const RETRY_DELAYS_SECONDS = [10, 30, 60, 5 * 60, 15 * 60, 30 * 60, 60 * 60] as const;

export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

/** موعد المحاولة التالية بعد فشل المحاولة رقم `attempts`، أو null إن استُنفدت المحاولات */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  const wait = attempts >= 1 ? RETRY_DELAYS_SECONDS[attempts - 1] : undefined;
  return wait === undefined ? null : new Date(now.getTime() + wait * 1000);
}
