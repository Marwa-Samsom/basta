import { Injectable, UnauthorizedException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Role } from '../../../common/security/actor';
import { NotificationsService } from '../../notifications/public';
import { isLegacyPlain, openTotpSecret, sealTotpSecret } from '../infrastructure/secret-box';
import { AuditService } from '../infrastructure/audit.service';
import { hashPassword, verifyPassword } from '../domain/password';
import { generateRecoveryCodes, looksLikeRecoveryCode, normalizeRecoveryCode } from '../domain/recovery-codes';
import { adminNeedsTotpSetup, generateTotpSecret, totpUri, verifyTotpStep } from '../domain/totp';
import { TokenService, type AccessClaims, type TokenPair } from './token.service';
import { normalizeEmail } from '../../../common/email';
import { loadEnv } from '../../../common/config/env';

/** رمز التطوير الثابت (DEV_FIXED_CODE) يُقبل بدل رمز التطبيق — لا أثر له خارج NODE_ENV=development */
const isDevFixedCode = (submitted: string): boolean => {
  const fixed = loadEnv().devFixedCode;
  return fixed !== null && submitted.replace(/\s/g, '') === fixed;
};

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

/** ما تُبنى منه المطالبات — مشترك بين الإصدار والتحقق مع كل طلب */
const CLAIMS_SELECT = {
  status: true,
  deletedAt: true,
  totpEnabledAt: true,
  roles: { select: { role: true } },
  permissions: { select: { permission: true } },
  vendors: { select: { id: true } },
} as const;

