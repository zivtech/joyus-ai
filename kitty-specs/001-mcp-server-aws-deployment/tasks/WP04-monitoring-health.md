---
work_package_id: WP04
title: Monitoring & Health Checks
lane: planned
dependencies: []
subtasks: [T016, T017, T018, T019, T020]
history:
- date: '2026-02-12'
  event: Created
  agent: spec-kitty.tasks
---

# WP04: Monitoring & Health Checks

**Implement with**: `spec-kitty implement WP04 --base WP01`

## Objective

Implement health check endpoints in the MCP server, create monitoring scripts, configure container restart policies, set up log rotation, and add Slack alerting for downtime. After this work package, the system is operationally observable and self-healing.

## Context

- **Dependencies**: WP01 (containers must exist)
- **Health API contract**: See `contracts/health-api.md` for response schemas
- **Monitoring**: Lightweight approach — health endpoints + cron-based checks + Slack alerts
- **Reference**: See `plan.md` Security section and `data-model.md` Health Check Endpoints

## Subtasks

### T016: Implement Health Check Endpoints

**Purpose**: Add health check routes to the jawn-ai MCP server that report the status of all services.

**Steps**:
1. Add health check routes to the jawn-ai MCP server (likely in `jawn-ai-mcp-server/src/`):

   **GET /health** — Aggregated health status:
   ```json
   {
     "status": "ok",
     "timestamp": "2026-02-12T15:30:00Z",
     "services": {
       "platform": { "status": "ok", "uptime_seconds": 86400 },
       "playwright": { "status": "ok", "uptime_seconds": 86400 },
       "database": { "status": "ok", "connections_active": 3 }
     }
   }
   ```
   - Return 200 if all services healthy
   - Return 503 if any service degraded (with `"status": "degraded"`)

   **GET /health/platform** — Platform container self-check:
   - Verify MCP server is responding
   - Report uptime

   **GET /health/playwright** — Playwright container check:
   - HTTP GET to `http://playwright:3002/health` (internal network)
   - Report status or error message

   **GET /health/db** — PostgreSQL check:
   - Execute `SELECT 1` query via Drizzle ORM connection
   - Report active connection count

2. Health checks must be lightweight — no heavy operations, no authentication required
3. Add `process.uptime()` for uptime tracking
4. Use try/catch for each service check — one service failure doesn't prevent checking others

**Files**:
- New routes in `jawn-ai-mcp-server/src/` (health controller, ~80 lines)

**Validation**:
- [ ] `GET /health` returns 200 with all services when healthy
- [ ] `GET /health` returns 503 when any service is down
- [ ] `GET /health/platform` returns platform-only status
- [ ] `GET /health/playwright` returns playwright-only status
- [ ] `GET /health/db` returns database connection status
- [ ] Response matches contract in `contracts/health-api.md`
- [ ] No authentication required for health endpoints

**Edge Cases**:
- Playwright container may be slow to start — timeout after 5s and report "starting"
- Database connection pool may be exhausted — catch and report
- Health endpoint itself must not create load (no DB writes, no external calls except internal pings)

---

### T017: Write Health Check Verification Script

**Purpose**: Command-line script that verifies all health endpoints and reports overall system status.

**Steps**:
1. Create `deploy/scripts/health-check.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   BASE_URL="${1:-http://localhost:3000}"
   FAILED=0

   check_endpoint() {
     local name="$1"
     local url="$2"
     local response
     local http_code

     http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url")

     if [ "$http_code" = "200" ]; then
       echo "✓ $name: OK"
     else
       echo "✗ $name: FAILED (HTTP $http_code)"
       FAILED=$((FAILED + 1))
     fi
   }

   echo "=== Health Check: $(date -u) ==="
   check_endpoint "Aggregated" "$BASE_URL/health"
   check_endpoint "Platform"   "$BASE_URL/health/platform"
   check_endpoint "Playwright" "$BASE_URL/health/playwright"
   check_endpoint "Database"   "$BASE_URL/health/db"

   echo ""
   if [ "$FAILED" -gt 0 ]; then
     echo "RESULT: $FAILED endpoint(s) failed"
     exit 1
   else
     echo "RESULT: All endpoints healthy"
     exit 0
   fi
   ```
2. Accept base URL as argument (default: `http://localhost:3000`)
3. Timeout after 10 seconds per endpoint
4. Exit with non-zero if any endpoint fails (used by deploy.sh)

**Files**:
- `deploy/scripts/health-check.sh` (new, ~40 lines)

**Validation**:
- [ ] Script reports status of all 4 endpoints
- [ ] Exit code 0 when all healthy
- [ ] Exit code 1 when any endpoint fails
- [ ] Works with both localhost and remote URLs
- [ ] Timeout prevents hanging on unresponsive services

---

### T018: Configure Docker Restart Policies

**Purpose**: Ensure containers automatically restart after crashes or EC2 reboots.

**Steps**:
1. In `docker-compose.yml`, add healthcheck directives:
   ```yaml
   platform:
     healthcheck:
       test: ["CMD", "curl", "-f", "http://localhost:3000/health/platform"]
       interval: 30s
       timeout: 10s
       retries: 3
       start_period: 30s

   playwright:
     healthcheck:
       test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
       interval: 30s
       timeout: 10s
       retries: 3
       start_period: 60s
   ```
2. PostgreSQL healthcheck already defined in T004 (`pg_isready`)
3. `restart: unless-stopped` is set in `docker-compose.prod.yml` (T010)
4. `start_period` accounts for container startup time (Playwright needs longer for browser init)
5. Install `curl` in Platform and Playwright containers if not present

**Files**:
- Updates to `deploy/docker-compose.yml` (healthcheck directives)

