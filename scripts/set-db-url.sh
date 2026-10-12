#!/usr/bin/env bash
# Writes DATABASE_URL for the read-only dashboard_ro role into .env.local, then
# proves it works. The password is read from a hidden prompt and never echoed.
# Re-run any time you rotate the password.
#
# Project ref and pooler host come from SUPABASE_PROJECT_REF / SUPABASE_POOLER_HOST,
# or from an existing DATABASE_URL in .env.local. Both are on Supabase:
# Project Settings -> Database -> Connection string -> Transaction pooler.
#   SUPABASE_PROJECT_REF=<ref> SUPABASE_POOLER_HOST=<host> scripts/set-db-url.sh
set -euo pipefail
cd "$(dirname "$0")/.."

existing=$(grep -m1 '^DATABASE_URL=' .env.local 2>/dev/null | cut -d= -f2- || true)
# existing looks like postgres://dashboard_ro.<ref>:<pw>@<host>:6543/postgres
REF=${SUPABASE_PROJECT_REF:-$(sed -nE 's#^postgres(ql)?://[^.]+\.([^:]+):.*#\2#p' <<<"$existing")}
HOST=${SUPABASE_POOLER_HOST:-$(sed -nE 's#^.*@([^:/]+):[0-9]+/.*#\1#p' <<<"$existing")}
[ -n "$REF" ] && [ -n "$HOST" ] || {
  echo "Set SUPABASE_PROJECT_REF and SUPABASE_POOLER_HOST (no DATABASE_URL in .env.local to read them from)."
  exit 1
}

read -rsp "dashboard_ro password: " PW; echo
[ -n "$PW" ] || { echo "empty password, nothing changed"; exit 1; }
ENC=$(PW="$PW" python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["PW"],safe=""))')
URL="postgres://dashboard_ro.$REF:$ENC@$HOST:6543/postgres"

touch .env.local
{ grep -v '^DATABASE_URL=' .env.local || true; echo "DATABASE_URL=$URL"; } > .env.local.tmp
mv .env.local.tmp .env.local
chmod 600 .env.local

echo "Testing connection as dashboard_ro..."
psql "$URL?sslmode=require" -Atc \
  "select 'user='||current_user||' read_only='||current_setting('transaction_read_only')||' runs='||(select count(*) from cardio_log)"
echo "OK: .env.local updated."
