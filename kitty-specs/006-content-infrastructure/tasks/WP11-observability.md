---
work_package_id: WP11
title: Observability
lane: "done"
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:32:43.823203+00:00'
subtasks: [T050, T051, T052, T053]
shell_pid: "33746"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP11: Observability

## Objective

Build structured logging for all content operations, health endpoints that aggregate subsystem status, and metrics collection for operational monitoring.

## Implementation Command

```bash
spec-kitty implement WP11 --base WP01
```

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md` (FR-024, FR-025, SC-010)
- **Data Model**: `kitty-specs/006-content-infrastructure/data-model.md` (OperationLog)

Observability is foundational — other WPs will import the logger and use it. This WP can run early (only depends on WP01) so the logging infrastructure is available for later WPs to use.

---

## Subtask T050: Create Structured Content Operation Logger

**Purpose**: Consistent structured logging for all content operations (sync, search, resolve, generate, mediate).

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/monitoring/logger.ts`
2. Implement:
   ```typescript
   export class ContentLogger {
     constructor(private db: DrizzleClient) {}

     async log(entry: ContentLogEntry): Promise<void> {
       // 1. Write to content.operation_logs table
       // 2. Also emit to stdout as structured JSON for container log aggregation
     }

     // Convenience methods:
     async logSync(sourceId: string, tenantId: string, durationMs: number, success: boolean, metadata?: Record<string, unknown>): Promise<void>;
     async logSearch(userId: string, tenantId: string, query: string, durationMs: number, resultCount: number): Promise<void>;
     async logResolve(userId: string, tenantId: string, durationMs: number, success: boolean, productCount: number): Promise<void>;
     async logGenerate(userId: string, tenantId: string, durationMs: number, citationCount: number, profileId?: string): Promise<void>;
     async logMediate(userId: string, tenantId: string, sessionId: string, durationMs: number, success: boolean): Promise<void>;
   }

   interface ContentLogEntry {
     tenantId: string;
     operation: ContentOperationType;
     sourceId?: string;
     userId?: string;
     durationMs: number;
     success: boolean;
     metadata: Record<string, unknown>;
   }
   ```
3. JSON stdout format:
   ```json
   {"level":"info","operation":"search","tenantId":"...","userId":"...","durationMs":45,"success":true,"resultCount":12,"timestamp":"2026-02-21T..."}
   ```
4. OperationLog records are append-only (no updates or deletes) per data governance notes

**Files**:
- `joyus-ai-mcp-server/src/content/monitoring/logger.ts` (new, ~100 lines)

**Validation**:
- [ ] Logs written to operation_logs table
- [ ] JSON emitted to stdout for container aggregation
- [ ] All 5 operation types have convenience methods
- [ ] Duration measured accurately

---

## Subtask T051: Create Health Endpoint Handler

