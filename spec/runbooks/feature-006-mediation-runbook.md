# Feature 006 Mediation Runbook

**Applies to:** Content Infrastructure mediation flow (Feature 006)
**Routes:** `/api/mediation/*`, `/api/content/health`, `/api/content/metrics`

## 1. Triage Checklist (first 10 minutes)

1. Confirm endpoint health:
```bash
curl -sS "$BASE_URL/api/content/health" | jq
curl -sS "$BASE_URL/api/content/metrics" | jq
```
2. Confirm provider wiring is safe:
- `generationProvider` must not be `placeholder` in production.
- if `driftMonitoringEnabled=true`, `voiceAnalyzer` must not be `stub`.
3. Confirm auth failure pattern:
- spikes in `missing_api_key`, `invalid_api_key`, `missing_user_token`, `invalid_user_token` indicate integration/client issue.
4. Confirm entitlement degradation:
- check entitlement failure rate from `/api/content/metrics`.

## 2. Structured Log Fields to Inspect

Every mediation event should include:
- `requestId`
- `tenantId`
- `sessionId`
- `profileId`
- `userId`
- `event`
- `timestamp`

Use these to trace one failing request end-to-end.

## 3. Common Failure Signatures

1. `mediation.message.session_not_found`
- Cause: closed/invalid session id or cross-tenant/user/key access.
- Response: verify caller tenant/user/API key tuple matches session owner.

2. `mediation.message.failed` with entitlement errors
- Cause: resolver outage or timeout.
- Response: verify resolver URL/key; system should fail closed to restricted entitlements.

3. `mediation.message.failed` with generation provider errors
- Cause: model provider latency/outage.
- Response: verify provider URL, auth, timeout budget; reduce source fan-out if needed.

## 4. DB Diagnostic Queries

```sql
-- Recent failed generate operations
select created_at, tenant_id, operation, success, duration_ms, metadata
from content.operation_logs
where operation = 'generate'
  and created_at > now() - interval '1 hour'
order by created_at desc;

-- Entitlement resolver failures
select created_at, tenant_id, success, duration_ms, metadata
from content.operation_logs
where operation = 'resolve'
  and created_at > now() - interval '1 hour'
order by created_at desc;
```

## 5. Mitigation and Rollback

1. If drift service is unstable: set `CONTENT_DRIFT_ENABLED=false` and redeploy.
2. If generation provider is unstable: fail over provider endpoint/config and redeploy.
3. If resolver is unstable: keep fail-closed posture, communicate degraded response quality.
4. If index degradation is detected: execute index maintenance plan before re-enabling full load.

## 6. Exit Criteria

Incident can be closed when:
1. Mediation 5xx rate is below threshold for 30 minutes.
2. Entitlement failure rate is back within SLO.
3. Generation/search p95 latencies are within baseline.
4. No unresolved critical alerts remain.
