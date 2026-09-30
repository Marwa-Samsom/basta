import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, InvalidInputError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationsService } from '../../notifications/public';
import { OTP_PURPOSE, maskEmail, resendWaitSeconds } from '../domain/account';
import { OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES, otpMessage } from '../domain/otp';
import { hashPassword } from '../domain/password';
import type { RequestMeta } from './auth.service';
import { OtpStore } from './otp.store';
import { normalizeEmail } from '../../../common/email';

/** رسالة واحدة لكل فشل في إعادة التعيين — أي تفصيل يكشف أن للبريد حساباً ورمزاً حيّاً */
export const RESET_FAILED = 'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً من «نسيت كلمة المرور».';

/** الرد نفسه لكل بريد — مسجّلاً كان أو لا (SH-04) */
export const FORGOT_ACCEPTED = 'إن كان هذا البريد مسجّلاً لدينا فستصلك رسالة فيها رمز الاستعادة خلال دقائق.';

export interface VerificationStatus {
  email: string | null;
  verified: boolean;
  verifiedAt: Date | null;
  /** رمز حيّ أُرسل من قبل — الصفحة تعرض عدّاده ولا تطلب غيره */
  pending: { expiresAt: Date; attemptsLeft: number } | null;
  resendAfterSeconds: number;
}

