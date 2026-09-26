import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

  private static refreshTtlMs(): number {
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
    const env = loadEnv();
    const accessToken = await this.jwt.signAsync({ ...claims, sid: familyId }, {
      secret: env.jwtAccessSecret,
      expiresIn: env.jwtAccessTtl as `${number}m`,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: claims.sub,
        tokenHash: TokenService.hash(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + TokenService.refreshTtlMs()),
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
      },
    });

    return { accessToken, refreshToken, expiresIn: 900 };
  }

  /**
   * التدوير — ADR غير مكتوب لكنه قاعدة: الرمز يُستعمل مرة واحدة.
   *
   * وصول رمز مُبطَل يعني يقيناً أن نسخة منه بيد طرفين. عندها تُبطَل
   * العائلة كلها ويُطرد الاثنان — تسجيل خروج مزعج مرة، أفضل من حساب
   * مسروق بصمت.
   */
  async rotate(
    presented: string,
    meta: { userAgent?: string | undefined; ip?: string | undefined },
    buildClaims: (userId: string) => Promise<AccessClaims>,
  ): Promise<TokenPair> {
    const tokenHash = TokenService.hash(presented);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    const outcome = decideRotation(stored, new Date());

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
    const pair = await this.issue(claims, meta, outcome.familyId);

    // الإبطال بعد الإصدار: لو فشل الإصدار بقي الرمز القديم صالحاً
    await this.prisma.refreshToken.update({
      where: { id: outcome.previousTokenId },
      data: { revokedAt: new Date() },
    });

    return pair;
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
