/**
 * بيئة اختبارات الخادم — منفصلة عن بيئة التطوير التي تُجرَّب عليها المنصة يدوياً.
 *
 * كانت الاختبارات تكتب في قاعدة التطوير نفسها: من 17,852 مستخدماً كان 17,849 مستخدمَ
 * اختبار، و`reindexAll` يعيد بناء فهرس البحث الحقيقي، وصندوق البريد المحلي فيه عشرات
 * آلاف الرسائل، واختبار أغلق طلباً حقيقياً بعد تسليمه (#19). الآن كلٌّ منها منفصل:
 *
 *   · القاعدة: الخادم نفسه والمستخدمان أنفسهما (مستخدم التشغيل والمالك)، واسمها
 *     اسم قاعدة التطوير بلاحقة `_test` — تُنشأ وتُهاجَر وتُبذر قبل كل تشغيل (prepare-db.ts)
 *   · فهرس البحث: الاسم نفسه بلاحقة `_test`
 *   · البريد والصور ووثائق البائعين وسجل الأخطاء: مجلد مؤقت لكل تشغيل يُمحى بعده
 *   · SMTP مطفأ: بريد الاختبار لا يصل أحداً ولو ضُبط مزوّد حقيقي في .env
 *
 * لا متغيّر يُضبط ليتفعّل هذا: الفصل هو الأصل، فنسخة جديدة من المستودع لا تختبر على
 * قاعدتها الحقيقية لأنها نسيت سطراً في .env.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEST_SUFFIX = '_test';

/** اسم قاعدة/فهرس بلاحقة الاختبار — بلا تكرار إن كانت فيه أصلاً */
export const withTestSuffix = (name: string): string =>
  name.endsWith(TEST_SUFFIX) ? name : `${name}${TEST_SUFFIX}`;

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/** العنوان نفسه (المضيف والمستخدم وكلمة المرور والمعاملات) لقاعدة أخرى على الخادم نفسه */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

export const testDatabaseUrl = (url: string): string => {
  const name = databaseName(url);
  if (!name) throw new Error('عنوان القاعدة بلا اسم قاعدة.');
  return withDatabase(url, withTestSuffix(name));
};

/** مجلد هذا التشغيل: يقرؤه الإعداد والتنظيف في العملية الرئيسية نفسها */
export const TEST_RUNS_DIR = join(tmpdir(), 'basta-api-tests');
export const TEST_RUN_DIR = join(TEST_RUNS_DIR, String(process.pid));

/**
 * ما يتغيّر في البيئة أثناء الاختبار — يُمرَّر لـ vitest فيصل كل عامل. بلا DATABASE_URL
 * لا قاعدة تُشتقّ، فتتخطّى اختبارات التكامل نفسها كما كانت وتبقى اختبارات الوحدة
 */
export function testEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const app = env['DATABASE_URL'];
  const owner = env['DATABASE_MIGRATE_URL'];
  return {
    ...(app ? { DATABASE_URL: testDatabaseUrl(app) } : {}),
    ...(owner ? { DATABASE_MIGRATE_URL: testDatabaseUrl(owner) } : {}),
    MEILI_INDEX: withTestSuffix(env['MEILI_INDEX'] || 'products'),
    OUTBOX_DIR: join(TEST_RUN_DIR, 'outbox'),
    UPLOADS_DIR: join(TEST_RUN_DIR, 'uploads'),
    VENDOR_DOCUMENTS_DIR: join(TEST_RUN_DIR, 'vendor-documents'),
    ERROR_LOG_PATH: join(TEST_RUN_DIR, 'errors.jsonl'),
    SMTP_URL: '',
  };
}