**Validation**:
- [ ] `docker compose ps` shows health status for all containers
- [ ] Container restarts automatically after `docker kill <container>`
- [ ] Containers come back after EC2 reboot (Docker service starts on boot)
- [ ] Health checks don't create excessive load (30s interval is reasonable)

---

### T019: Set Up Log Aggregation and Rotation

**Purpose**: Prevent disk space exhaustion from container and nginx logs.

**Steps**:
1. Docker log rotation is configured in `docker-compose.prod.yml` (T010):
   - `max-size: "10m"`, `max-file: "3"` per container
   - Maximum 30MB per container (90MB total for 3 containers)

2. Configure nginx log rotation via logrotate:
   ```
   # /etc/logrotate.d/nginx-jawn-ai
   /var/log/nginx/access.log /var/log/nginx/error.log {
       daily
       rotate 14
       compress
       delaycompress
       missingok
       notifempty
       create 640 www-data adm
       postrotate
           systemctl reload nginx > /dev/null 2>&1 || true
       endscript
   }
   ```

3. Add logrotate config deployment to `setup-ec2.sh`

4. Add a disk space check to the health check script:
   ```bash
   # In health-check.sh
   DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
   if [ "$DISK_USAGE" -gt 85 ]; then
     echo "⚠ Disk usage: ${DISK_USAGE}% (threshold: 85%)"
     FAILED=$((FAILED + 1))
   fi
   ```

**Files**:
- `deploy/nginx/logrotate-jawn-ai` (new, ~12 lines)
- Updates to `deploy/scripts/setup-ec2.sh` (deploy logrotate config)
- Updates to `deploy/scripts/health-check.sh` (disk space check)

**Validation**:
- [ ] Docker logs rotate at 10MB per file, max 3 files per container
- [ ] Nginx logs rotate daily, keep 14 days, compress old
- [ ] Disk space warning at 85% usage
- [ ] `logrotate --debug /etc/logrotate.d/nginx-jawn-ai` runs without errors

---

### T020: Configure Slack Alerting for Downtime

**Purpose**: Notify the team in Slack when health checks detect a service is down.

**Steps**:
1. Create `deploy/scripts/slack-alert.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   WEBHOOK_URL="${SLACK_WEBHOOK_URL}"
   STATUS="$1"    # "down" or "recovered"
   DETAILS="$2"   # Additional info

   if [ "$STATUS" = "down" ]; then
     COLOR="danger"
     TEXT=":red_circle: *MCP Server Alert*\nService degraded on ai.zivtech.com\n${DETAILS}"
   else
     COLOR="good"
     TEXT=":green_circle: *MCP Server Recovered*\nAll services healthy on ai.zivtech.com"
   fi

   curl -s -X POST "$WEBHOOK_URL" \
     -H 'Content-Type: application/json' \
     -d "{\"attachments\":[{\"color\":\"${COLOR}\",\"text\":\"${TEXT}\"}]}"
   ```

2. Create a monitoring cron job wrapper:
   ```bash
   # /opt/jawn-ai/monitor.sh
   #!/usr/bin/env bash
   FAIL_FILE="/tmp/jawn-ai-health-failures"

   if /opt/jawn-ai/deploy/scripts/health-check.sh http://localhost:3000 > /dev/null 2>&1; then
     # Healthy — reset counter, send recovery if was failing
     if [ -f "$FAIL_FILE" ]; then
       FAILS=$(cat "$FAIL_FILE")
       if [ "$FAILS" -ge 3 ]; then
         /opt/jawn-ai/deploy/scripts/slack-alert.sh "recovered" ""
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
       /opt/jawn-ai/deploy/scripts/slack-alert.sh "down" "3 consecutive health check failures"
     fi
   fi
   ```

3. Add cron job to `setup-ec2.sh`:
   ```bash
   (crontab -l 2>/dev/null; echo "* * * * * /opt/jawn-ai/monitor.sh") | crontab -
   ```

4. Alert triggers after 3 consecutive failures (3 minutes at 1-minute interval)
5. Recovery notification sent when service returns to healthy after alert

**Files**:
- `deploy/scripts/slack-alert.sh` (new, ~25 lines)
- `deploy/scripts/monitor.sh` (new, ~30 lines)
- Updates to `deploy/scripts/setup-ec2.sh` (cron job)

**Validation**:
- [ ] Slack alert fires after 3 consecutive health check failures
- [ ] Recovery notification sent when service comes back
- [ ] No alert on single transient failure (only 3+ consecutive)
- [ ] Cron runs every minute
- [ ] SLACK_WEBHOOK_URL read from environment

**Edge Cases**:
- Slack webhook URL must be set in EC2 environment (add to .env)
- If Slack is down, alert silently fails (curl returns non-zero but script continues)
- On EC2 reboot, cron restores automatically (crontab persists)

## Definition of Done

- [ ] `/health` endpoint returns correct aggregated status
- [ ] Individual health endpoints work for platform, playwright, database
- [ ] Health check script validates all endpoints from CLI
- [ ] Containers auto-restart after crash or reboot
- [ ] Logs rotate to prevent disk exhaustion
- [ ] Slack alert fires on sustained downtime (3+ minute threshold)
- [ ] Recovery notification confirms when service returns

## Risks

- **Health check creating load**: Keep checks lightweight — TCP/HTTP only, no data processing
- **False alerts**: Single transient failure should NOT alert. The 3-consecutive threshold prevents this.
- **Cron reliability**: If cron daemon stops, no monitoring occurs. Consider systemd timer as alternative.
- **Disk monitoring**: EBS can be resized, but catching 85% early prevents outage.
