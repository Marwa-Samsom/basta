#!/usr/bin/env bash
# نسخ احتياطي واستعادة مجرَّبة — بند في بوابة خروج المرحلة 03.
# نسخة احتياطية لم تُستعَد مرة واحدة ليست نسخة احتياطية، بل أمل.
set -euo pipefail
# النسخة فيها القاعدة كلها بلا تشفير: ملفّاتها ومجلّدها لصاحبها وحده
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$ROOT/.localdb/pgsql/bin}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.localdb/backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PGUSER:=basta}" "${PGDATABASE:=basta}"
# shellcheck source=lib/pg-password.sh
source "$ROOT/scripts/lib/pg-password.sh"

case "${1:-backup}" in
  backup)
    out="$BACKUP_DIR/${PGDATABASE}_${STAMP}.dump"
    "$PGBIN/pg_dump" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "$out"
    echo "✓ $out"
    ;;

  verify)
    # الاستعادة تُجرَّب على قاعدة نظيفة، ويُتحقَّق أن الحرّاس نجت معها
    src="${2:-$(ls -t "$BACKUP_DIR"/*.dump | head -1)}"
    tmp="verify_$$"
    "$PGBIN/createdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$tmp"
    trap '"$PGBIN/dropdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$tmp"' EXIT
    "$PGBIN/pg_restore" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$tmp" "$src" 2>/dev/null || true

    q() { "$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -tAc "$2" | tr -d ' \r'; }
    for check in \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" \
      "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal" \
      "SELECT count(*) FROM currencies" \
      "SELECT count(*) FROM settings"
    do
      a="$(q "$PGDATABASE" "$check")"; b="$(q "$tmp" "$check")"
      [ "$a" = "$b" ] || { echo "✗ انحراف: $a ≠ $b"; exit 1; }
    done

    # الحارس يجب أن يرفض — نجاحه هنا يعني فشل الاستعادة
    if "$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$tmp" \
         -c 'TRUNCATE TABLE "ledger_entries";' >/dev/null 2>&1; then
      echo "✗ الحرّاس لم ينجوا الاستعادة — الدفتر قابل للمحو"; exit 1
    fi
    echo "✓ الاستعادة مطابقة والحرّاس سليمة"
    ;;

  *) echo "الاستعمال: $0 [backup|verify [ملف]]" >&2; exit 1 ;;
esac
