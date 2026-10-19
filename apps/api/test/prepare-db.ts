/**
 * إعداد vitest العام: قاعدة الاختبار جاهزة قبل أول ملف، ومجلد التشغيل يُمحى بعد آخره.
 *
 *   npm run test:db      التحضير وحده — يستدعيه verify-local.sh قبل فحوص القاعدة
 *
 * التحضير كما يُحضَّر الخادم الحقيقي لا نسخة مختصرة منه: `prisma migrate deploy` ثم
 * db:app-role ثم البذور، بالأوامر نفسها. كلها تُعاد بلا أثر، فمهاجرة جديدة في الفرع
 * تصل قاعدة الاختبار في التشغيل التالي دون أمر يُتذكَّر.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  TEST_RUNS_DIR,
  TEST_RUN_DIR,
  TEST_SUFFIX,
  databaseName,
  testEnv,
  withDatabase,
} from './test-env';

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DAY_MS = 24 * 60 * 60 * 1000;

/** مسار أداة سطر أوامر من حزمتها — بلا npx ولا صدفة، فيعمل كما هو على ويندوز و CI */
function cli(cwd: string, pkg: string, bin: string): string {
  const require = createRequire(join(cwd, 'package.json'));
  const manifest = require.resolve(`${pkg}/package.json`);
  const bins = (require(manifest) as { bin: string | Record<string, string> }).bin;
  return resolve(dirname(manifest), typeof bins === 'string' ? bins : (bins[bin] as string));
}

export async function prepareTestDatabase(cwd: string): Promise<string> {
  const env = { ...process.env, ...testEnv(process.env) };
  const owner = env['DATABASE_MIGRATE_URL'];
  if (!owner)
    throw new Error('DATABASE_MIGRATE_URL غير معرَّف — المالك يُنشئ قاعدة الاختبار ويهاجرها.');
  const name = databaseName(owner);
  // حارس أخير قبل أي كتابة: لا تحضير لقاعدة ليست قاعدة اختبار مهما وصل من البيئة
  if (!name.endsWith(TEST_SUFFIX) || !IDENT.test(name))
    throw new Error(`«${name}» ليست قاعدة اختبار.`);
  // ولا على خادم بعيد: .env يُوجَّه إلى Supabase وقت النشر، والاختبار يُنشئ قاعدة ويكتب
  // آلاف الصفوف — مكانه خادم التطوير أو خادم CI المؤقّت، لا خادم المنصة الحقيقي
  const host = new URL(owner).hostname;
  if (!LOCAL_HOSTS.has(host))
    throw new Error(`القاعدة على خادم بعيد (${host}) — اختبارات الخادم على خادم محلي فقط.`);

  // قاعدة الصيانة «postgres» موجودة على كل خادم: لا نفترض وجود قاعدة التطوير نفسها
  const server = new PrismaClient({ datasourceUrl: withDatabase(owner, 'postgres') });
  try {
    const [row] = await server.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS "exists"`;
    if (!row?.exists) await server.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } catch (err) {
    throw new Error(
      `تعذّر إنشاء قاعدة الاختبار «${name}» — المالك يحتاج CREATEDB:\n${(err as Error).message}`,
    );
  } finally {
    await server.$disconnect();
  }

  const steps: [string, string[]][] = [
    ['المهاجرات', [cli(cwd, 'prisma', 'prisma'), 'migrate', 'deploy']],
    ['مستخدم التشغيل', [cli(cwd, 'tsx', 'tsx'), 'scripts/db-app-role.ts']],
    ['البذور', [cli(cwd, 'tsx', 'tsx'), 'prisma/seed.ts']],
  ];
  for (const [label, args] of steps) {
    const r = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' });
    if (r.status !== 0)
      throw new Error(`قاعدة الاختبار «${name}» — فشل ${label}:\n${r.stdout}${r.stderr}`);
  }
  return name;
}

export async function setup(project: { config: { root: string } }): Promise<() => Promise<void>> {
  if (process.env['DATABASE_URL']) await prepareTestDatabase(project.config.root);

  // مجلدات تشغيلات قُطعت قبل تنظيفها (Ctrl+C) — لا تتراكم في مجلد المؤقّتات
  await mkdir(TEST_RUN_DIR, { recursive: true });
  for (const entry of await readdir(TEST_RUNS_DIR)) {
    const dir = join(TEST_RUNS_DIR, entry);
    if (dir !== TEST_RUN_DIR && Date.now() - (await stat(dir)).mtimeMs > DAY_MS) {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return () => rm(TEST_RUN_DIR, { recursive: true, force: true });
}

// تشغيل مباشر: npm run test:db
if (process.argv[1] && /prepare-db\.ts$/.test(process.argv[1])) {
  prepareTestDatabase(process.cwd()).then(
    (name) => console.log(`✓ قاعدة الاختبار «${name}» مهاجَرة ومبذورة.`),
    (err: Error) => {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    },
  );
}
