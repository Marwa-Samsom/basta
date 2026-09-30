import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { privilegeReport, privilegeViolations } from './least-privilege';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Database');

  constructor() {
    super({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.assertLeastPrivilege();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * الإنتاج لا يُقلع بمالك المخطط ولا بمستخدم يعدّل الدفتر (ADR-005): المالك
   * يعطّل مشغّلات الإضافة فقط بأمر واحد، فيصير الحارس نيّة حسنة. خارج الإنتاج
   * تحذير لا رفض — كي لا تقف بيئة تطوير قديمة قبل `npm run db:app-role`.
   */
  private async assertLeastPrivilege(): Promise<void> {
    const violations = privilegeViolations(await privilegeReport(this));
    if (violations.length === 0) return;
    const message =
      `مستخدم قاعدة البيانات أوسع صلاحية مما يجب:\n  · ${violations.join('\n  · ')}\n` +
      'اجعل DATABASE_URL مستخدم التشغيل وشغّل `npm run db:app-role` بمالك المخطط (DATABASE_MIGRATE_URL).';
    if (process.env.NODE_ENV === 'production') throw new Error(message);
    this.logger.warn(message);
  }
}
