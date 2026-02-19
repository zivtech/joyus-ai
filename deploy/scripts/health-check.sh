#!/usr/bin/env bash
# Joyus AI — Health Check Script
# Usage: ./health-check.sh [base-url]
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
FAILED=0

check_endpoint() {
    local name="$1"
    local url="$2"
    local http_code

    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")

    if [ "$http_code" = "200" ]; then
        echo "  OK  $name"
    else
        echo "  FAIL  $name (HTTP $http_code)"
        FAILED=$((FAILED + 1))
    fi
}

echo "=== Health Check: $(date -u) ==="
echo "Target: $BASE_URL"
echo ""

check_endpoint "Aggregated" "$BASE_URL/health"
check_endpoint "Platform"   "$BASE_URL/health/platform"
check_endpoint "Playwright" "$BASE_URL/health/playwright"
check_endpoint "Database"   "$BASE_URL/health/db"

# Disk space check
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 85 ]; then
    echo "  WARN  Disk usage: ${DISK_USAGE}% (threshold: 85%)"
    FAILED=$((FAILED + 1))
else
    echo "  OK  Disk usage: ${DISK_USAGE}%"
fi

echo ""
if [ "$FAILED" -gt 0 ]; then
    echo "RESULT: $FAILED check(s) failed"
    exit 1
else
    echo "RESULT: All checks passed"
    exit 0
fi
