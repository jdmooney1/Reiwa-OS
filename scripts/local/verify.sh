#!/usr/bin/env bash
# ============================================================================
# db:verify - apply the migration chain to a throwaway local PostgreSQL cluster
# and assert the claims the migrations make (RLS isolation, uniqueness,
# immutability, constraints).
#
# This needs no Supabase credentials and no network, so it runs in CI and on a
# fresh clone. It does NOT replace tests/integration, which exercise the real
# Supabase runtime and Supabase Auth.
#
# Requires: postgresql-16 (server binaries), and a non-root user to run them as.
# ============================================================================
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
BASE=${REIWA_VERIFY_DIR:-${TMPDIR:-/tmp}/reiwa-verify}
PORT=${REIWA_VERIFY_PORT:-55432}
RUNAS=${REIWA_VERIFY_USER:-postgres}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "db:verify: PostgreSQL server binaries not found at $PGBIN" >&2
  echo "  install postgresql-16, or set PGBIN to the bin directory." >&2
  exit 2
fi

cleanup() {
  "$PGBIN/pg_ctl" -D "$BASE/data" stop -m immediate >/dev/null 2>&1 || \
    su "$RUNAS" -c "$PGBIN/pg_ctl -D $BASE/data stop -m immediate" >/dev/null 2>&1 || true
}
trap cleanup EXIT

rm -rf "$BASE"
mkdir -p "$BASE/data" "$BASE/sock"

# The server refuses to run as root, so the cluster is owned by $RUNAS when this
# script is itself running as root.
AS=""
if [ "$(id -u)" = "0" ]; then
  id "$RUNAS" >/dev/null 2>&1 || useradd -m "$RUNAS"
  chown -R "$RUNAS" "$BASE"
  AS="su $RUNAS -c"
fi
chmod 700 "$BASE/data"

run() { if [ -n "$AS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }

run "$PGBIN/initdb -D $BASE/data -U postgres --auth=trust" >/dev/null
run "$PGBIN/pg_ctl -D $BASE/data -o \"-k $BASE/sock -p $PORT -c listen_addresses=''\" -l $BASE/log start" >/dev/null

export PGHOST="$BASE/sock" PGPORT="$PORT" PGUSER=postgres

for _ in $(seq 1 20); do
  psql -qtc "select 1" postgres >/dev/null 2>&1 && break
  sleep 0.5
done

psql -q -c "create database reiwa_verify" postgres

echo "==> Supabase shim"
psql -q -d reiwa_verify -v ON_ERROR_STOP=1 -f "$ROOT/scripts/local/supabase-shim.sql"

echo "==> Migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '    %s\n' "$(basename "$f")"
  psql -q -d reiwa_verify -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> SQL assertions"
psql -q -d reiwa_verify -v ON_ERROR_STOP=1 -f "$ROOT/scripts/local/verify.sql"

echo "==> Data-layer assertions"
# The real data layer, over a live database, under the same RLS session wrapper
# the application uses. sslmode=disable because this is a local unix socket, not
# the Supabase pooler.
DATABASE_URL="postgresql://postgres@/reiwa_verify?host=$BASE/sock&port=$PORT&sslmode=disable" \
  npx tsx "$ROOT/scripts/local/verify-data-layer.ts"
