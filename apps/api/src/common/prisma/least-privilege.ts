import type { PrismaClient } from '@prisma/client';

/**
 * أقلّ صلاحية لمستخدم التشغيل — ADR-005.
 *
 * مشغّلات الإضافة فقط ترفض UPDATE/DELETE/TRUNCATE من أي أحد، لكن **مالك
 * الجدول يستطيع تعطيلها** (`ALTER TABLE … DISABLE TRIGGER`). فالتطبيق إن اتصل
 * بالمالك حمل مفتاح الحارس في جيبه: ثغرة حقن واحدة تعطّله ثم تمحو الدفتر.
 * لذلك يتصل التطبيق بمستخدم لا يملك شيئاً، ولا UPDATE/DELETE له على جداول
 * الإضافة فقط — طبقتان مستقلتان، تسقط إحداهما فتبقى الأخرى.
 */

/** الدالة التي تحرس جداول الإضافة فقط — كل جدول تُعلَّق عليه يُكتشف منها */
const GUARD_FUNCTION = 'basta_ledger_is_append_only';

export interface AppendOnlyTable {
  readonly table: string;
  /** الأفعال التي يرفضها مشغّله — تُنزع صلاحيتها من مستخدم التشغيل أيضاً */
  readonly update: boolean;
  readonly delete: boolean;
}

/** جداول الإضافة فقط كما تعرفها القاعدة نفسها — لا قائمة يدوية تنسى جدولاً جديداً */
export async function appendOnlyTables(db: PrismaClient): Promise<AppendOnlyTable[]> {
  // tgtype: بت 8 = DELETE، بت 16 = UPDATE
  return db.$queryRawUnsafe<AppendOnlyTable[]>(
    `SELECT c.relname::text AS "table",
            bool_or((t.tgtype & 16) <> 0) AS "update",
            bool_or((t.tgtype & 8) <> 0) AS "delete"
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE p.proname = $1 AND n.nspname = 'public' AND NOT t.tgisinternal
      GROUP BY c.relname
      ORDER BY c.relname`,
    GUARD_FUNCTION,
  );
}

export interface PrivilegeReport {
  readonly user: string;
  readonly superuser: boolean;
  /** جداول يملكها المتصل — المالك يعطّل الحرّاس ويغيّر المخطط */
  readonly ownedTables: readonly string[];
  readonly canCreateInSchema: boolean;
  /** جداول إضافة فقط يستطيع المتصل تعديلها أو حذف صفوفها */
  readonly writableAppendOnly: readonly string[];
}

export async function privilegeReport(db: PrismaClient): Promise<PrivilegeReport> {
  const [who] = await db.$queryRawUnsafe<
    { user: string; superuser: boolean; owned: string[]; create: boolean }[]
  >(
    `SELECT current_user::text AS "user",
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS "superuser",
            ARRAY(SELECT tablename::text FROM pg_tables
                   WHERE schemaname = 'public' AND tableowner = current_user ORDER BY 1) AS "owned",
            has_schema_privilege('public', 'CREATE') AS "create"`,
  );
  const guarded = await appendOnlyTables(db);
  const writable: string[] = [];
  for (const g of guarded) {
    const [r] = await db.$queryRawUnsafe<{ u: boolean; d: boolean }[]>(
      `SELECT has_table_privilege(format('public.%I', $1::text), 'UPDATE') AS "u",
              has_table_privilege(format('public.%I', $1::text), 'DELETE') AS "d"`,
      g.table,
    );
    if ((g.update && r!.u) || (g.delete && r!.d)) writable.push(g.table);
  }
  return {
    user: who!.user,
    superuser: who!.superuser,
    ownedTables: who!.owned,
    canCreateInSchema: who!.create,
    writableAppendOnly: writable,
  };
}

/** ما يخالف أقلّ صلاحية — فارغ = سليم */
export function privilegeViolations(r: PrivilegeReport): string[] {
  const out: string[] = [];
  if (r.superuser) out.push(`${r.user} مستخدم خارق`);
  if (r.ownedTables.length) out.push(`${r.user} يملك ${r.ownedTables.length} جدولاً (منها ${r.ownedTables.slice(0, 3).join('، ')}) فيستطيع تعطيل الحرّاس`);
  if (r.canCreateInSchema) out.push(`${r.user} يستطيع إنشاء كائنات في المخطط public`);
  if (r.writableAppendOnly.length) out.push(`${r.user} يملك UPDATE/DELETE على جداول الإضافة فقط: ${r.writableAppendOnly.join('، ')}`);
  return out;
}
