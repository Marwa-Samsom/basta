import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { decideRotation } from '../domain/token-family';
import { loadEnv } from '../../../common/config/env';

export interface AccessClaims {
  sub: string;
  roles: string[];
  vendorId?: string;
  permissions: string[];
  /** رمز محدود: إداري لم يفعّل 2FA بعد. لا يفتح إلا مسار التهيئة. */
  limited?: true;
  /**
   * معرّف الجلسة = عائلة رمز التحديث. به تعرف صفحة الحساب «هذا الجهاز»، وبه
   * تُنهى الجلسات الأخرى دون الحالية. يُضاف عند الإصدار لا في المطالبات.
   */
  sid?: string;
}

/** الحجز الشرطي لم يطابق صفاً: طلب متزامن دوّر الرمز قبلنا. يُرجع المعاملة */
class LostRotationRace extends Error {}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** الرمز يُخزَّن مجزّأً: تسريب الجدول لا يسلّم المهاجم رموزاً صالحة. */
  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  static refreshTtlMs(): number {
    const raw = loadEnv().jwtRefreshTtl;
    const days = Number(raw.replace('d', '')) || 30;
    return days * 86_400_000;
  }

  async issue(
    claims: AccessClaims,
    meta: { userAgent?: string | undefined; ip?: string | undefined },
    // النوع صريح: `randomUUID` يُرجع نوعاً حرفياً يضيّق المعامل بلا داعٍ
    familyId: string = randomUUID(),
  ): Promise<TokenPair> {
    return (await this.issueIn(this.prisma, claims, meta, familyId)).pair;
  }

  /** الإصدار داخل معاملة المستدعي — ويعيد معرّف صف رمز التحديث ليُربط بسلفه */
  private async issueIn(
    db: Prisma.TransactionClient,
    claims: AccessClaims,
    meta: { userAgent?: string | undefined; ip?: string | undefined },
    familyId: string,
  ): Promise<{ pair: TokenPair; id: string }> {
    const env = loadEnv();
    const accessToken = await this.jwt.signAsync({ ...claims, sid: familyId }, {
      secret: env.jwtAccessSecret,
      expiresIn: env.jwtAccessTtl as `${number}m`,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const row = await db.refreshToken.create({
      data: {
        userId: claims.sub,
        tokenHash: TokenService.hash(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + TokenService.refreshTtlMs()),
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
      },
      select: { id: true },
    });

    return { pair: { accessToken, refreshToken, expiresIn: 900 }, id: row.id };
  }

  /**
   * التدوير — ADR غير مكتوب لكنه قاعدة: الرمز يُستعمل مرة واحدة.
   *
   * وصول رمز مُبطَل يعني يقيناً أن نسخة منه بيد طرفين. عندها تُبطَل
   * العائلة كلها ويُطرد الاثنان — تسجيل خروج مزعج مرة، أفضل من حساب
   * مسروق بصمت. إلا تبويباً ثانياً من الجهاز نفسه جاء في اللحظة نفسها
   * (token-family): يسمع 409 بلا رموز، ويقرأ ما كتبه أخوه.
   *
   * الحجز والإصدار معاملة واحدة، والحجز كتابة شرطية على `revokedAt IS NULL`:
   * طلبان متزامنان بالرمز نفسه يفوز أحدهما، ويرى الآخر صفاً محجوزاً فيُعامَل
   * بقاعدة الرمز المُبطَل — لا جلستان صالحتان من رمز واحد. وفشل الإصدار
   * يُرجع الحجز، فلا يضيع الرمز القديم بلا بديل.
   */
  async rotate(
    presented: string,
    meta: { userAgent?: string | undefined; ip?: string | undefined },
    buildClaims: (userId: string) => Promise<AccessClaims>,
    attempt = 0,
  ): Promise<TokenPair> {
    const tokenHash = TokenService.hash(presented);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    let sameClient = false;
    if (stored?.revokedAt && stored.replacedById) {
      const successor = await this.prisma.refreshToken.findUnique({
        where: { id: stored.replacedById },
        select: { userAgent: true, ip: true },
      });
      sameClient =
        !!successor && successor.userAgent === (meta.userAgent ?? null) && successor.ip === (meta.ip ?? null);
    }
    const outcome = decideRotation(stored, new Date(), sameClient);

    if (outcome.kind === 'concurrent') {
      throw new ConflictException({
        statusCode: 409,
        code: 'REFRESH_ROTATED',
        message: 'جُدّدت جلستك للتوّ من نافذة أخرى. استعمل الرمز الجديد.',
      });
    }
    if (outcome.kind === 'reuse_detected') {
      await this.revokeFamily(outcome.familyId);
      throw new UnauthorizedException(
        'اكتُشف استعمال مكرّر لرمز الجلسة، فأُنهيت كل جلساتك احتياطاً. سجّل الدخول من جديد.',
      );
    }
    if (outcome.kind !== 'rotate' || !stored) {
      throw new UnauthorizedException('انتهت جلستك. سجّل الدخول من جديد.');
    }

    const claims = await buildClaims(stored.userId);
    const won = await this.prisma.$transaction(async (tx) => {
      const next = await this.issueIn(tx, claims, meta, outcome.familyId);
      const { count } = await tx.refreshToken.updateMany({
        where: { id: outcome.previousTokenId, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: next.id },
      });
      if (count === 0) throw new LostRotationRace();
      return next.pair;
    }).catch((err: unknown) => {
      if (err instanceof LostRotationRace) return null;
      throw err;
    });
    if (won) return won;

    // سبقه طلب متزامن بالرمز نفسه — يُعاد الحكم على الرمز وقد صار محجوزاً (مرة واحدة)
    if (attempt > 0) throw new UnauthorizedException('انتهت جلستك. سجّل الدخول من جديد.');
    return this.rotate(presented, meta, buildClaims, attempt + 1);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeOne(presented: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: TokenService.hash(presented), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      return await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: loadEnv().jwtAccessSecret,
      });
    } catch {
      throw new UnauthorizedException('انتهت صلاحية جلستك. حدّثها أو سجّل الدخول من جديد.');
    }
  }
}
