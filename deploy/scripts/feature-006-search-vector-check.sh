#!/usr/bin/env bash
# Feature 006: verify content.items search_vector readiness + query plan.
#
# Required env:
#   DATABASE_URL             PostgreSQL DSN
# Optional env:
#   TEST_QUERY               Search phrase (default: "policy")
#   TEST_SOURCE_ID           Explicit source_id filter
#   PG_PSQL_CONTAINER        default: joyus-ai-mcp-server-db-1 (docker fallback)
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required." >&2
  exit 1
fi

TEST_QUERY="${TEST_QUERY:-policy}"
TEST_SOURCE_ID="${TEST_SOURCE_ID:-}"
PG_PSQL_CONTAINER="${PG_PSQL_CONTAINER:-joyus-ai-mcp-server-db-1}"

PSQL_MODE="host"
if ! command -v psql >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1 && docker inspect "$PG_PSQL_CONTAINER" >/dev/null 2>&1; then
    PSQL_MODE="docker"
  else
    echo "ERROR: psql not available and docker fallback container not found." >&2
    exit 1
  fi
fi

DB_NAME="$(echo "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')"

run_sql() {
  local sql="$1"
  if [ "$PSQL_MODE" = "host" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -Atc "$sql"
  else
    docker exec "$PG_PSQL_CONTAINER" sh -lc "PGPASSWORD=postgres psql -U postgres -d '$DB_NAME' -v ON_ERROR_STOP=1 -X -Atc \"$sql\""
  fi
}

run_sql_script() {
  local sql="$1"
  if [ "$PSQL_MODE" = "host" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X <<SQL
$sql
SQL
  else
    docker exec -i "$PG_PSQL_CONTAINER" sh -lc "PGPASSWORD=postgres psql -U postgres -d '$DB_NAME' -v ON_ERROR_STOP=1 -X" <<SQL
$sql
SQL
  fi
}

echo "== Feature 006 search_vector readiness check =="

table_exists="$(run_sql "select to_regclass('content.items') is not null;")"
if [ "$table_exists" != "t" ]; then
  echo "ERROR: content.items table does not exist." >&2
  exit 1
fi

column_exists="$(run_sql "select exists (select 1 from information_schema.columns where table_schema='content' and table_name='items' and column_name='search_vector');")"
if [ "$column_exists" != "t" ]; then
  echo "ERROR: content.items.search_vector column is missing." >&2
  exit 1
fi

gin_count="$(run_sql "select count(*) from pg_indexes where schemaname='content' and tablename='items' and indexdef ilike '%using gin%' and indexdef ilike '%search_vector%';")"
if [ "$gin_count" -eq 0 ]; then
  echo "ERROR: no GIN index found for content.items.search_vector." >&2
  exit 1
fi

if [ -z "$TEST_SOURCE_ID" ]; then
  TEST_SOURCE_ID="$(run_sql "select source_id from content.items where source_id is not null limit 1;")"
fi

echo "search_vector column: OK"
echo "search_vector GIN indexes: $gin_count"
echo "test query: $TEST_QUERY"
echo "test source_id: ${TEST_SOURCE_ID:-<none>}"

echo
echo "== Query plan (EXPLAIN ANALYZE) =="
run_sql_script "
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, source_id, title
FROM content.items
WHERE ('$TEST_SOURCE_ID' = '' OR source_id = '$TEST_SOURCE_ID')
  AND search_vector @@ plainto_tsquery('english', '$TEST_QUERY')
ORDER BY ts_rank(search_vector, plainto_tsquery('english', '$TEST_QUERY')) DESC
LIMIT 10;
"

echo
echo "Feature 006 search_vector validation completed."
