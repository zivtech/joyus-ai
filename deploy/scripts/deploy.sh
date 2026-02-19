#!/usr/bin/env bash
# Joyus AI — Deployment Script
# Run on EC2: ./deploy.sh <git-sha>
set -euo pipefail

SHA="${1:-latest}"
COMPOSE_DIR="/opt/joyus-ai/deploy"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
LAST_GOOD_FILE="/opt/joyus-ai/.last-good-sha"

cd "$COMPOSE_DIR"

# Define rollback function before use
rollback() {
    echo "Rolling back to previous images..."

    docker compose $COMPOSE_FILES down

    if [ -f "$LAST_GOOD_FILE" ]; then
        ROLLBACK_SHA=$(cat "$LAST_GOOD_FILE")
        echo "Rolling back to SHA: $ROLLBACK_SHA"

        # Pull specific SHA-tagged images
        docker pull "ghcr.io/zivtech/joyus-ai-platform:${ROLLBACK_SHA}" || true
        docker pull "ghcr.io/zivtech/joyus-ai-playwright:${ROLLBACK_SHA}" || true

        docker compose $COMPOSE_FILES up -d
        echo "Rollback to $ROLLBACK_SHA complete."
    else
        echo "No previous good SHA found. Restarting with cached images."
        docker compose $COMPOSE_FILES up -d
    fi
}

echo "=== Deploying SHA: $SHA ==="
echo "Started: $(date -u)"

# Save current image SHAs for rollback
PREV_PLATFORM=$(docker inspect --format='{{.Image}}' deploy-platform-1 2>/dev/null || echo "none")
PREV_PLAYWRIGHT=$(docker inspect --format='{{.Image}}' deploy-playwright-1 2>/dev/null || echo "none")
echo "Previous platform image: $PREV_PLATFORM"
echo "Previous playwright image: $PREV_PLAYWRIGHT"

# Pull new images
echo ">>> Pulling images..."
docker compose $COMPOSE_FILES pull platform playwright

# Bring up with new images
echo ">>> Starting services..."
docker compose $COMPOSE_FILES up -d

# Wait for services to start
echo ">>> Waiting for services to start..."
sleep 15

# Run health check
echo ">>> Running health check..."
if /opt/joyus-ai/deploy/scripts/health-check.sh http://localhost:3000; then
    echo "=== Deploy successful ==="
    echo "$SHA" > "$LAST_GOOD_FILE"
    echo "Saved $SHA as last known good deployment."
    exit 0
else
    echo "=== Health check failed! Rolling back ==="
    rollback
    exit 1
fi