/**
 * SH-03 تأكيد البريد و SH-04 استعادة كلمة المرور — كلاهما رمز من ست خانات
 * يصل بالبريد عبر صندوق الإشعارات الصادر، في معاملة إصدار الرمز نفسها.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger('Recovery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpStore,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------- تأكيد البريد

  async verificationStatus(userId: string, now = new Date()): Promise<VerificationStatus> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    const [live, latest] = await Promise.all([this.otp.live(userId, OTP_PURPOSE.verify, now), this.otp.latest(userId, OTP_PURPOSE.verify)]);
    const verified = user.emailVerifiedAt !== null;
    return {
      email: user.email ? maskEmail(user.email) : null,
      verified,
      verifiedAt: user.emailVerifiedAt,
      pending: live && !verified ? { expiresAt: live.expiresAt, attemptsLeft: OTP_MAX_ATTEMPTS - live.attempts } : null,
      resendAfterSeconds: verified ? 0 : resendWaitSeconds(latest?.createdAt ?? null, now),
    };
  }

  async requestEmailVerification(userId: string, meta: RequestMeta): Promise<VerificationStatus> {
    const now = new Date();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, fullName: true, emailVerifiedAt: true } });
    if (!user.email) throw new InvalidInputError('لا بريد في حسابك لنرسل إليه الرمز.');
    if (user.emailVerifiedAt) throw new ConflictError('بريدك مؤكَّد من قبل، ولا حاجة لرمز جديد.');

    await this.prisma.$transaction(async (tx) => {
      await this.otp.lockUser(tx, userId);
      const latest = await this.otp.latest(userId, OTP_PURPOSE.verify, tx);
      const wait = resendWaitSeconds(latest?.createdAt ?? null, now);
      if (wait > 0) {
        throw new ConflictError(`أرسلنا رمزاً قبل قليل. اطلب غيره بعد ${wait} ثانية.`, { retryAfterSeconds: wait });
      }
      const { code } = await this.otp.issue(tx, userId, OTP_PURPOSE.verify, now);
      const queued = await this.notifications.enqueue(
        { code: 'email_verify_code', userId, vars: { name: user.fullName, code, minutes: String(OTP_TTL_MINUTES) } },
        tx,
      );
      if (queued === 0) {
        // القالب معطَّل من الإدارة: رمز لا يصل أسوأ من رسالة تقول ذلك
        throw new ConflictError('إرسال رموز التأكيد موقوف مؤقتاً. حاول لاحقاً.');
      }
      await tx.auditLog.create({
        data: {
          actorUserId: userId, action: 'user.email_verification_requested', entityType: 'User', entityId: userId,
          ip: meta.ip ?? null, userAgent: meta.userAgent ?? null,
        },
      });
    });
    return this.verificationStatus(userId, now);
  }

  async confirmEmail(userId: string, code: string, meta: RequestMeta): Promise<VerificationStatus> {
    const now = new Date();
    const verdict = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } });
      if (user.emailVerifiedAt) return { kind: 'valid' as const };
      const v = await this.otp.consume(tx, userId, OTP_PURPOSE.verify, code, now);
      if (v.kind !== 'valid') return v;
      await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
      await tx.auditLog.create({
        data: {
          actorUserId: userId, action: 'user.email_verified', entityType: 'User', entityId: userId,
          ip: meta.ip ?? null, userAgent: meta.userAgent ?? null,
        },
      });
      return v;
    });
    if (verdict.kind !== 'valid') {
      throw new InvalidInputError(otpMessage(verdict), {
        reason: verdict.kind,
        ...(verdict.kind === 'wrong' ? { attemptsLeft: verdict.attemptsLeft } : {}),
      });
    }
    return this.verificationStatus(userId, now);
  }

  // --------------------------------------------------- استعادة كلمة المرور

  /**
   * لا يكشف شيئاً: البريد غير المسجّل، والحساب الموقوف، وطلب داخل مهلة إعادة
   * الإرسال — كلها تنتهي بالرد نفسه دون إرسال. الفاعل لا يعرف أيّها حدث.
   */
  async forgotPassword(email: string, meta: RequestMeta): Promise<{ message: string }> {
    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, fullName: true, status: true, deletedAt: true },
    });
    if (user && user.status === 'active' && !user.deletedAt) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.otp.lockUser(tx, user.id);
          const latest = await this.otp.latest(user.id, OTP_PURPOSE.reset, tx);
          if (resendWaitSeconds(latest?.createdAt ?? null, now) > 0) return;
          const { code } = await this.otp.issue(tx, user.id, OTP_PURPOSE.reset, now);
          await this.notifications.enqueue(
            { code: 'password_reset_code', userId: user.id, vars: { name: user.fullName, code, minutes: String(OTP_TTL_MINUTES) } },
            tx,
          );
          await tx.auditLog.create({
            data: {
              actorUserId: user.id, action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id,
              ip: meta.ip ?? null, userAgent: meta.userAgent ?? null,
            },
          });
        });
      } catch (err) {
        // خطأ داخلي هنا لا يجوز أن يغيّر الرد — تغيّره وحده يكشف وجود الحساب
        this.logger.error('تعذّر إصدار رمز الاستعادة', err as Error);
      }
    }
    return { message: FORGOT_ACCEPTED };
  }

  /**
   * تعيين كلمة جديدة بالرمز. عند النجاح تُبطَل **كل** جلسات الحساب: من طلب
   * الاستعادة قد يكون فقد جهازه، فالجلسات المفتوحة ليست بالضرورة جلساته.
   * والرمز وصل البريد فاستعماله يثبت ملكيته — فيُؤكَّد البريد إن لم يكن.
   */
  async resetPassword(input: { email: string; code: string; newPassword: string }, meta: RequestMeta): Promise<{ message: string }> {
    const now = new Date();
    // التجزئة أولاً وللجميع: كلفة زمنية واحدة سواء وُجد الحساب أم لا
    const passwordHash = await hashPassword(input.newPassword);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(input.email) },
      select: { id: true, status: true, deletedAt: true, emailVerifiedAt: true },
    });
    if (!user || user.status !== 'active' || user.deletedAt) throw new InvalidInputError(RESET_FAILED);

    const ok = await this.prisma.$transaction(async (tx) => {
      const v = await this.otp.consume(tx, user.id, OTP_PURPOSE.reset, input.code, now);
      if (v.kind !== 'valid') return false;
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: now }) },
      });
      const revoked = await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id, action: 'auth.password_reset', entityType: 'User', entityId: user.id,
          afterJson: { revokedSessions: revoked.count }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null,
        },
      });
      return true;
    });
    if (!ok) throw new InvalidInputError(RESET_FAILED);
    return { message: 'حُدّثت كلمة المرور، وأُنهيت كل الجلسات المفتوحة على حسابك.' };
  }
}
