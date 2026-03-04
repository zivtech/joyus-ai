# Health Check API Contract

**Feature**: 001-mcp-server-aws-deployment

---

## GET /health

Aggregated health status for all services.

**Response 200 (all healthy):**
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

**Response 503 (degraded):**
```json
{
  "status": "degraded",
  "timestamp": "2026-02-12T15:30:00Z",
  "services": {
    "platform": { "status": "ok", "uptime_seconds": 86400 },
    "playwright": { "status": "error", "error": "container not responding" },
    "database": { "status": "ok", "connections_active": 3 }
  }
}
```

## GET /health/platform

Platform container health only.

## GET /health/playwright

Playwright container health only.

## GET /health/db

PostgreSQL connection check only.

---

## Monitoring Integration

- Health check polled every 60 seconds
- Slack alert on any non-200 response (channel: #alerts or configured channel)
- Consecutive failures (3+) trigger escalation
