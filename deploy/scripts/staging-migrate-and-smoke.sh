#!/usr/bin/env bash
set -euo pipefail

# Staging pre-deploy gate for control-plane contract changes.
# Intended to run on the staging host before production image promotion.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="${ROOT_DIR}/joyus-ai-mcp-server"
DEPLOY_DIR="${ROOT_DIR}/deploy"
STAGING_BASE_URL="${STAGING_BASE_URL:-http://localhost:3000}"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "[preflight] Missing app directory: ${APP_DIR}"
  exit 1
fi

if [[ -f "${DEPLOY_DIR}/.env" ]]; then
  echo "[preflight] Loading environment from ${DEPLOY_DIR}/.env..."
  set -a
  # shellcheck disable=SC1090
  source "${DEPLOY_DIR}/.env"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[preflight] DATABASE_URL is not set; migration cannot run."
  exit 1
fi

echo "[preflight] Running staging database migrations..."
cd "${APP_DIR}"
npm run db:migrate

echo "[preflight] Running control-plane contract tests..."
npm test -- --run \
  tests/control-plane.service.test.ts \
  tests/control-plane.router.test.ts \
  tests/control-plane-executor.test.ts \
  tests/mcp.control-plane.integration.test.ts

echo "[preflight] Running staging smoke checks against ${STAGING_BASE_URL}..."
"${DEPLOY_DIR}/scripts/health-check.sh" "${STAGING_BASE_URL}"

echo "[preflight] Staging migrate + smoke gate passed."
