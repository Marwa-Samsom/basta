#!/usr/bin/env bash
# =============================================================================
# تمرين التراجع — بوابة المرحلة 12: «خطة التراجع مكتوبة ومجرَّبة على التجريبية».
#
# المشروع بلا استضافة، فـ«التجريبية» نسخة كاملة من قاعدة التطوير في قاعدة
# منفصلة (basta_staging_drill) — لا تُمسّ قاعدة العمل. التمرين يمشي خطوات
# docs/04-operations/LAUNCH-AND-ROLLBACK.md حرفياً ويقيس زمنها:
#
#   1. تجهيز التجريبية من آخر نسخة               (حالة ما قبل الإصدار)
#   2. نسخة ما قبل الإصدار + بصمة البيانات        (الخطوة الإلزامية قبل أي نشر)
#   3. «إصدار سيّئ»: مهاجرة تغيّر المخطط والبيانات
#   4. التراجع: استعادة نسخة ما قبل الإصدار
#   5. التحقق: البصمة مطابقة، الحرّاس نجت، منظرات التدقيق صفر
#
#   bash scripts/rollback-drill.sh
# =============================================================================
set -euo pipefail
# النسخة فيها القاعدة كلها بلا تشفير: ملفّاتها ومجلّدها لصاحبها وحده
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$ROOT/.localdb/pgsql/bin}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.localdb/backups}"
: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PGUSER:=basta}"
# shellcheck source=lib/pg-password.sh
source "$ROOT/scripts/lib/pg-password.sh"
STAGING="basta_staging_drill"
PSQL=("$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER")
q() { "${PSQL[@]}" -d "$STAGING" -tAc "$1" | tr -d '\r'; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die() { printf '  \033[31m✗ %s\033[0m\n' "$1"; exit 1; }
now_ms() { date +%s%3N; }
mkdir -p "$BACKUP_DIR"

cleanup() { "$PGBIN/dropdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$STAGING" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# بصمة البيانات: ما يجب أن يعود بعد التراجع كما كان بالضبط
fingerprint() {
  q "SELECT concat_ws('|',
      (SELECT count(*) FROM orders), (SELECT count(*) FROM sub_orders),
      (SELECT count(*) FROM ledger_entries), (SELECT coalesce(sum(\"amountMinorUnits\"),0) FROM ledger_entries),
      (SELECT count(*) FROM platform_ledger_entries), (SELECT count(*) FROM wallets),
      (SELECT coalesce(sum(\"balanceAvailableMinorUnits\"),0) FROM wallets),
      (SELECT count(*) FROM inventory_movements), (SELECT count(*) FROM audit_logs),
      (SELECT \"valueJson\"::text FROM settings WHERE key='hold_period_days'),
      (SELECT max(migration_name) FROM _prisma_migrations))"
}

printf '\n\033[1m1 · تجهيز التجريبية من حالة الإنتاج\033[0m\n'
bash "$ROOT/scripts/db-backup.sh" backup >/dev/null
src="$(ls -t "$BACKUP_DIR"/basta_*.dump | head -1)"
cleanup
"$PGBIN/createdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$STAGING"
"$PGBIN/pg_restore" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$STAGING" "$src" 2>/dev/null || true
ok "التجريبية من $(basename "$src")"

printf '\n\033[1m2 · نسخة ما قبل الإصدار وبصمته\033[0m\n'
pre="$BACKUP_DIR/${STAGING}_prerelease_$(date +%Y%m%d_%H%M%S).dump"
"$PGBIN/pg_dump" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$STAGING" -Fc -f "$pre"
before="$(fingerprint)"
ok "نسخة $(basename "$pre") · بصمة $before"

printf '\n\033[1m3 · إصدار سيّئ\033[0m\n'
# مهاجرة تبدو معقولة وتُفسد: عمود جديد، وتغيير إعداد مالي، وسجلّ مهاجرة
"${PSQL[@]}" -d "$STAGING" -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
ALTER TABLE orders ADD COLUMN "drill_bad_column" TEXT;
UPDATE settings SET "valueJson" = '0' WHERE key = 'hold_period_days';
INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'drill', '29990101000000_bad_release', now(), now(), 1);
SQL
after_bad="$(fingerprint)"
[ "$after_bad" != "$before" ] || die "الإصدار السيّئ لم يغيّر شيئاً — التمرين لا يثبت"
ok "المخطط والإعداد المالي تغيّرا: فترة التعليق صارت 0 — مال يتحرّر فوراً"

printf '\n\033[1m4 · التراجع: استعادة نسخة ما قبل الإصدار\033[0m\n'
t0="$(now_ms)"
"${PSQL[@]}" -d postgres -qc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$STAGING' AND pid <> pg_backend_pid();" >/dev/null
"$PGBIN/dropdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$STAGING"
"$PGBIN/createdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$STAGING"
"$PGBIN/pg_restore" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$STAGING" "$pre" 2>/dev/null || true
t1="$(now_ms)"
ok "استُعيدت في $(( (t1 - t0) )) ms"

printf '\n\033[1m5 · التحقق\033[0m\n'
after="$(fingerprint)"
[ "$after" = "$before" ] || die "البصمة لا تطابق: $after ≠ $before"
ok "البصمة مطابقة بالحرف — الطلبات والدفتر والمحافظ والإعدادات وآخر مهاجرة"
[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='orders' AND column_name='drill_bad_column'")" = "0" ] || die "عمود الإصدار السيّئ باقٍ"
ok "مخطط الإصدار السيّئ زال"
if "${PSQL[@]}" -d "$STAGING" -c 'TRUNCATE TABLE "ledger_entries";' >/dev/null 2>&1; then die "الحرّاس لم تنجُ — الدفتر قابل للمحو"; fi
ok "حرّاس الدفتر نجت الاستعادة"
for v in audit_money_conservation audit_wallet_drift audit_withdrawn_drift audit_inventory_drift audit_order_split_drift audit_paid_without_split; do
  [ "$(q "SELECT count(*) FROM \"$v\"")" = "0" ] || die "$v يُظهر انحرافاً بعد التراجع"
done
ok "منظرات التدقيق صفر"

printf '\n\033[32m\033[1m✅ التراجع مجرَّب: %s ms من القرار إلى قاعدة سليمة\033[0m\n' "$(( t1 - t0 ))"
rm -f "$pre"
