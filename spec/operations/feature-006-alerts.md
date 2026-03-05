# Feature 006 Alert Definitions

**Scope:** `/api/mediation/*` and `/api/content/*`
**Source metrics:** `GET /api/content/metrics`, `content.operation_logs`

## Alert Rules

1. **Mediation 5xx Spike (critical)**
- Condition: 5xx rate > 2% over 5 minutes for `/api/mediation/sessions/:id/messages`
- Signal: `content.operation_logs.operation = 'generate'` with `success = false`
- Action: page on-call immediately

2. **Entitlement Resolver Failures (high)**
- Condition: entitlement failure rate > 5% over 10 minutes
- Signal: `entitlements.failureRate` from `/api/content/metrics`
- Action: switch to degraded mode notice and investigate resolver upstream

3. **Generation Latency Regression (high)**
- Condition: `generation.p95DurationMs > 5000` for 15 minutes
- Action: inspect provider latency and retrieval fan-out (`maxSources`)

4. **Search Latency Regression (medium)**
- Condition: `search.p95DurationMs > 1500` for 15 minutes
- Action: inspect `search_vector` index health and recent sync activity

5. **Citation Collapse (medium)**
- Condition: `generation.avgCitationCount < 1` for 30 minutes
- Action: inspect entitlement source scope and retriever output quality

6. **Drift Risk Spike (medium)**
- Condition: `drift.profilesAboveThreshold > 0` for 2 consecutive windows
- Action: review latest drift reports and profile-specific recommendations

## Dashboard Panels

1. Mediation request volume and 5xx rate (5m, 1h)
2. Generation `avgDurationMs` and `p95DurationMs`
3. Search `avgDurationMs` and `p95DurationMs`
4. Entitlement `failureRate` and `cacheHitRate`
5. Average citation count and response length
6. Drift: monitored profiles, average drift score, profiles above threshold

## Ownership

- Primary: Platform on-call
- Secondary: Content infrastructure owner
