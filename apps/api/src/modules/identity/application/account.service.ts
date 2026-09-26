import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError, DuplicateError, InvalidInputError, NotFoundError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { groupSessions, type SessionView } from '../domain/account';
import { hashPassword, verifyPassword } from '../domain/password';
import type { RequestMeta } from './auth.service';

/** تجزئة وهمية بالمعاملات نفسها — المقارنة تأخذ زمنها ولو غابت كلمة المرور */
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaA';

export interface Profile {
  id: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  totpEnabled: boolean;
  isAdmin: boolean;
  createdAt: Date;
}

/**
 * ST-25 — حساب المستخدم نفسه: ملفه وكلمة مروره وجلساته.
 *
 * كل استعلام هنا مقيَّد بـ `userId` الفاعل من رمزه الموقَّع، ولا يقبل معرّف
 * مستخدم من الطلب أصلاً. معرّف الجلسة وحده يأتي من الطلب — ويُطابَق مع
 * المستخدم في جملة التحديث نفسها، فجلسة غيرك «غير موجودة» (404 لا 403).
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(userId: string): Promise<Profile> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: true } });
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      emailVerifiedAt: u.emailVerifiedAt,
      phoneVerifiedAt: u.phoneVerifiedAt,
      totpEnabled: u.totpEnabledAt !== null,
      isAdmin: u.roles.some((r) => r.role === 'admin'),
      createdAt: u.createdAt,
    };
  }

  async updateProfile(userId: string, input: { fullName?: string; phone?: string }, meta: RequestMeta): Promise<Profile> {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true } });
    const fullName = input.fullName?.trim();
    const phone = input.phone === undefined ? undefined : input.phone === '' ? null : input.phone;
    const data: Prisma.UserUpdateInput = {};
    if (fullName !== undefined && fullName !== before.fullName) {
      if (fullName.length < 2) throw new InvalidInputError('الاسم من حرفين إلى 120 حرفاً.');
      data.fullName = fullName;
    }
    // رقم جديد لم يُثبَت بعد: التوثيق يخصّ الرقم لا الحساب
    if (phone !== undefined && phone !== before.phone) {
      data.phone = phone;
      data.phoneVerifiedAt = null;
    }
    if (Object.keys(data).length === 0) return this.profile(userId);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data });
        await tx.auditLog.create({
          data: {
            actorUserId: userId, action: 'user.profile_update', entityType: 'User', entityId: userId,
            beforeJson: before, afterJson: { fullName: fullName ?? before.fullName, phone: phone === undefined ? before.phone : phone },
            ip: meta.ip ?? null, userAgent: meta.userAgent ?? null,
          },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DuplicateError('تعذّر حفظ هذا الرقم لأنه مرتبط بحساب آخر. إن كان رقمك فتواصل معنا.');
      }
      throw err;
    }
    return this.profile(userId);
  }

  /**
   * تغيير كلمة المرور بإثبات الحالية. الجلسات **الأخرى** تُنهى — من غيّر
   * كلمته لأنه شكّ في تسرّبها يريد طرد من دخل بها — والحالية تبقى فلا يُطرد
   * من الصفحة التي غيّر منها.
   */
  async changePassword(
    userId: string,
    sessionId: string | null,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<{ revokedSessions: number; currentKept: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    const ok = await verifyPassword(input.currentPassword, user.passwordHash ?? DUMMY_HASH);
    if (!ok || !user.passwordHash) {
      await this.prisma.auditLog.create({
        data: { actorUserId: userId, action: 'auth.password_change_failed', entityType: 'User', entityId: userId, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
      });
      // 400 لا 401: عميل الواجهة يقرأ 401 انتهاء جلسة فيجدّدها ويعيد المحاولة
      throw new InvalidInputError('كلمة المرور الحالية غير صحيحة.');
    }
    if (input.currentPassword === input.newPassword) {
      throw new InvalidInputError('اختر كلمة مرور مختلفة عن الحالية.');
    }
    const passwordHash = await hashPassword(input.newPassword);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      const revoked = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null, ...(sessionId ? { familyId: { not: sessionId } } : {}) },
        data: { revokedAt: now },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId, action: 'auth.password_changed', entityType: 'User', entityId: userId,
          afterJson: { revokedSessions: revoked.count, currentKept: sessionId !== null },
          ip: meta.ip ?? null, userAgent: meta.userAgent ?? null,
        },
      });
      return { revokedSessions: revoked.count, currentKept: sessionId !== null };
    });
  }

  // ------------------------------------------------------------ الجلسات

  async sessions(userId: string, sessionId: string | null, now = new Date()): Promise<SessionView[]> {
    const active = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      select: { familyId: true, userAgent: true, ip: true, createdAt: true, expiresAt: true, revokedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const families = [...new Set(active.map((r) => r.familyId))];
    const starts = families.length
      ? await this.prisma.refreshToken.groupBy({
          by: ['familyId'],
          where: { userId, familyId: { in: families } },
          _min: { createdAt: true },
        })
      : [];
    const startMap = new Map(starts.flatMap((s) => (s._min.createdAt ? [[s.familyId, s._min.createdAt] as const] : [])));
    return groupSessions(active, startMap, sessionId, now);
  }

  async revokeSession(userId: string, familyId: string, meta: RequestMeta): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // المستخدم شرط في جملة التحديث نفسها: عائلة غيرك لا تُمسّ ولا يُعرف وجودها
      const r = await tx.refreshToken.updateMany({ where: { userId, familyId, revokedAt: null }, data: { revokedAt: now } });
      if (r.count === 0) throw new NotFoundError('الجلسة غير موجودة أو انتهت من قبل.');
      await tx.auditLog.create({
        data: { actorUserId: userId, action: 'auth.session_revoked', entityType: 'User', entityId: userId, afterJson: { familyId }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
      });
    });
  }

  async revokeOthers(userId: string, sessionId: string | null, meta: RequestMeta): Promise<{ revokedSessions: number }> {
    if (!sessionId) {
      // رمز صدر قبل تمييز الجلسات: لا نعرف أيّها الحالية، والتخمين قد يطرد صاحبها
      throw new ConflictError('تعذّر تمييز جلستك الحالية. حدّث الصفحة بعد دقائق أو ادخل من جديد، ثم أعد المحاولة.');
    }
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null, familyId: { not: sessionId } },
        data: { revokedAt: now },
      });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: 'auth.sessions_revoked_others', entityType: 'User', entityId: userId, afterJson: { revokedSessions: r.count }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
      });
      return { revokedSessions: r.count };
    });
  }
}