function claimsOf(
  userId: string,
  user: Prisma.UserGetPayload<{ select: typeof CLAIMS_SELECT }>,
): AccessClaims {
  const roles = user.roles.map((r) => r.role as Role);
  const claims: AccessClaims = {
    sub: userId,
    roles,
    permissions: user.permissions.map((p) => p.permission),
    ...(user.vendors[0] ? { vendorId: user.vendors[0].id } : {}),
  };
  // القاعدة التي لا تُخرَق: إداري بلا 2FA لا يحصل على رمز كامل
  return adminNeedsTotpSetup(roles, user.totpEnabledAt) ? { ...claims, limited: true } : claims;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- المطالبات

  async buildClaims(userId: string): Promise<AccessClaims> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: CLAIMS_SELECT,
    });
    if (!user || user.status !== 'active' || user.deletedAt) {
      throw new UnauthorizedException('الحساب غير متاح.');
    }
    return claimsOf(userId, user);
  }

  /**
   * الفاعل كما هو الآن في القاعدة، لا كما كان حين وُقِّع الرمز.
   *
   * رمز الوصول يعيش 15 دقيقة، وكانت مطالباته تُصدَّق كما هي: الموقوف، والمدير
   * الذي سُحبت صلاحياته، ومن غيّر كلمة مروره (فأُنهيت جلساته) — كلهم يعملون
   * حتى ينتهي الرمز. الآن يُقرأ مع كل طلب، باستعلام واحد: الحساب فعّال،
   * والجلسة (عائلة رمز التحديث، `sid`) حيّة، والأدوار والصلاحيات من القاعدة.
   * كل ما يُنهي جلسة — الخروج، تغيير كلمة المرور، الإيقاف، سحب الصلاحيات،
   * كشف السرقة — يسري إذن في الطلب التالي لا بعد ربع ساعة.
   */
  async liveClaims(token: AccessClaims): Promise<AccessClaims> {
    const sid = typeof token.sid === 'string' ? token.sid : null;
    if (!sid) throw new UnauthorizedException('انتهت جلستك. سجّل الدخول من جديد.');
    const user = await this.prisma.user.findUnique({
      where: { id: token.sub },
      select: {
        ...CLAIMS_SELECT,
        refreshTokens: {
          where: { familyId: sid, revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!user || user.status !== 'active' || user.deletedAt) {
      throw new UnauthorizedException('الحساب غير متاح.');
    }
    if (user.refreshTokens.length === 0) {
      throw new UnauthorizedException('انتهت جلستك. سجّل الدخول من جديد.');
    }
    return { ...claimsOf(token.sub, user), sid };
  }

  // ---------------------------------------------------------------- التسجيل

  async register(
    input: { email: string; password: string; fullName: string; phone?: string },
    meta: RequestMeta,
  ): Promise<{ userId: string }> {
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);

    // الهاتف فريد كالبريد — كان المكرّر يصل القيد في القاعدة فيرمي 500، والرسالة نفسها لا تكشف أيّهما
    const existing =
      (await this.prisma.user.findUnique({ where: { email } })) ??
      (input.phone ? await this.prisma.user.findUnique({ where: { phone: input.phone } }) : null);
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
        email,
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
      where: { email: normalizeEmail(input.email) },
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
    /**
     * من فعّل التحقق بخطوتين — مديراً أو بائعاً أو عميلاً — لا رمز بلا إثبات ثانٍ.
     * كان الشرط على الإدارة وحدها، فكان تفعيل العميل له حبراً على ورق: يظنّ
     * حسابه محمياً وكلمة المرور وحدها تفتحه.
     */
    if (user.totpEnabledAt && user.totpSecretEnc) {
      await this.secondFactor(user, input.totp, meta);
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

  /**
   * الإثبات الثاني: رمز التطبيق أو رمز استعادة. كلاهما يُحجز بكتابة شرطيّة —
   * رمز التطبيق بخطوته الزمنية (لا يُقبل ثانيةً داخل نافذته)، ورمز الاستعادة
   * بـ `usedAt IS NULL` — فلا ينجح دخولان متزامنان بالرمز نفسه.
   */
  private async secondFactor(
    user: { id: string; totpSecretEnc: string | null; totpLastStep: number | null },
    submitted: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    if (!submitted || !user.totpSecretEnc) throw new UnauthorizedException('رمز التحقق الثنائي مطلوب وصحيح.');
    if (isDevFixedCode(submitted)) return;
    if (looksLikeRecoveryCode(submitted)) {
      if (!(await this.useRecoveryCode(user.id, submitted, meta))) {
        throw new UnauthorizedException('رمز الاستعادة غير صحيح أو استُعمل من قبل.');
      }
      return;
    }
    const secret = openTotpSecret(user.totpSecretEnc, user.id);
    const step = verifyTotpStep(submitted, secret, user.totpLastStep);
    if (step === null) throw new UnauthorizedException('رمز التحقق الثنائي مطلوب وصحيح.');
    // الحجز شرطيّ: دخولان متزامنان بالرمز نفسه لا ينجحان معاً (المرحلة 12)
    const claimed = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: {
        totpLastStep: step,
        // سرّ قديم كُتب نصّاً يُشفَّر عند أول استعمال ناجح (وسكربت totp:seal لما بقي)
        ...(isLegacyPlain(user.totpSecretEnc) ? { totpSecretEnc: sealTotpSecret(secret, user.id) } : {}),
      },
    });
    if (claimed.count === 0) throw new UnauthorizedException('رمز التحقق الثنائي استُعمل. انتظر الرمز التالي.');
  }

  /**
   * يستهلك رمز استعادة إن طابق أحد الرموز غير المستعملة. المطابقة بـ argon2
   * على كلٍّ منها (عشرة على الأكثر) — بطيئة عمداً، والمسار نادر. الاستعمال
   * يُكتب بشرط `usedAt IS NULL`، ومعه في المعاملة نفسها سطر التدقيق وتنبيه
   * صاحب الحساب: رمز استعادة استُعمل ولم يستعمله هو = حسابه في خطر.
   */
  private async useRecoveryCode(userId: string, submitted: string, meta: RequestMeta): Promise<boolean> {
    const normalized = normalizeRecoveryCode(submitted);
    const candidates = await this.prisma.totpRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    for (const c of candidates) {
      if (!(await verifyPassword(normalized, c.codeHash))) continue;
      return this.prisma.$transaction(async (tx) => {
        const { count } = await tx.totpRecoveryCode.updateMany({
          where: { id: c.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (count === 0) return false;
        const left = await tx.totpRecoveryCode.count({ where: { userId, usedAt: null } });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'auth.recovery_code_used',
            entityType: 'User',
            entityId: userId,
            afterJson: { remaining: left },
            ip: meta.ip ?? null,
            userAgent: meta.userAgent ?? null,
          },
        });
        await this.notifications.enqueue({ code: 'recovery_code_used', userId, vars: { left: String(left) } }, tx);
        return true;
      });
    }
    return false;
  }

  /** عشرة رموز جديدة تحلّ محلّ القديمة كلها — تُعاد صريحة مرة واحدة ولا تُحفظ إلا مجزّأة */
  private async replaceRecoveryCodes(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => hashPassword(normalizeRecoveryCode(c))));
    await tx.totpRecoveryCode.deleteMany({ where: { userId } });
    await tx.totpRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) });
    return codes;
  }

  async recoveryCodesLeft(userId: string): Promise<number> {
    return this.prisma.totpRecoveryCode.count({ where: { userId, usedAt: null } });
  }

  /**
   * بدء التهيئة — أو تغيير الجهاز. السرّ الجديد يُكتب في `totpPendingSecretEnc`
   * وحده ولا يمسّ المفعَّل: لا يسري إلا بعد رمز صحيح منه. كانت تكتب فوق السرّ
   * وتصفّر `totpEnabledAt`، فمجرّد فتح الصفحة بجلسة مسروقة ينزع الحماية.
   *
   * من لم يفعّله يبدأ بلا إثبات (الإداري الجديد لا يملك إلا الرمز المحدود).
   * ومن فعّله يُثبت بكلمة المرور **و**رمز من الجهاز الحالي — وهو طريق الإداري
   * الوحيد لتبديل هاتفه، إذ التعطيل ممنوع عليه.
   */
  async beginTotpSetup(
    userId: string,
    proof: { password?: string | undefined; code?: string | undefined },
    meta: RequestMeta,
  ): Promise<{ secret: string; uri: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) {
      if (!proof.password || !proof.code) {
        throw new ConflictException(
          'التحقق بخطوتين مفعَّل على حسابك. لتغيير الجهاز أدخل كلمة المرور ورمزاً من الجهاز الحالي.',
        );
      }
      await this.reauthenticate(userId, { password: proof.password, code: proof.code }, meta);
    }
    const secret = generateTotpSecret();
    // يُعرض لصاحبه مرة هنا، ولا يُخزَّن إلا مشفّراً
    await this.prisma.user.update({ where: { id: userId }, data: { totpPendingSecretEnc: sealTotpSecret(secret, userId) } });
    return { secret, uri: totpUri(secret, user.email ?? user.id) };
  }

  /**
   * يؤكّد السرّ المنتظر برمز منه فيصير هو السرّ الساري، ويُعيد رموز استعادة
   * عشرة جديدة — تُعرض مرة واحدة ولا سبيل لقراءتها بعدها. على تحقق مفعَّل
   * (تغيير جهاز) يُبلَّغ صاحب الحساب: إن لم يكن هو فحسابه في خطر.
   */
  async confirmTotpSetup(userId: string, token: string, meta: RequestMeta): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const pending = user.totpPendingSecretEnc;
    if (!pending) throw new ConflictException('لا تهيئة قيد الانتظار. ابدأ التهيئة أولاً.');
    // السرّ جديد فلا خطوة سابقة له — خطوة السرّ القديم لا تحجب رمز الجهاز الجديد
    const step = isDevFixedCode(token) ? Math.floor(Date.now() / 30_000) : verifyTotpStep(token, openTotpSecret(pending, userId));
    if (step === null) {
      // 403 لا 401: صاحب جلسة قائمة — انظر signedInSecondFactor
      throw new ForbiddenException('الرمز غير صحيح. تأكد من وقت جهازك وأعد المحاولة.');
    }
    const rotating = user.totpEnabledAt !== null;

    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      // الشرط على السرّ المنتظر نفسه: تأكيدان متزامنان، أو تهيئة بُدئت من جديد
      // بينهما، لا يُصدران دفعتي رموز ولا يُفعّلان سرّاً غير الذي تحقّق منه
      const { count } = await tx.user.updateMany({
        where: { id: userId, totpPendingSecretEnc: pending, totpEnabledAt: rotating ? { not: null } : null },
        data: {
          totpSecretEnc: pending,
          totpPendingSecretEnc: null,
          totpLastStep: step,
          ...(rotating ? {} : { totpEnabledAt: new Date() }),
        },
      });
      if (count === 0) throw new ConflictException('تغيّرت التهيئة أثناء التأكيد. ابدأ من جديد.');
      const codes = await this.replaceRecoveryCodes(tx, userId);
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: rotating ? 'auth.totp_rotated' : 'auth.totp_enabled',
          entityType: 'User',
          entityId: userId,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });
      if (rotating) await this.notifications.enqueue({ code: 'totp_rotated', userId, vars: {} }, tx);
      return codes;
    });

    // الجلسات السابقة تُبطَل: المحدودة ليُعاد إصدار رمز كامل، والعادية كي يدخل كل جهاز بالرمز
    await this.tokens.revokeAllForUser(userId);
    return { recoveryCodes };
  }

  /** رموز جديدة تُبطل القديمة كلها — بإثبات ثانٍ صحيح (رمز التطبيق أو رمز استعادة) */
  async regenerateRecoveryCodes(userId: string, code: string, meta: RequestMeta): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabledAt) throw new ConflictException('فعّل التحقق بخطوتين أولاً.');
    await this.signedInSecondFactor(user, code, meta);
    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      const codes = await this.replaceRecoveryCodes(tx, userId);
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'auth.recovery_codes_regenerated',
          entityType: 'User',
          entityId: userId,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });
      return codes;
    });
    return { recoveryCodes };
  }

  /**
   * إعادة إثبات قبل فعل حسّاس (حساب بنكي جديد مثلاً): كلمة المرور دائماً،
   * والإثبات الثاني إن كان مفعَّلاً. جلسة مسروقة وحدها لا تكفي.
   *
   * الفشل 403 لا 401 عمداً: الواجهة تفهم 401 «انتهت الجلسة» فتجدّد الرمز
   * وتعيد الطلب — فتُحرق محاولة ثانية ورمز TOTP الذي استُهلك في الأولى.
   */
  async reauthenticate(userId: string, input: { password: string; code?: string | undefined }, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new ForbiddenException('كلمة المرور غير صحيحة.');
    }
    if (!user.totpEnabledAt) return;
    await this.signedInSecondFactor(user, input.code, meta);
  }

  /**
   * الإثبات الثاني لصاحب جلسة قائمة (إعادة التحقق، تجديد رموز الاستعادة، التعطيل): الرفض 403
   * لا 401. الواجهة تقرأ 401 «انتهت الجلسة» فتجدّد الرمز وتعيد الطلب نفسه — رمز خاطئ واحد
   * كان يُحسب محاولتين من حدّ التخمين ويُدوِّر رمز التحديث بلا داعٍ (AUTH-051 و 059 و 062).
   * الدخول وحده يبقى 401: لا جلسة قبله تُجدَّد.
   */
  private async signedInSecondFactor(
    user: { id: string; totpSecretEnc: string | null; totpLastStep: number | null },
    code: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    try {
      await this.secondFactor(user, code, meta);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw new ForbiddenException(err.message);
      throw err;
    }
  }

  /**
   * تعطيل 2FA — ممنوع على الإدارة بلا استثناء (SRS A-07)، ولغيرها بكلمة
   * المرور **و** إثبات ثانٍ: جلسة مسروقة وحدها لا تنزع الحماية.
   * لا معامل ولا صلاحية تفتح باب الإدارة: المنع في الكود لا في السياسة.
   */
  async disableTotp(userId: string, input: { password: string; code: string }, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: true },
    });

    if (user.roles.some((r) => r.role === 'admin')) {
      throw new ConflictException(
        'التحقق الثنائي إلزامي على الحسابات الإدارية ولا يمكن تعطيله. لإيقافه أزل الدور الإداري أولاً.',
      );
    }
    if (!user.totpEnabledAt) throw new ConflictException('التحقق بخطوتين غير مفعَّل.');
    if (!user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new ForbiddenException('كلمة المرور غير صحيحة.');
    }
    await this.signedInSecondFactor(user, input.code, meta);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null } });
      await tx.totpRecoveryCode.deleteMany({ where: { userId } });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'auth.totp_disabled',
          entityType: 'User',
          entityId: userId,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });
    });
  }
}
