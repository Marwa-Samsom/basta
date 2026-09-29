# كلمة مرور مالك المخطط للسكربتات — من PGPASSWORD إن ضُبط، وإلا من DATABASE_MIGRATE_URL
# (البيئة أو .env). كانت كل سكربت تسقط إلى كلمة مكتوبة فيها — الكلمة نفسها في كل نسخة
# من المستودع؛ الآن لا كلمة في الكود، وغيابها يوقف السكربت برسالته.
# يُستدعى بـ source بعد ضبط ROOT.
if [[ -z "${PGPASSWORD:-}" ]]; then
  _url="${DATABASE_MIGRATE_URL:-$(grep -E '^DATABASE_MIGRATE_URL=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')}"
  PGPASSWORD="$(node -e 'try{process.stdout.write(decodeURIComponent(new URL(process.argv[1]).password))}catch{}' "$_url" 2>/dev/null || true)"
  unset _url
  if [[ -z "$PGPASSWORD" ]]; then
    echo "✗ كلمة مرور القاعدة غائبة: اضبط PGPASSWORD أو DATABASE_MIGRATE_URL في .env" >&2
    exit 1
  fi
fi
export PGPASSWORD
