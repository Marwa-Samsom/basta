import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Role } from '../../../common/security/actor';
import { AuditService } from '../infrastructure/audit.service';
import { hashPassword, verifyPassword } from '../domain/password';
import { adminNeedsTotpSetup, generateTotpSecret, totpUri, verifyTotp } from '../domain/totp';
import { TokenService, type AccessClaims, type TokenPair } from './token.service';

export interface RequestMeta {
  /** قد تغيب فعلاً: عميل بلا ترويسة، أو طلب داخلي */
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface LoginResult {
  tokens: TokenPair;
  /** إداري لم يفعّل 2FA — الرمز محدود ولا يفتح إلا مسار التهيئة */
  requiresTotpSetup: boolean;
  /** إداري فعّل 2FA ولم يقدّم رمزه بعد */
  requiresTotp: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- المطالبات

  async buildClaims(userId: string): Promise<AccessClaims> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true, permissions: true, vendors: { select: { id: true } } },
    });
    if (!user || user.status !== 'active' || user.deletedAt) {
      throw new UnauthorizedException('الحساب غير متاح.');
    }

    const roles = user.roles.map((r) => r.role as Role);
    const claims: AccessClaims = {
      sub: user.id,
      roles,
      permissions: user.permissions.map((p) => p.permission),
      ...(user.vendors[0] ? { vendorId: user.vendors[0].id } : {}),
    };

    // القاعدة التي لا تُخرَق: إداري بلا 2FA لا يحصل على رمز كامل
    if (adminNeedsTotpSetup(roles, user.totpEnabledAt)) {
      return { ...claims, limited: true };
    }
    return claims;
  }

  // ---------------------------------------------------------------- التسجيل

  async register(
    input: { email: string; password: string; fullName: string; phone?: string },
    meta: RequestMeta,
  ): Promise<{ userId: string }> {
    const passwordHash = await hashPassword(input.password);

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      /**
       * الرد نفسه للبريد المستعمل وغير المستعمل من ناحية المستخدم
       * سيكون تجربة سيئة، والرد المختلف يكشف من سجّل لدينا.
       * الحل الوسط: خطأ عام لا يذكر «هذا البريد مسجّل» للمهاجم المتسلسل،
       * ويوجّه صاحب الحساب إلى استعادة كلمة المرور.
       */
      throw new ConflictException(
        'تعذّر إنشاء الحساب بهذه البيانات. إن كان لديك حساب، استعد كلمة المرور.',
      );
    }

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        phone: input.phone ?? null,
        passwordHash,
        fullName: input.fullName,
        roles: { create: { role: 'customer' } },
      },
    });

    await this.audit.record({
      actorUserId: user.id,
      actorRole: 'customer',
      action: 'user.register',
      entityType: 'User',
      entityId: user.id,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return { userId: user.id };
  }

  // ---------------------------------------------------------------- الدخول

  async login(
    input: { email: string; password: string; totp?: string },
    meta: RequestMeta,
  ): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { roles: true },
    });

    /**
     * التحقق يجري حتى لو لم يوجد المستخدم، بتجزئة وهمية.
     * بدونه يكشف فارق زمن الاستجابة أي البُرد مسجّل لدينا — وهو تعداد
     * حسابات صامت لا يظهر في أي سجل.
     */
    const hash = user?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaA';
    const ok = await verifyPassword(input.password, hash);

    if (!user || !ok || user.status !== 'active' || user.deletedAt) {
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user?.id ?? null,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
      throw new UnauthorizedException('البريد أو كلمة المرور غير صحيحة.');
    }

    const roles = user.roles.map((r) => r.role as Role);
    const isAdminUser = roles.includes('admin');

    // إداري فعّل 2FA: لا رمز بلا إثبات ثانٍ
    if (isAdminUser && user.totpEnabledAt && user.totpSecretEnc) {
      if (!input.totp || !verifyTotp(input.totp, user.totpSecretEnc)) {
        throw new UnauthorizedException('رمز التحقق الثنائي مطلوب وصحيح.');
      }
    }

    const claims = await this.buildClaims(user.id);
    const tokens = await this.tokens.issue(claims, meta);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      actorUserId: user.id,
      actorRole: roles[0] ?? null,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    return {
      tokens,
      requiresTotpSetup: claims.limited === true,
      requiresTotp: false,
    };
  }

  // ---------------------------------------------------------------- الجلسات

  refresh(presented: string, meta: RequestMeta): Promise<TokenPair> {
    return this.tokens.rotate(presented, meta, (userId) => this.buildClaims(userId));
  }

  async logout(presented: string): Promise<void> {
    await this.tokens.revokeOne(presented);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({
      actorUserId: userId,
      action: 'auth.logout_all',
      entityType: 'User',
      entityId: userId,
    });
  }

  // ---------------------------------------------------------------- 2FA

  async beginTotpSetup(userId: string): Promise<{ secret: string; uri: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = generateTotpSecret();

    // يُخزَّن غير مفعَّل: لا يصير ساري المفعول قبل إثبات أن المستخدم نسخه
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: secret, totpEnabledAt: null },
    });

    return { secret, uri: totpUri(secret, user.email ?? user.id) };
  }

  async confirmTotpSetup(userId: string, token: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecretEnc || !verifyTotp(token, user.totpSecretEnc)) {
      throw new UnauthorizedException('الرمز غير صحيح. تأكد من وقت جهازك وأعد المحاولة.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date() },
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'auth.totp_enabled',
      entityType: 'User',
      entityId: userId,
    });

    // الجلسات المحدودة السابقة تُبطَل ليُعاد إصدار رمز كامل
    await this.tokens.revokeAllForUser(userId);
  }

  /**
   * تعطيل 2FA — ممنوع على الإدارة بلا استثناء (SRS A-07).
   * لا معامل ولا صلاحية تفتح هذا الباب: المنع في الكود لا في السياسة.
   */
  async disableTotp(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: true },
    });

    if (user.roles.some((r) => r.role === 'admin')) {
      throw new ConflictException(
        'التحقق الثنائي إلزامي على الحسابات الإدارية ولا يمكن تعطيله. لإيقافه أزل الدور الإداري أولاً.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: null, totpEnabledAt: null },
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'auth.totp_disabled',
      entityType: 'User',
      entityId: userId,
    });
  }
}
