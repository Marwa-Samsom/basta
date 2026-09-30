/**
 * مستخدم التشغيل — الذي يتصل به التطبيق (DATABASE_URL) — ADR-005.
 *
 *   npm run db:app-role        (تستدعيه db:migrate و db:deploy و db:reset بعدها)
 *
 * يُشغَّل بمالك المخطط (DATABASE_MIGRATE_URL) ويقرأ اسم مستخدم التشغيل وكلمة
 * مروره من DATABASE_URL نفسه: كلمة المرور في البيئة وحدها، لا في مهاجرة ولا
 * في المستودع. يُعاد تشغيله بلا أثر جانبي، وبعد كل مهاجرة: جدول جديد يُمنح،
 * وجدول إضافة فقط جديد تُنزع منه UPDATE/DELETE باكتشاف مشغّله.
 *
 * ما يناله: SELECT/INSERT/UPDATE/DELETE على الجداول، لا ملكية ولا CREATE ولا
 * TRUNCATE — ولا UPDATE/DELETE على جداول الإضافة فقط. ثم يتحقّق من ذلك متصلاً
 * بمستخدم التشغيل نفسه، ويفشل إن بقيت مخالفة.
 */
import { PrismaClient } from '@prisma/client';
import { appendOnlyTables, privilegeReport, privilegeViolations } from '../src/common/prisma/least-privilege';

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

function credentialsOf(url: string | undefined, name: string): { user: string; password: string } {
  if (!url) throw new Error(`${name} غير معرَّف.`);
  const u = new URL(url);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

async function main(): Promise<void> {
  const app = credentialsOf(process.env['DATABASE_URL'], 'DATABASE_URL');
  const owner = credentialsOf(process.env['DATABASE_MIGRATE_URL'], 'DATABASE_MIGRATE_URL');
  if (!IDENT.test(app.user)) throw new Error(`اسم مستخدم التشغيل «${app.user}» غير صالح — أحرف صغيرة وأرقام و _ فقط.`);
  if (app.user === owner.user) {
    throw new Error('DATABASE_URL يتصل بمالك المخطط نفسه. التطبيق يتصل بمستخدم تشغيل منفصل (basta_app مثلاً).');
  }
  if (app.password.length < 16) throw new Error('كلمة مرور مستخدم التشغيل أقصر من 16 محرفاً.');

  const db = new PrismaClient({ datasourceUrl: process.env['DATABASE_MIGRATE_URL'] });
  const role = `"${app.user}"`;
  try {
    const [{ exists }] = await db.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS "exists"`,
      app.user,
    );
    const attrs = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(app.password)}`;
    await db.$executeRawUnsafe(exists ? `ALTER ROLE ${role} ${attrs}` : `CREATE ROLE ${role} ${attrs}`);

    const [{ database }] = await db.$queryRawUnsafe<{ database: string }[]>(`SELECT current_database()::text AS "database"`);
    await db.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${database.replace(/"/g, '""')}" TO ${role}`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await db.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM ${role}`);

    await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await db.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await db.$executeRawUnsafe(`REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ${role}`);
    // جداول المهاجرات القادمة تصل مستخدم التشغيل بلا انتظار — ويبقى نزع ما على جداول الإضافة لهذا الأمر
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    );
    await db.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
    // سجل المهاجرات للمالك وحده
    await db.$executeRawUnsafe(`REVOKE ALL ON TABLE "_prisma_migrations" FROM ${role}`);

    const guarded = await appendOnlyTables(db);
    for (const g of guarded) {
      const ops = [g.update && 'UPDATE', g.delete && 'DELETE'].filter(Boolean).join(', ');
      if (ops) await db.$executeRawUnsafe(`REVOKE ${ops} ON TABLE "${g.table}" FROM ${role}`);
    }
    console.log(`✓ ${app.user}: قراءة وكتابة بلا ملكية، و${guarded.length} جداول للإضافة فقط بلا UPDATE/DELETE.`);
  } finally {
    await db.$disconnect();
  }

  // التحقق بعين مستخدم التشغيل نفسه — لا بما ظننّا أننا منحناه
  const asApp = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL'] });
  try {
    const violations = privilegeViolations(await privilegeReport(asApp));
    if (violations.length) throw new Error(`مستخدم التشغيل ما زال أوسع مما يجب:\n  · ${violations.join('\n  · ')}`);
    console.log(`✓ تحقّق متصلاً بـ ${app.user}: لا ملكية، ولا إنشاء، ولا تعديل على الدفتر.`);
  } finally {
    await asApp.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
