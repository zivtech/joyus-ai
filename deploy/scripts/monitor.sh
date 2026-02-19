#!/usr/bin/env bash
# Joyus AI — Monitoring Cron Wrapper
# Runs every minute via cron. Alerts after 3 consecutive failures.
# Install: (crontab -l; echo "* * * * * /opt/joyus-ai/deploy/scripts/monitor.sh") | crontab -
set -euo pipefail

FAIL_FILE="/tmp/joyus-ai-health-failures"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source env for SLACK_WEBHOOK_URL
if [ -f /opt/joyus-ai/deploy/.env ]; then
    set -a
    # shellcheck source=/dev/null
    source /opt/joyus-ai/deploy/.env
    set +a
fi

if "$SCRIPT_DIR/health-check.sh" http://localhost:3000 > /dev/null 2>&1; then
    # Healthy — reset counter, send recovery if was failing
    if [ -f "$FAIL_FILE" ]; then
        FAILS=$(cat "$FAIL_FILE")
        if [ "$FAILS" -ge 3 ]; then
            "$SCRIPT_DIR/slack-alert.sh" "recovered" ""
        fi
        rm -f "$FAIL_FILE"
    fi
else
    # Unhealthy — increment counter
    FAILS=0
    [ -f "$FAIL_FILE" ] && FAILS=$(cat "$FAIL_FILE")
    FAILS=$((FAILS + 1))
    echo "$FAILS" > "$FAIL_FILE"

    if [ "$FAILS" -eq 3 ]; then
        "$SCRIPT_DIR/slack-alert.sh" "down" "3 consecutive health check failures"
    fi
fi
