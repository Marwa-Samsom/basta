/**
 * تدوير رموز التحديث مع كشف إعادة الاستخدام.
 *
 * المشكلة التي يحلّها: رمز التحديث طويل العمر. إن سُرق، لا شيء في نظام
 * تقليدي يميّز المهاجم عن صاحب الحساب — كلاهما يحمل رمزاً صالحاً.
 *
 * الحل: كل رمز يُستعمل **مرة واحدة**، ويُبطَل فور استعماله ويُصدَر بديله.
 * الرموز المتسلسلة تنتمي إلى «عائلة» واحدة (familyId). فإذا وصل رمز
 * مُبطَل، فهذا يعني يقيناً أن نسخة منه بيد طرفين — الأصلي والسارق.
 * عندها تُبطَل العائلة كلها ويُطرد الاثنان، ويعيد صاحب الحساب الدخول.
 *
 * هذا هو السلوك الصحيح: تسجيل خروج مزعج مرة، أفضل من حساب مسروق بصمت.
 *
 * **الاستثناء الوحيد — التزامن:** تبويبان من المتصفّح نفسه يتشاركان الرمز
 * ويجدّدان في اللحظة نفسها؛ يفوز أحدهما ويصل الآخر برمز دُوِّر للتوّ. هذا ليس
 * طرفين بل طرف واحد، فلا تُنهى الجلسة: يُردّ «جُدّد للتوّ» بلا رموز، فيقرأ
 * التبويب الرمز الجديد الذي كتبه أخوه. الاستثناء ضيّق عمداً — رمز **دُوِّر**
 * (لا أُبطل بخروج)، خلال مهلة قصيرة، ومن الجهاز نفسه الذي أخذ خلفه. ولا يأخذ
 * صاحبه رموزاً، فلا يكسب به سارقٌ شيئاً.
 */

/** مهلة التزامن — أطول من أبطأ تجديدين متوازيين، وأقصر من أن تنفع مُعيد تشغيل */
export const CONCURRENT_REFRESH_GRACE_MS = 30_000;

/**
 * يصف ما يُخزَّن فعلاً لا أكثر. العائلة من familyId، والخلف المباشر من
 * replacedById — يُقرأ لمهلة التزامن وحدها.
 */
export interface StoredToken {
  id: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  /** خلفه بالتدوير — null إن أُبطل بخروج أو إبطال عائلة */
  replacedById?: string | null;
}

export type RotationOutcome =
  | { kind: 'rotate'; previousTokenId: string; familyId: string }
  | { kind: 'reuse_detected'; familyId: string }
  /** تبويب آخر من الجهاز نفسه دوّره للتوّ — لا رموز، ولا إبطال */
  | { kind: 'concurrent'; familyId: string }
  | { kind: 'invalid' }
  | { kind: 'expired' };

/**
 * القرار خالص من أي أثر جانبي: لا قاعدة بيانات ولا وقت نظام ضمنيّ.
 * هذا ما يجعل كل فرع منه قابلاً للاختبار بلا تهيئة.
 *
 * `sameClientAsSuccessor`: هل الطالب هو الجهاز الذي أخذ خلف الرمز (المتصفّح
 * والعنوان نفساهما)؟ يحسبه المستدعي من صف الخلف.
 */
export function decideRotation(
  stored: StoredToken | null,
  now: Date,
  sameClientAsSuccessor = false,
): RotationOutcome {
  if (!stored) return { kind: 'invalid' };

  // الترتيب مقصود: إعادة الاستخدام تُفحص قبل الانتهاء.
  // رمز مُبطَل ومنتهٍ معاً ما زال دليل سرقة، ولا يجوز أن يمرّ كـ«منتهٍ» عادي.
  if (stored.revokedAt !== null) {
    const justRotated =
      !!stored.replacedById && now.getTime() - stored.revokedAt.getTime() <= CONCURRENT_REFRESH_GRACE_MS;
    if (justRotated && sameClientAsSuccessor) return { kind: 'concurrent', familyId: stored.familyId };
    return { kind: 'reuse_detected', familyId: stored.familyId };
  }

  if (stored.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'expired' };
  }

  return { kind: 'rotate', previousTokenId: stored.id, familyId: stored.familyId };
}
