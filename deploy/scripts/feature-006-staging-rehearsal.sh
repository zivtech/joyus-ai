#!/usr/bin/env bash
# Feature 006 staging rehearsal:
#  1) run schema migration
#  2) validate search_vector/index/query plan
#  3) optionally run mediation smoke
#  4) optionally rollback by restoring pre-migration dump
#
# Required env:
#   DATABASE_URL
# Optional env:
#   REPO_ROOT                default: auto-detect from this script path
#   RUN_SMOKE                default: false
#   DO_ROLLBACK              default: false
#   RUN_DB_PUSH              default: false (use only for ad-hoc schema reconciliation)
#   PG_DUMP_PATH             default: auto temp file
#   PG_DUMP_CONTAINER        default: joyus-ai-mcp-server-db-1 (docker fallback)
#   BASE_URL                 used by feature-006-smoke.sh if RUN_SMOKE=true
#   MEDIATION_API_KEY        used by feature-006-smoke.sh if RUN_SMOKE=true
#   MEDIATION_BEARER_TOKEN   used by feature-006-smoke.sh if RUN_SMOKE=true
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
RUN_SMOKE="${RUN_SMOKE:-false}"
DO_ROLLBACK="${DO_ROLLBACK:-false}"
RUN_DB_PUSH="${RUN_DB_PUSH:-false}"
PG_DUMP_PATH="${PG_DUMP_PATH:-$(mktemp -t feature006-staging-XXXXXX.dump)}"
PG_DUMP_CONTAINER="${PG_DUMP_CONTAINER:-joyus-ai-mcp-server-db-1}"

DUMP_MODE="host"
if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1 && docker inspect "$PG_DUMP_CONTAINER" >/dev/null 2>&1; then
    DUMP_MODE="docker"
  else
    echo "ERROR: pg_dump/pg_restore not available and docker fallback container not found." >&2
    exit 1
  fi
fi

cleanup_dump() {
  if [ -f "$PG_DUMP_PATH" ]; then
    rm -f "$PG_DUMP_PATH"
  fi
}

if [ "$DO_ROLLBACK" != "true" ]; then
  trap cleanup_dump EXIT
fi

echo "== Feature 006 staging rehearsal =="
echo "Repo root: $REPO_ROOT"
echo "Database: ${DATABASE_URL%%\?*}"
echo "Dump mode: $DUMP_MODE"
echo

echo "-- Step 0: backup pre-migration database --"
if [ "$DUMP_MODE" = "host" ]; then
  pg_dump --format=custom --file="$PG_DUMP_PATH" "$DATABASE_URL"
else
  DB_NAME="$(echo "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')"
  docker exec "$PG_DUMP_CONTAINER" sh -lc "PGPASSWORD=postgres pg_dump -U postgres -d '$DB_NAME' -Fc" > "$PG_DUMP_PATH"
fi
echo "Backup created at: $PG_DUMP_PATH"

echo
echo "-- Step 1: run migrations --"
npm --prefix "$REPO_ROOT/joyus-ai-mcp-server" run db:migrate
if [ "$RUN_DB_PUSH" = "true" ]; then
  echo "RUN_DB_PUSH=true -> running db:push reconciliation"
  npm --prefix "$REPO_ROOT/joyus-ai-mcp-server" run db:push
fi

echo
echo "-- Step 2: validate search_vector readiness and query plan --"
"$REPO_ROOT/deploy/scripts/feature-006-search-vector-check.sh"

if [ "$RUN_SMOKE" = "true" ]; then
  echo
  echo "-- Step 3: run mediation smoke --"
  "$REPO_ROOT/deploy/scripts/feature-006-smoke.sh"
fi

if [ "$DO_ROLLBACK" = "true" ]; then
  echo
  echo "-- Step 4: rollback rehearsal (restore backup) --"
  if [ "$DUMP_MODE" = "host" ]; then
    pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "$PG_DUMP_PATH"
  else
    DB_NAME="$(echo "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')"
    cat "$PG_DUMP_PATH" | docker exec -i "$PG_DUMP_CONTAINER" sh -lc "PGPASSWORD=postgres pg_restore --clean --if-exists --no-owner --no-privileges -U postgres -d '$DB_NAME'"
  fi
  echo "Rollback restore complete."
fi

echo
echo "Feature 006 staging rehearsal completed."
