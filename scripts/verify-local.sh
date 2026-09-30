#!/usr/bin/env bash
# =============================================================================
# التحقق الشامل محلياً — بوابة خروج المرحلة 03 في صيغتها المحلية.
#
# لا استضافة في هذا المشروع، فالهدف من «النشر الآلي» لا يسقط بل تتغيّر صيغته:
# المطلوب أن تكون إعادة بناء البيئة كاملةً من الصفر **عملية مملّة ومكرَّرة**،
# لا طقساً يدوياً يعرفه شخص واحد.
#
# هذا السكربت يهدم قاعدة البيانات ويبنيها ويهاجرها ويبذرها ويشغّل كل فحص،
# فإن مرّ فالبيئة قابلة لإعادة الإنتاج — وهي عين ما يثبته النشر الآلي.
#
#   ./scripts/verify-local.sh          الفحص الكامل (يهدم قاعدة البيانات)
#   ./scripts/verify-local.sh --keep   بلا هدم — للتشغيل السريع أثناء العمل
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PGBIN="${PGBIN:-$ROOT/.localdb/pgsql/bin}"
# shellcheck source=lib/pg-password.sh
source "$ROOT/scripts/lib/pg-password.sh"
KEEP_DB=false
[[ "${1:-}" == "--keep" ]] && KEEP_DB=true

