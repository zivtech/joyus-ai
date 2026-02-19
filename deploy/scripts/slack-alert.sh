#!/usr/bin/env bash
# Joyus AI — Slack Alert Script
# Usage: ./slack-alert.sh <down|recovered> [details]
set -euo pipefail

WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
STATUS="${1:-down}"
DETAILS="${2:-}"

if [ -z "$WEBHOOK_URL" ]; then
    echo "SLACK_WEBHOOK_URL not set, skipping alert"
    exit 0
fi

if [ "$STATUS" = "down" ]; then
    COLOR="danger"
    TEXT=":red_circle: *MCP Server Alert*\nService degraded on ai.zivtech.com\n${DETAILS}"
else
    COLOR="good"
    TEXT=":green_circle: *MCP Server Recovered*\nAll services healthy on ai.zivtech.com"
fi

curl -s -X POST "$WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"attachments\":[{\"color\":\"${COLOR}\",\"text\":\"${TEXT}\"}]}" \
    || echo "Warning: Slack notification failed"
