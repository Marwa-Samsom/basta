import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { trackCommits } from './after-commit';
import { privilegeReport, privilegeViolations } from './least-privilege';

/** الأعمدة الموحّدة للبحث (…Fold، مهاجرة search_fold) — شرطٌ في البحث وحده، فلا تُقرأ مع الصفّ ولا تصل ردّاً */
const FOLDED = {
  product: { nameArFold: true, descriptionArFold: true },
  vendor: { nameArFold: true },
  user: { fullNameFold: true },
  campaign: { nameArFold: true },
  attribute: { nameArFold: true },
  cmsPage: { titleArFold: true },
  banner: { titleArFold: true },
  review: { titleFold: true, bodyFold: true },
  orderItem: { productNameSnapshotArFold: true },
  conversation: { lastPreviewFold: true },
  order: { recipientNameFold: true },
} satisfies Prisma.GlobalOmitConfig;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Database');

  constructor() {
    super({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'], omit: FOLDED });
    // afterCommit: ما يقرأ ما كتبته معاملة يجري بعد تثبيتها لا داخلها (فهرس البحث بعد تغيّر المخزون)
    trackCommits(this);
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
