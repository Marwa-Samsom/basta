#!/usr/bin/env bash
# نسخ احتياطي واستعادة مجرَّبة — بند في بوابة خروج المرحلة 03.
# نسخة احتياطية لم تُستعَد مرة واحدة ليست نسخة احتياطية، بل أمل.
#
# النسخة مشفّرة بمفتاح عام (scripts/lib/backup-crypt.mjs): كانت ملفّ pg_dump مكشوفاً في
# مجلد يزامنه OneDrive — القاعدة كلها بنصّها في سحابة طرف ثالث. التشفير يحتاج المفتاح العام
# وحده، فالنصّ لا يُكتب على القرص عند النسخ أبداً؛ والاستعادة وحدها تحتاج الخاص.
#
#   keygen            زوج المفاتيح (مرة واحدة) — الخاص خارج المشروع وخارج OneDrive
#   backup            نسخة مشفّرة في BACKUP_DIR
#   verify [ملف]      يفكّها ويستعيدها على قاعدة نظيفة ويتحقق أن الحرّاس نجت
#   open <ملف> <خرج>  يفكّها إلى ملف pg_dump — للاستعادة الفعلية (LAUNCH-AND-ROLLBACK.md)
#   seal-legacy       يشفّر النسخ القديمة المكشوفة، ويتحقق من كلٍّ قبل حذف أصلها
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$ROOT/.localdb/pgsql/bin}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.localdb/backups}"
# العام بجانب النسخ يكفي للتشفير ولا يكشف شيئاً. الخاص في مجلد المستخدم: لا في المشروع
# (OneDrive يزامنه) ولا في git — ومع ذلك تُحفظ نسخة منه خارج الجهاز، وإلا ضاعت النسخ بضياعه
BACKUP_PUBLIC_KEY="${BACKUP_PUBLIC_KEY:-$ROOT/.localdb/backup-key.pub}"
BACKUP_PRIVATE_KEY="${BACKUP_PRIVATE_KEY:-$HOME/.basta/backup-key.pem}"
CRYPT=(node "$ROOT/scripts/lib/backup-crypt.mjs")
STAMP="$(date +%Y%m%d_%H%M%S)"

: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PGUSER:=basta}" "${PGDATABASE:=basta}"

die() { echo "✗ $1" >&2; exit 1; }

# نصّ النسخة المفكوكة يُكتب في مجلد مؤقت للنظام (خارج OneDrive) ويُحذف عند الخروج
WORK=""
work_dir() { [ -n "$WORK" ] || { WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; }; }

case "${1:-backup}" in
  keygen)
    "${CRYPT[@]}" keygen "$BACKUP_PRIVATE_KEY" "$BACKUP_PUBLIC_KEY" >/dev/null
    echo "✓ المفتاح العام:  $BACKUP_PUBLIC_KEY"
    echo "✓ المفتاح الخاص: $BACKUP_PRIVATE_KEY"
    echo "  احفظ نسخة من الخاص خارج هذا الجهاز (مدير كلمات المرور) — بدونه لا تُستعاد أيّ نسخة"
    ;;

  backup)
    source "$ROOT/scripts/lib/pg-password.sh"
    [ -f "$BACKUP_PUBLIC_KEY" ] || die "لا مفتاح تشفير: $BACKUP_PUBLIC_KEY — شغّل npm run db:backup-keygen مرة واحدة"
    mkdir -p "$BACKUP_DIR"
    out="$BACKUP_DIR/${PGDATABASE}_${STAMP}.dump.enc"
    # pg_dump يسقط في منتصفه ← seal يرى نهاية دخل فيختم نسخة مبتورة صالحة الوسم. لذلك
    # الاسم النهائي لا يُعطى إلا إن نجح الأنبوب كلّه
    if "$PGBIN/pg_dump" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Fc \
         | "${CRYPT[@]}" seal "$BACKUP_PUBLIC_KEY" - "$out.pending"; then
      mv "$out.pending" "$out"
    else
      rm -f "$out.pending"; die "فشل النسخ"
    fi
    echo "✓ $out"
    ;;

  open)
    [ $# -eq 3 ] || die "الاستعمال: $0 open <نسخة.dump.enc> <خرج.dump>"
    "${CRYPT[@]}" open "$BACKUP_PRIVATE_KEY" "$2" "$3"
    echo "✓ $3 — احذفه بعد الاستعادة"
    ;;

  verify)
    source "$ROOT/scripts/lib/pg-password.sh"
    # الاستعادة تُجرَّب على قاعدة نظيفة، ويُتحقَّق أن الحرّاس نجت معها
    src="${2:-$(ls -t "$BACKUP_DIR"/*.dump.enc 2>/dev/null | head -1 || true)}"
    [ -n "$src" ] && [ -f "$src" ] || die "لا نسخة مشفّرة في $BACKUP_DIR"
    work_dir
    if "${CRYPT[@]}" is-sealed "$src"; then
      "${CRYPT[@]}" open "$BACKUP_PRIVATE_KEY" "$src" "$WORK/restore.dump"
      dump="$WORK/restore.dump"
    else
      echo "⚠ $src غير مشفّرة — شغّل seal-legacy" >&2
      dump="$src"
    fi

    tmp="verify_$$"
    "$PGBIN/createdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$tmp"
    trap '"$PGBIN/dropdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$tmp"; rm -rf "$WORK"' EXIT
    "$PGBIN/pg_restore" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$tmp" "$dump" 2>/dev/null || true

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

  seal-legacy)
    # كل نسخة مكشوفة تُشفَّر، ثم تُفكّ وتُقارَن بالأصل بايتاً ببايت، وحينها وحدها يُحذف الأصل
    [ -f "$BACKUP_PUBLIC_KEY" ] || die "لا مفتاح تشفير — شغّل npm run db:backup-keygen أولاً"
    [ -f "$BACKUP_PRIVATE_KEY" ] || die "المفتاح الخاص غائب ($BACKUP_PRIVATE_KEY) — بدونه لا تحقّق قبل الحذف"
    work_dir
    n=0
    shopt -s nullglob
    for f in "$BACKUP_DIR"/*.dump; do
      "${CRYPT[@]}" seal "$BACKUP_PUBLIC_KEY" "$f" "$f.enc"
      "${CRYPT[@]}" open "$BACKUP_PRIVATE_KEY" "$f.enc" "$WORK/check"
      cmp -s "$f" "$WORK/check" || { rm -f "$f.enc"; die "$f: المشفّرة لا تطابق الأصل — لم يُحذف"; }
      rm -f "$f" "$WORK/check"
      n=$((n + 1))
    done
    echo "✓ $n نسخة شُفّرت وحُذف أصلها المكشوف"
    ;;

  *) echo "الاستعمال: $0 [keygen|backup|verify [ملف]|open <ملف> <خرج>|seal-legacy]" >&2; exit 1 ;;
esac
