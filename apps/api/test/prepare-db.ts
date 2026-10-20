/**
 * إعداد vitest العام. الاختبارات على قاعدة التطوير نفسها — رجعت إليها 20 أكتوبر 2026 بقرار
 * صاحبة المشروع، بعد أن فصلها #24 في basta_test. قبل أول ملف:
 *
 *   · لا قاعدة على خادم بعيد: `.env` يُوجَّه إلى Supabase وقت النشر، والاختبار يكتب آلاف الصفوف
 *   · مديرو التشغيلات السابقة بلا صلاحيات، ورسائلهم المعلّقة متروكة: كل إشعار للإدارة يصل كل
 *     من يحمل صلاحيته (enqueueAdmins)، فتراكمهم ضاعف الطابور إلى آلاف الرسائل، وصار ما ينتظر
 *     إرساله في التشغيل التالي (رمز الاستعادة بالبريد) ينتظر خلفها حتى تنقضي مهلته. كل ملف
 *     ينشئ مديريه، فلا يحتاج أحد صلاحيات من سبقه. حسابات التجربة اليدوية لا تُمسّ (test-users.ts)
 *
 * لا مهاجرة ولا بذور هنا: القاعدة قاعدة التطوير، تُهاجَر بـ `npm run db:deploy` كما قبل الفصل.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { TEST_EMAIL_PATTERN } from './test-users';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export async function setup(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) return; // بلا قاعدة تتخطّى اختبارات التكامل نفسها
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host))
    throw new Error(`القاعدة على خادم بعيد (${host}) — اختبارات الخادم على خادم محلي فقط.`);

  // المالك يمحو كما يهاجر — مستخدم التشغيل لا يُفترض أن يحذف صلاحيات
  const db = new PrismaClient({ datasourceUrl: process.env['DATABASE_MIGRATE_URL'] ?? url });
  try {
    const testUsers = Prisma.sql`SELECT "id" FROM "users" WHERE "email" ~* ${TEST_EMAIL_PATTERN}`;
    await db.$executeRaw`DELETE FROM "admin_permissions" WHERE "userId" IN (${testUsers})`;
    await db.$executeRaw`
      UPDATE "notifications" SET "status" = 'skipped', "error" = 'من تشغيل اختبار سابق'
      WHERE "status" IN ('queued', 'sending') AND "userId" IN (${testUsers})`;
  } finally {
    await db.$disconnect();
  }
}
