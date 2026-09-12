import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Role } from '../../../common/security/actor';

/**
 * سجل التدقيق — جدول للإضافة فقط تحرسه مشغّلات قاعدة البيانات.
 *
 * فشل الكتابة هنا **لا يُسقط العملية**: منع بائع من الشحن لأن سطر تدقيق
 * تعذّرت كتابته ضرر أكبر من فقد السطر. لكنه يُسجَّل بمستوى خطأ ويصل
 * تنبيهه، فلا يمرّ الفقد صامتاً.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    actorUserId?: string | null;
    actorRole?: Role | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: entry.actorUserId ?? null,
          actorRole: (entry.actorRole ?? null) as never,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          beforeJson: (entry.before ?? null) as never,
          afterJson: (entry.after ?? null) as never,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`تعذّر تسجيل التدقيق: ${entry.action} على ${entry.entityType}`, err as Error);
    }
  }
}
