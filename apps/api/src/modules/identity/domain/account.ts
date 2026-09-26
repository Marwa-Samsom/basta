/**
 * قواعد الحساب الخالصة — التحقق من البريد، استعادة كلمة المرور، والجلسات.
 * لا قاعدة بيانات ولا وقت نظام ضمنيّ: كل دالة هنا قابلة للاختبار بلا تهيئة.
 */

/** أغراض الرمز في جدول otp_codes — العمود نصّي، فالقيم مثبَّتة هنا لا في كل استدعاء */
export const OTP_PURPOSE = { verify: 'verify', reset: 'reset' } as const;
export type OtpPurpose = (typeof OTP_PURPOSE)[keyof typeof OTP_PURPOSE];

/**
 * مهلة إعادة الإرسال. حدّ التخمين (10 في 15 دقيقة لكل عنوان) يحمي من الإغراق
 * من عنوان واحد؛ المهلة تحمي صندوق بريد الضحية من عناوين كثيرة.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/** الثواني الباقية قبل السماح برمز جديد — صفر يعني «أرسل الآن» */
export function resendWaitSeconds(lastIssuedAt: Date | null, now: Date): number {
  if (!lastIssuedAt) return 0;
  const elapsed = (now.getTime() - lastIssuedAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
}

/**
 * البريد مقنَّعاً للعرض: `no•••@example.com`. الصفحة تقول لصاحبها أين ذهب
 * الرمز دون أن تعرض بريده كاملاً لمن ينظر فوق كتفه.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const keep = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${keep}•••${email.slice(at)}`;
}

/**
 * الجلسة = عائلة رموز التحديث (`familyId`). كل تدوير يُنشئ صفاً جديداً في
 * العائلة نفسها ويُبطل سابقه، فمعرّف الصف يتغيّر كل ربع ساعة ومعرّف العائلة
 * ثابت طوال عمر الدخول. لذلك تُعرض الجلسات وتُنهى بمعرّف العائلة.
 */
export interface TokenRow {
  familyId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionView {
  id: string;
  userAgent: string | null;
  ip: string | null;
  /** بداية الدخول: أقدم صف في العائلة */
  signedInAt: Date;
  /** آخر نشاط: أحدث تدوير */
  lastActiveAt: Date;
  current: boolean;
}

/** الصف النشط: غير مُبطَل وغير منتهٍ */
export const isActiveToken = (row: Pick<TokenRow, 'revokedAt' | 'expiresAt'>, now: Date): boolean =>
  row.revokedAt === null && row.expiresAt.getTime() > now.getTime();

/**
 * يجمع صفوف مستخدم واحد في جلسات. العائلة تُعرض إن كان فيها صف نشط واحد على
 * الأقل؛ بيانات الجهاز من أحدث صف نشط، وبداية الدخول من أقدم صف في العائلة
 * (`starts` — تُحسب في القاعدة بتجميع، فعائلة عمرها شهر فيها آلاف الصفوف).
 */
export function groupSessions(
  rows: readonly TokenRow[],
  starts: ReadonlyMap<string, Date>,
  currentFamilyId: string | null,
  now: Date,
): SessionView[] {
  const families = new Map<string, TokenRow[]>();
  for (const r of rows) {
    const list = families.get(r.familyId) ?? [];
    list.push(r);
    families.set(r.familyId, list);
  }
  const out: SessionView[] = [];
  for (const [familyId, list] of families) {
    const active = list.filter((r) => isActiveToken(r, now)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latest = active[0];
    if (!latest) continue;
    const seen = list.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), latest.createdAt);
    const start = starts.get(familyId);
    const first = start && start < seen ? start : seen;
    out.push({
      id: familyId,
      userAgent: latest.userAgent,
      ip: latest.ip,
      signedInAt: first,
      lastActiveAt: latest.createdAt,
      current: familyId === currentFamilyId,
    });
  }
  // الجلسة الحالية أولاً، ثم الأحدث نشاطاً
  return out.sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
}
