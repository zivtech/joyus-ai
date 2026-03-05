#!/usr/bin/env bash
# Feature 006 mediation smoke checks.
#
# Optional env:
#   BASE_URL                  API base URL (default: http://localhost:3000)
#   MEDIATION_API_KEY         Required for token-negative + happy path checks
#   MEDIATION_BEARER_TOKEN    Required for happy path checks
#   MEDIATION_PROFILE_ID      Optional profile for session create
#   MEDIATION_TEST_MESSAGE    Message for happy path (default provided)
#   MEDIATION_TEST_MAX_SOURCES Max sources (default: 3)
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required." >&2
  exit 1
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
MEDIATION_API_KEY="${MEDIATION_API_KEY:-}"
MEDIATION_BEARER_TOKEN="${MEDIATION_BEARER_TOKEN:-}"
MEDIATION_PROFILE_ID="${MEDIATION_PROFILE_ID:-}"
MEDIATION_TEST_MESSAGE="${MEDIATION_TEST_MESSAGE:-Give a concise update on current policy status.}"
MEDIATION_TEST_MAX_SOURCES="${MEDIATION_TEST_MAX_SOURCES:-3}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAILURES=0

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; FAILURES=$((FAILURES + 1)); }

request() {
  local method="$1"
  local url="$2"
  local body_file="$3"
  shift 3
  local out_file="$TMP_DIR/response.json"
  local code

  if [ -n "$body_file" ] && [ -f "$body_file" ]; then
    if ! code="$(curl -sS -o "$out_file" -w "%{http_code}" -X "$method" "$url" -H 'Content-Type: application/json' "$@" --data @"$body_file" 2>/dev/null)"; then
      code="000"
    fi
  else
    if ! code="$(curl -sS -o "$out_file" -w "%{http_code}" -X "$method" "$url" "$@" 2>/dev/null)"; then
      code="000"
    fi
  fi

  if [ ! -f "$out_file" ] || [ ! -s "$out_file" ]; then
    echo '{"error":"network_error","message":"request failed before receiving an HTTP response"}' > "$out_file"
  fi

  echo "$code" > "$TMP_DIR/status.code"
}

status_code() {
  cat "$TMP_DIR/status.code"
}

response_contains() {
  local needle="$1"
  grep -Fq "$needle" "$TMP_DIR/response.json"
}

require_status() {
  local expected="$1"
  local context="$2"
  local got
  got="$(status_code)"
  if [ "$got" = "$expected" ]; then
    pass "$context (HTTP $got)"
  else
    fail "$context (expected HTTP $expected, got $got)"
    echo "Response:" && cat "$TMP_DIR/response.json"
  fi
}

json_get() {
  local expr="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -r "$expr" "$TMP_DIR/response.json"
  else
    echo ""
  fi
}

echo "== Feature 006 smoke =="
echo "Target: $BASE_URL"

echo
echo "-- Health / metrics --"
request GET "$BASE_URL/api/content/health" ""
require_status 200 "content health endpoint"

request GET "$BASE_URL/api/content/metrics" ""
require_status 200 "content metrics endpoint"

request GET "$BASE_URL/api/mediation/health" ""
require_status 200 "mediation health endpoint"

echo
echo "-- Negative auth paths --"
NO_BODY="$TMP_DIR/no-body.json"
echo '{}' > "$NO_BODY"

request POST "$BASE_URL/api/mediation/sessions" "$NO_BODY"
require_status 401 "session create without api key"
if response_contains '"error":"missing_api_key"'; then
  pass "missing_api_key error code"
else
  fail "expected missing_api_key error code"
fi

if [ -n "$MEDIATION_API_KEY" ]; then
  request POST "$BASE_URL/api/mediation/sessions" "$NO_BODY" -H "X-API-Key: $MEDIATION_API_KEY"
  require_status 401 "session create without bearer token"
  if response_contains '"error":"missing_user_token"'; then
    pass "missing_user_token error code"
  else
    fail "expected missing_user_token error code"
  fi
else
  echo "SKIP: token-negative check requires MEDIATION_API_KEY"
fi

echo
echo "-- Happy path (optional) --"
if [ -z "$MEDIATION_API_KEY" ] || [ -z "$MEDIATION_BEARER_TOKEN" ]; then
  echo "SKIP: happy path requires MEDIATION_API_KEY and MEDIATION_BEARER_TOKEN"
else
  CREATE_BODY="$TMP_DIR/create-session.json"
  if [ -n "$MEDIATION_PROFILE_ID" ]; then
    printf '{"profileId":"%s"}\n' "$MEDIATION_PROFILE_ID" > "$CREATE_BODY"
  else
    echo '{}' > "$CREATE_BODY"
  fi

  request POST "$BASE_URL/api/mediation/sessions" "$CREATE_BODY" \
    -H "X-API-Key: $MEDIATION_API_KEY" \
    -H "Authorization: Bearer $MEDIATION_BEARER_TOKEN"
  require_status 201 "session create with api key + bearer"

  SESSION_ID="$(json_get '.sessionId // .id // empty')"
  if [ -z "$SESSION_ID" ]; then
    fail "could not parse sessionId from create response (jq required for happy path)"
  else
    pass "session created: $SESSION_ID"

    MESSAGE_BODY="$TMP_DIR/message.json"
    printf '{"message":"%s","maxSources":%s}\n' "$MEDIATION_TEST_MESSAGE" "$MEDIATION_TEST_MAX_SOURCES" > "$MESSAGE_BODY"

    request POST "$BASE_URL/api/mediation/sessions/$SESSION_ID/messages" "$MESSAGE_BODY" \
      -H "X-API-Key: $MEDIATION_API_KEY" \
      -H "Authorization: Bearer $MEDIATION_BEARER_TOKEN"
    require_status 200 "session message send"

    MESSAGE_TEXT="$(json_get '.message // empty')"
    if [ -n "$MESSAGE_TEXT" ] && [ "$MESSAGE_TEXT" != "null" ]; then
      pass "message response present"
    else
      fail "message response missing"
    fi

    request DELETE "$BASE_URL/api/mediation/sessions/$SESSION_ID" "" \
      -H "X-API-Key: $MEDIATION_API_KEY" \
      -H "Authorization: Bearer $MEDIATION_BEARER_TOKEN"
    require_status 204 "session close"
  fi
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "Feature 006 smoke FAILED ($FAILURES failure(s))."
  exit 1
fi

echo "Feature 006 smoke PASSED."