**Purpose**: Aggregate health status across all content subsystems.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/monitoring/health.ts`
2. Implement:
   ```typescript
   export class HealthChecker {
     async check(): Promise<HealthReport> {
       const components: Record<string, ComponentHealth> = {};

       // Database
       components.database = await this.checkDatabase();

       // Connectors (per-source health)
       components.connectors = await this.checkConnectors();

       // Search provider
       components.searchProvider = await this.checkSearchProvider();

       // Entitlement resolver
       components.entitlementResolver = await this.checkEntitlementResolver();

       // Determine overall status
       const statuses = Object.values(components).map(c =>
         typeof c === 'string' ? c : c.status ?? 'unknown'
       );
       const overall = statuses.includes('unhealthy') ? 'unhealthy'
         : statuses.includes('degraded') ? 'degraded' : 'healthy';

       return { status: overall, components, timestamp: new Date().toISOString() };
     }

     private async checkDatabase(): Promise<string> {
       try {
         await db.execute(sql`SELECT 1`);
         return 'healthy';
       } catch { return 'unhealthy'; }
     }

     // Similar for other components...
   }
   ```
3. SC-010: Report accurate status within 30 seconds of state changes. Health checks query current state, not cached state.

**Files**:
- `joyus-ai-mcp-server/src/content/monitoring/health.ts` (new, ~80 lines)

**Validation**:
- [ ] Database health checked via simple query
- [ ] Connector health checked per source
- [ ] Overall status derived from component statuses
- [ ] Returns within reasonable time (not blocked by slow components — use timeouts)

---

## Subtask T052: Create Metrics Collection

**Purpose**: Collect and expose operational metrics for content operations.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/monitoring/metrics.ts`
2. Implement:
   ```typescript
   export class MetricsCollector {
     async getMetrics(): Promise<ContentMetrics> {
       return {
         sync: await this.getSyncMetrics(),
         search: await this.getSearchMetrics(),
         entitlements: await this.getEntitlementMetrics(),
         generation: await this.getGenerationMetrics(),
         drift: await this.getDriftMetrics(),
       };
     }

     private async getSyncMetrics(): Promise<SyncMetrics> {
       // Query operation_logs for sync operations in last hour
       // Return: totalSyncs, successRate, avgDurationMs, activeSyncs
     }

     private async getSearchMetrics(): Promise<SearchMetrics> {
       // Return: totalQueries, avgDurationMs, p95DurationMs (last hour)
     }

     private async getEntitlementMetrics(): Promise<EntitlementMetrics> {
       // Return: totalResolutions, avgDurationMs, cacheHitRate, failureRate
     }

     private async getGenerationMetrics(): Promise<GenerationMetrics> {
       // Return: totalGenerations, avgCitationCount, avgResponseLength
     }

     private async getDriftMetrics(): Promise<DriftMetrics> {
       // Return: monitoredProfiles, avgDriftScore, profilesAboveThreshold
     }
   }
   ```
3. Metrics are computed from operation_logs and entity tables (no separate metrics store needed for MVP)

**Files**:
- `joyus-ai-mcp-server/src/content/monitoring/metrics.ts` (new, ~120 lines)

**Validation**:
- [ ] All 5 metric categories populated
- [ ] Queries are efficient (use aggregation, not row-by-row)
- [ ] Percentile calculations approximate (acceptable for MVP)

---

## Subtask T053: Mount Health/Metrics Routes

**Purpose**: Expose health and metrics as HTTP endpoints.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/monitoring/routes.ts`:
   ```typescript
   export function createMonitoringRouter(
     healthChecker: HealthChecker,
     metricsCollector: MetricsCollector
   ): Router {
     const router = Router();

     router.get('/health', async (_req, res) => {
       const report = await healthChecker.check();
       res.status(report.status === 'unhealthy' ? 503 : 200).json(report);
     });

     router.get('/metrics', async (_req, res) => {
       const metrics = await metricsCollector.getMetrics();
       res.json(metrics);
     });

     return router;
   }
   ```
2. Create `joyus-ai-mcp-server/src/content/monitoring/index.ts` that exports all monitoring components
3. Router will be mounted at `/api/content` in WP12

**Note**: Do NOT modify `src/index.ts` yet — that happens in WP12.

**Files**:
- `joyus-ai-mcp-server/src/content/monitoring/routes.ts` (new, ~25 lines)
- `joyus-ai-mcp-server/src/content/monitoring/index.ts` (new, ~15 lines)

**Validation**:
- [ ] Health endpoint returns 200/503 based on status
- [ ] Metrics endpoint returns all categories
- [ ] No authentication required on these endpoints

---

## Definition of Done

- [ ] Structured logger writes to operation_logs table + stdout JSON
- [ ] Health checker aggregates all subsystem statuses
- [ ] Metrics collector computes operational metrics from logs/tables
- [ ] Routes created for /health and /metrics
- [ ] SC-010: Health reports accurate within 30s of state changes
- [ ] `npm run typecheck` passes

## Risks

- **Metrics query performance**: Aggregating from operation_logs could be slow with high volume. Indexes on `(tenantId, operation, createdAt)` should handle this.
- **Health check timeouts**: A slow/unreachable connector shouldn't block the health endpoint. Use per-component timeouts.

## Reviewer Guidance

- Verify operation_logs are append-only (no UPDATE/DELETE)
- Check that health checks use timeouts (don't hang on unreachable services)
- Confirm metrics queries use proper indexes
- Verify no authentication on health/metrics endpoints (needed for monitoring systems)

## Activity Log

- 2026-02-21T12:39:48Z – unknown – shell_pid=33746 – lane=done – Monitoring: logger, health, metrics, routes
