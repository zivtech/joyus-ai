#!/usr/bin/env bash
set -euo pipefail

# Joyus AI deployment script.
# Usage: ./deploy/scripts/deploy.sh [image-tag]

IMAGE_TAG="${1:-latest}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"

if [[ ! -f "${DEPLOY_DIR}/docker-compose.yml" ]]; then
  echo "Missing ${DEPLOY_DIR}/docker-compose.yml"
  exit 1
fi

if [[ ! -f "${DEPLOY_DIR}/docker-compose.prod.yml" ]]; then
  echo "Missing ${DEPLOY_DIR}/docker-compose.prod.yml"
  exit 1
fi

echo "[deploy] Starting deploy for image tag: ${IMAGE_TAG}"
cd "${DEPLOY_DIR}"

export IMAGE_TAG
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

echo "[deploy] Waiting for services to settle..."
sleep 10

echo "[deploy] Running health checks..."
"${DEPLOY_DIR}/scripts/health-check.sh" "http://localhost:3000"

echo "[deploy] Deployment complete."
