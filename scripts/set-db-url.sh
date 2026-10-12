#!/usr/bin/env bash
# Writes DATABASE_URL for the read-only dashboard_ro role into .env.local, then
# proves it works. The password is read from a hidden prompt and never echoed.
# Re-run any time you rotate the password.
set -euo pipefail
cd "$(dirname "$0")/.."

REF=<project-ref>
HOST=<pooler-host>   # transaction pooler, IPv4, works from Vercel

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
