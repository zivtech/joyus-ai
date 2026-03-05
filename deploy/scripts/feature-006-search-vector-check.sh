#!/usr/bin/env bash
# Feature 006: verify content.items search_vector readiness + query plan.
#
# Required env:
#   DATABASE_URL             PostgreSQL DSN
# Optional env:
#   TEST_QUERY               Search phrase (default: "policy")
#   TEST_SOURCE_ID           Explicit source_id filter
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required." >&2
  exit 1
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X)
TEST_QUERY="${TEST_QUERY:-policy}"
TEST_SOURCE_ID="${TEST_SOURCE_ID:-}"

echo "== Feature 006 search_vector readiness check =="

table_exists="$(${PSQL[@]} -Atc "select to_regclass('content.items') is not null;")"
if [ "$table_exists" != "t" ]; then
  echo "ERROR: content.items table does not exist." >&2
  exit 1
fi

column_exists="$(${PSQL[@]} -Atc "select exists (select 1 from information_schema.columns where table_schema='content' and table_name='items' and column_name='search_vector');")"
if [ "$column_exists" != "t" ]; then
  echo "ERROR: content.items.search_vector column is missing." >&2
  exit 1
fi

gin_count="$(${PSQL[@]} -Atc "select count(*) from pg_indexes where schemaname='content' and tablename='items' and indexdef ilike '%using gin%' and indexdef ilike '%search_vector%';")"
if [ "$gin_count" -eq 0 ]; then
  echo "ERROR: no GIN index found for content.items.search_vector." >&2
  exit 1
fi

if [ -z "$TEST_SOURCE_ID" ]; then
  TEST_SOURCE_ID="$(${PSQL[@]} -Atc "select source_id from content.items where source_id is not null limit 1;")"
fi

echo "search_vector column: OK"
echo "search_vector GIN indexes: $gin_count"
echo "test query: $TEST_QUERY"
echo "test source_id: ${TEST_SOURCE_ID:-<none>}"

echo
echo "== Query plan (EXPLAIN ANALYZE) =="
${PSQL[@]} -v test_query="$TEST_QUERY" -v test_source="$TEST_SOURCE_ID" <<'SQL'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, source_id, title
FROM content.items
WHERE (:'test_source' = '' OR source_id = :'test_source')
  AND search_vector @@ plainto_tsquery('english', :'test_query')
ORDER BY ts_rank(search_vector, plainto_tsquery('english', :'test_query')) DESC
LIMIT 10;
SQL

echo
echo "Feature 006 search_vector validation completed."
