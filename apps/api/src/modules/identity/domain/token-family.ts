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
 */

/**
 * يصف ما يُخزَّن فعلاً لا أكثر. سلسلة التدوير تُستنتج من familyId
 * وترتيب الإنشاء، فلا داعي لمؤشّر صريح لا يُقرأ.
 */
export interface StoredToken {
  id: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type RotationOutcome =
  | { kind: 'rotate'; previousTokenId: string; familyId: string }
  | { kind: 'reuse_detected'; familyId: string }
  | { kind: 'invalid' }
  | { kind: 'expired' };

/**
 * القرار خالص من أي أثر جانبي: لا قاعدة بيانات ولا وقت نظام ضمنيّ.
 * هذا ما يجعل كل فرع منه قابلاً للاختبار بلا تهيئة.
 */
export function decideRotation(stored: StoredToken | null, now: Date): RotationOutcome {
  if (!stored) return { kind: 'invalid' };

  // الترتيب مقصود: إعادة الاستخدام تُفحص قبل الانتهاء.
  // رمز مُبطَل ومنتهٍ معاً ما زال دليل سرقة، ولا يجوز أن يمرّ كـ«منتهٍ» عادي.
  if (stored.revokedAt !== null) {
    return { kind: 'reuse_detected', familyId: stored.familyId };
  }

  if (stored.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'expired' };
  }

  return { kind: 'rotate', previousTokenId: stored.id, familyId: stored.familyId };
}