step=0
say() { step=$((step + 1)); printf '\n\033[1m%d · %s\033[0m\n' "$step" "$1"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die() { printf '  \033[31m✗ %s\033[0m\n' "$1"; exit 1; }

# -----------------------------------------------------------------------------
say "قاعدة البيانات تعمل"
if ! "$PGBIN/pg_isready" -h localhost -p 5432 -U basta >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$ROOT/.localdb/data" \
    -o "-p 5432 -c listen_addresses=localhost" -l "$ROOT/.localdb/pg.log" start >/dev/null 2>&1 || true
  sleep 4
fi
"$PGBIN/pg_isready" -h localhost -p 5432 -U basta >/dev/null 2>&1 || die "الخادم لا يستجيب"
ok "PostgreSQL جاهز"

# محرّك البحث (ADR-014). اختبارات البحث تتخطّى نفسها بلا محرّك كي يبقى
# `npm test` عاملاً أثناء التطوير — لكن الفحص الكامل لا يقبل تخطّياً: بوابة
# المرحلة 07 كلها بحث، والاختبار المتخطّى يُعدّ «ناجحاً» فيكذب (الدرس 5).
MEILI="$ROOT/.localdb/meili/meilisearch.exe"
if ! curl -s -m 2 http://127.0.0.1:7701/health 2>/dev/null | grep -q available; then
  [[ -x "$MEILI" ]] || die "محرّك البحث غير منزَّل — scripts/probes/README.md فيه الأمر"
  (cd "$ROOT/.localdb/meili" && "$MEILI" --http-addr 127.0.0.1:7701 --db-path ./data \
    --master-key basta_local_dev_key_0001 --env development >/dev/null 2>&1 &)
  for _ in $(seq 1 20); do
    curl -s -m 1 http://127.0.0.1:7701/health 2>/dev/null | grep -q available && break
    sleep 0.5
  done
fi
curl -s -m 2 http://127.0.0.1:7701/health 2>/dev/null | grep -q available \
  || die "محرّك البحث لا يستجيب على 7701"
ok "Meilisearch جاهز"

# -----------------------------------------------------------------------------
if [[ "$KEEP_DB" == false ]]; then
  say "هدم القاعدة وإعادة بنائها من الصفر"
  # الاختبار الحقيقي: هل تقوم البيئة من لا شيء، أم تعتمد على حالة متراكمة؟
  "$PGBIN/psql" -h localhost -p 5432 -U basta -d basta -q \
    -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
  ok "الخطّة نُظّفت"

  say "تطبيق المهاجرات"
  npm run db:deploy -w @basta/api >/dev/null 2>&1 || die "فشلت المهاجرة"
  ok "كل المهاجرات طُبّقت"

  say "البذور"
  npm run db:seed -w @basta/api >/dev/null 2>&1 || die "فشلت البذور"
  ok "القيم المؤسِّسة مزروعة"
fi

# -----------------------------------------------------------------------------
say "حرّاس قاعدة البيانات يرفضون الخرق"
q() { "$PGBIN/psql" -h localhost -p 5432 -U basta -d basta -tAc "$1" 2>/dev/null | tr -d ' \r'; }

for tbl in ledger_entries platform_ledger_entries audit_logs inventory_movements; do
  if "$PGBIN/psql" -h localhost -p 5432 -U basta -d basta \
       -c "TRUNCATE TABLE \"$tbl\";" >/dev/null 2>&1; then
    die "$tbl قابل للمحو — حارس ADR-005 معطّل"
  fi
done
ok "TRUNCATE مرفوض على الجداول المحميّة"

[[ "$(q "SELECT count(*) FROM currencies")" -ge 7 ]] || die "العملات ناقصة"
[[ "$(q "SELECT \"minorUnitDigits\" FROM currencies WHERE code='JOD'")" == "3" ]] \
  || die "الدينار ليس بثلاث خانات"
ok "العملات وخاناتها صحيحة"

for v in audit_wallet_drift audit_withdrawn_drift audit_money_conservation audit_sub_order_without_ledger audit_inventory_drift audit_reservation_drift audit_order_split_drift audit_paid_without_split; do
  [[ "$(q "SELECT count(*) FROM \"$v\"")" == "0" ]] || die "$v يُظهر انحرافاً"
done
ok "لا انحراف في views التدقيق"

# -----------------------------------------------------------------------------
say "النسخ الاحتياطي والاستعادة"
bash scripts/db-backup.sh backup >/dev/null
bash scripts/db-backup.sh verify >/dev/null || die "الاستعادة لا تطابق الأصل"
ok "نسخة أُخذت واستُعيدت على قاعدة نظيفة، والحرّاس نجت"

# -----------------------------------------------------------------------------
say "حرّاس الكود"
npx eslint apps/api/src apps/web/src --max-warnings 0 >/dev/null || die "تدقيق النمط وحدود الوحدات"
ok "حدود الوحدات سليمة (ADR-002)"

# الحارس الذي لا يعترض على خرق متعمَّد ليس حارساً (الدرس 5): حتى المرحلة 05
# لم يُحلّ أي استيراد .ts فمرّت كل الحدود بلا فحص، و «سليمة» أعلاه كانت تكذب
probe_file="apps/api/src/modules/catalog/application/__boundary_probe.ts"
mkdir -p "$(dirname "$probe_file")"
trap 'rm -f "$probe_file"' EXIT
printf "import { hashPassword } from '../../identity/domain/password';
export const probe = hashPassword;
" > "$probe_file"
if npx eslint "$probe_file" >/dev/null 2>&1; then
  die "حارس الحدود لا يعترض على استيراد داخلي عابر للوحدات"
fi
# ومن داخل apps/api كما يشغّله CI (npm run lint): الأنماط كانت تُقاس من مجلد التشغيل فتعمى هناك وحدها
if (cd apps/api && npx eslint "${probe_file#apps/api/}" >/dev/null 2>&1); then
  die "حارس الحدود أعمى حين يُشغَّل من apps/api كما في CI"
fi
rm -f "$probe_file"
ok "حارس الحدود يرفض خرقاً متعمَّداً — من الجذر ومن apps/api"

grep -rInE '#[0-9a-fA-F]{3,8}\b|rgba?\(' --include='*.tsx' --include='*.jsx' --include='*.ts' \
  --exclude='theme-colors.ts' apps/web/src >/dev/null 2>&1 && die "لون صريح في مكوّن"
grep -rInE '(margin|padding)-(left|right)\s*:' --include='*.css' --include='*.tsx' \
  apps/web/src src/styles >/dev/null 2>&1 && die "خاصية اتجاه فيزيائية"
grep -rIn 'outline:\s*none' --include='*.css' --include='*.tsx' apps/web/src src/styles 2>/dev/null \
  | grep -v 'focus-visible' >/dev/null && die "حلقة التركيز ملغاة"
grep -rInE '\*\s*100\b|/\s*100\b' --include='*.ts' apps/api/src/modules >/dev/null 2>&1 \
  && die "حساب مال خارج النواة"
ok "الرموز والاتجاه والوصولية والمال"

# -----------------------------------------------------------------------------
say "الأنواع"
npm run typecheck >/dev/null 2>&1 || die "فحص الأنواع"
ok "الوضع الصارم يمرّ في التطبيقين"

say "الاختبارات"
# رمز الخروج هو الحكم لا نصّ المخرَج: vitest يلوّن سطر الملخّص برموز ANSI
# فمطابقته نصّياً تفشل بينما الاختبارات ناجحة — حارس يكذب أسوأ من لا حارس
test_out="$(npm test -w @basta/api 2>&1)" || { echo "$test_out" | tail -30; die "اختبارات فاشلة"; }
printf '  \033[32m✓\033[0m %s\n' \
  "$(printf '%s' "$test_out" | sed -e 's/\x1b\[[0-9;]*m//g' | grep -oE 'Tests +[0-9]+ passed.*' | tail -1)"

say "البناء"
# مجلد بناء منفصل للواجهة: verify يُشغَّل غالباً وخادم التطوير يعمل على .next
# و next build يعيد كتابة next-env.d.ts ليشير إلى مجلد بنائه. يُستعاد بعده ولو فشل البناء،
# وإلا بقي الملف الملتزَم يتقلّب بين .next و .next-verify ويُلتزم مرجع إلى مجلد لا يوجد في نسخة أخرى
next_env="apps/web/next-env.d.ts"
next_env_backup="$(mktemp)"
cp "$next_env" "$next_env_backup"
trap 'cp "$next_env_backup" "$next_env"; rm -f "$next_env_backup"' EXIT
# عنوان API لا يجيب: البناء في CI بلا خادم، وصفحة تجلب بياناتها وقت البناء
# نجحت هنا لأن الخادم المحلي يعمل ثم سقطت هناك (خريطة الموقع، المرحلة 12)
NEXT_DIST_DIR=.next-verify NEXT_PUBLIC_API_URL=http://127.0.0.1:9/api/v1 npm run build >/dev/null 2>&1 || die "البناء — ومنه: صفحة تجلب من الـ API وقت البناء"
cp "$next_env_backup" "$next_env"; rm -f "$next_env_backup"; trap - EXIT
ok "api و web يُبنيان"

printf '\n\033[32m\033[1m✅ البيئة أُعيد بناؤها من الصفر وكل الفحوص تمرّ\033[0m\n'
printf '   هذا هو مكافئ «النشر الآلي» في مشروع بلا استضافة:\n'
printf '   إعادة إنتاج البيئة كاملةً عملية مملّة ومكرَّرة لا طقس يدوي.\n\n'
