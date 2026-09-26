import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { OtpPurpose } from '../domain/account';
import { OTP_MAX_ATTEMPTS, generateOtp, hashOtp, otpExpiryFrom, verifyOtp, type OtpVerdict } from '../domain/otp';

type Db = Prisma.TransactionClient | PrismaService;

/** القناة الوحيدة لرموز الهوية اليوم — العمود يتّسع للجوال حين يأتي */
const CHANNEL = 'email';

/**
 * رموز لمرة واحدة في `otp_codes` — الإصدار والاستهلاك.
 *
 * الرمز يُخزَّن مجزّأً، ويبطل بالاستعمال أو بخمس محاولات أو بعشر دقائق
 * (`domain/otp`). والرمز الجديد يُقاعد ما قبله: رمز واحد حيّ لكل غرض.
 */
@Injectable()
export class OtpStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * قفل صف المستخدم حتى نهاية المعاملة. طلبان متزامنان لرمز جديد يمرّان
   * بمهلة إعادة الإرسال واحداً بعد الآخر — لا معاً فيُرسَل رمزان.
   */
  async lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }

  latest(userId: string, purpose: OtpPurpose, db: Db = this.prisma) {
    return db.otpCode.findFirst({ where: { userId, purpose, channel: CHANNEL }, orderBy: { createdAt: 'desc' } });
  }

  /** يُرجع الرمز صريحاً مرة واحدة — ليُرسَل داخل المعاملة نفسها ثم يُنسى */
  async issue(tx: Prisma.TransactionClient, userId: string, purpose: OtpPurpose, now: Date): Promise<{ code: string; expiresAt: Date }> {
    await tx.otpCode.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: now } });
    const code = generateOtp();
    const expiresAt = otpExpiryFrom(now);
    await tx.otpCode.create({ data: { userId, channel: CHANNEL, purpose, codeHash: hashOtp(code), expiresAt } });
    return { code, expiresAt };
  }

  /**
   * يستهلك الرمز إن صحّ. **المحاولة تُحجز قبل المقارنة** بزيادة شرطيّة: عشرون
   * تخميناً متوازياً كانت كلها تقرأ «صفر محاولات» فتُقارَن كلها — فيصير حدّ
   * الخمس محاولات حدّاً على التخمين المتسلسل وحده. الشرط `attempts < 5` في
   * جملة التحديث نفسها هو ما يجعل الخامسة آخر ما يُقارَن مهما تزامن.
   *
   * لا يرمي: المحاولة الخاطئة يجب أن تُلتزم مع المعاملة، والرمي يلغيها.
   */
  async consume(db: Db, userId: string, purpose: OtpPurpose, submitted: string, now: Date): Promise<OtpVerdict> {
    const stored = await this.latest(userId, purpose, db);
    const verdict = verifyOtp(stored, submitted, now);
    if (!stored || (verdict.kind !== 'valid' && verdict.kind !== 'wrong')) return verdict;

    const claimed = await db.otpCode.updateMany({
      where: { id: stored.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS }, expiresAt: { gt: now } },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      // سبقه طلب آخر: استُهلك الرمز أو نفدت محاولاته أو انتهى بينهما
      const again = verifyOtp(await db.otpCode.findUnique({ where: { id: stored.id } }), submitted, now);
      return again.kind === 'valid' || again.kind === 'wrong' ? { kind: 'exhausted' } : again;
    }
    if (verdict.kind === 'wrong') return verdict;

    const used = await db.otpCode.updateMany({ where: { id: stored.id, consumedAt: null }, data: { consumedAt: now } });
    return used.count === 1 ? { kind: 'valid' } : { kind: 'already_used' };
  }

  /** الرمز الحيّ إن وُجد — لتعرف الصفحة أن رمزاً أُرسل فلا تطلب غيره */
  async live(userId: string, purpose: OtpPurpose, now: Date) {
    const row = await this.latest(userId, purpose);
    if (!row || row.consumedAt || row.attempts >= OTP_MAX_ATTEMPTS || row.expiresAt <= now) return null;
    return row;
  }
}
